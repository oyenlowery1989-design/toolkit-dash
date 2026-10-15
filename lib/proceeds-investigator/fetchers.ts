import type {
  AddressInvestigationResult,
  AddressLedgerEntry,
  AssetProceedsResult,
  ProceedsLedgerEntry,
  ScanProgress,
} from "./types";
import { fetchJson, HorizonFetchError } from "@/lib/horizon-fetch";
import { resolveAssetToXlmTrade } from "@/lib/trade-helpers";
import { getErrorMessage } from "@/lib/stellar-helpers";

import { resolveContractConversion } from "./contract-conversion";
import { fetchBeneficiaryGrouping } from "./beneficiaries";

const FETCH_LIMIT = 200;

function parseAmount(value: unknown): number {
  const parsed = parseFloat(String(value ?? "0"));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isNativeAsset(
  raw: Record<string, unknown>,
  prefix = "asset",
): boolean {
  return raw[`${prefix}_type`] === "native";
}

function isTargetAsset(
  raw: Record<string, unknown>,
  assetCode: string,
  issuer: string,
  prefix = "asset",
): boolean {
  const code = String(raw[`${prefix}_code`] ?? "");
  const assetIssuer = String(raw[`${prefix}_issuer`] ?? "");
  return raw[`${prefix}_type`] !== "native" && code === assetCode && assetIssuer === issuer;
}

async function fetchAccountMergeAmount(
  horizonBase: string,
  operationId: string,
  destination: string | undefined,
  signal: AbortSignal,
  requestTimeoutMs?: number,
): Promise<number> {
  const base = horizonBase.replace(/\/+$/, "");
  const data = await fetchJson(
    `${base}/operations/${operationId}/effects?limit=200`,
    signal,
    { timeoutMs: requestTimeoutMs },
  );
  const records = (data._embedded?.records ?? []) as Record<
    string,
    unknown
  >[];
  for (const effect of records) {
    if (effect.type !== "account_credited") continue;
    if (effect.asset_type !== "native") continue;
    if (destination && effect.account && effect.account !== destination)
      continue;
    return parseAmount(effect.amount);
  }
  return 0;
}

function sortByDateDesc<T extends { createdAt: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

type HorizonRecord = Record<string, unknown>;
type AccountSummary = NonNullable<AssetProceedsResult["accountSummaries"]>[number];

export async function fetchAssetXlmProceeds(
  horizonBase: string,
  assetCode: string,
  issuer: string,
  accounts: string[],
  signal: AbortSignal,
  onProgress?: (progress: ScanProgress) => void,
  fromDate?: Date,
  toDate?: Date,
  options: {
    network?: string;
    onLog?: (message: string) => void;
    onResult?: (summary: AccountSummary) => void;
    requestTimeoutMs?: number;
  } = {},
): Promise<AssetProceedsResult> {
  const base = horizonBase.replace(/\/+$/, "");
  const accountList = [...new Set(accounts.map((account) => account.trim()).filter(Boolean))];
  const selected = new Set(accountList);
  const fromTs = fromDate?.getTime() ?? 0;
  const toTs = toDate?.getTime() ?? Date.now();
  if (!Number.isFinite(fromTs) || !Number.isFinite(toTs) || fromTs > toTs)
    throw new Error("Invalid proceeds date window: From and To must be valid dates with From at or before To.");
  const warnings = new Set<string>();
  const proceedsLedger: ProceedsLedgerEntry[] = [];
  const purchaseLedger: ProceedsLedgerEntry[] = [];
  const outgoingLedger: ProceedsLedgerEntry[] = [];
  const internalTransferLedger: ProceedsLedgerEntry[] = [];
  const saleDeliveryLedger: ProceedsLedgerEntry[] = [];
  const accountSummaries: AccountSummary[] = [];
  const operationCache = new Map<string, HorizonRecord>();
  const verifiedContractOperations = new Set<string>();
  let oldestObserved: string | undefined;
  let newestObserved: string | undefined;
  let historyComplete = true;
  let retention: { elder: number; retainedFrom: number } | undefined;
  const earliestPayments = new Map<string, HorizonRecord>();

  const checkAbort = () => {
    if (signal.aborted) throw new DOMException("Proceeds scan aborted", "AbortError");
  };
  const get = async (url: string) => {
    checkAbort();
    options.onLog?.(`  GET ${url}`);
    const data = await fetchJson(url, signal, { onLog: options.onLog, timeoutMs: options.requestTimeoutMs });
    checkAbort();
    return data;
  };
  const warn = (message: string) => { warnings.add(message); historyComplete = false; };
  const isPath = (raw: HorizonRecord) =>
    raw.type === "path_payment_strict_send" || raw.type === "path_payment_strict_receive";
  const sum = (rows: ProceedsLedgerEntry[]) => rows.reduce((total, row) => total + row.amountXlm, 0);
  const transfer = (entry: ProceedsLedgerEntry) => {
    if (entry.to === entry.account) return;
    if (entry.to && selected.has(entry.to)) internalTransferLedger.push(entry);
    else outgoingLedger.push(entry);
  };

  // Exhausting an account endpoint proves pagination ended, not that retained history is complete.
  try {
    const root = await get(base);
    const elder = Number(root.history_elder_ledger);
    if (elder === 1) {
      // Full ledger history retained.
    } else if (Number.isFinite(elder) && elder > 1) {
      const ledger = await get(`${base}/ledgers/${elder}`);
      const retainedFrom = Date.parse(String(ledger.closed_at ?? ""));
      retention = { elder, retainedFrom };
    } else warn("Horizon history retention is unavailable; exhausted pages do not prove full coverage.");
  } catch (error) {
    checkAbort();
    warn(`Horizon history retention unavailable: ${getErrorMessage(error)}`);
  }

  const scan = async (
    account: string,
    kind: "payments" | "trades",
    visit: (raw: HorizonRecord) => Promise<void>,
  ) => {
    let cursor: string | undefined;
    let pages = 0;
    let recordsSeen = 0;
    const seen = new Set<string>();
    const visitedCursors = new Set<string>();
    while (true) {
      checkAbort();
      const params = new URLSearchParams({ limit: String(FETCH_LIMIT), order: "desc" });
      if (cursor) params.set("cursor", cursor);
      if (kind === "trades") params.set("account_id", account);
      const endpoint = kind === "trades" ? `${base}/trades` : `${base}/accounts/${account}/payments`;
      const data = await get(`${endpoint}?${params}`);
      const records = data._embedded?.records as HorizonRecord[] | undefined;
      if (!Array.isArray(records)) throw new Error(`Invalid ${kind} history response; coverage cannot be verified.`);
      pages += 1;
      recordsSeen += records.length;
      let beforeWindow = false;
      for (const raw of records) {
        checkAbort();
        if (kind === "payments") earliestPayments.set(account, raw);
        const date = String(raw.created_at ?? raw.ledger_close_time ?? "");
        const ts = Date.parse(date);
        if (!Number.isFinite(ts)) { warn(`Undated ${kind} record for ${account}; coverage is incomplete.`); continue; }
        if (!oldestObserved || ts < Date.parse(oldestObserved)) oldestObserved = date;
        if (!newestObserved || ts > Date.parse(newestObserved)) newestObserved = date;
        if (ts < fromTs) { beforeWindow = true; break; }
        if (ts > toTs) continue;
        const id = String(raw.id ?? raw.paging_token ?? "");
        if (!id) { warn(`Missing ${kind} event ID for ${account}; record skipped.`); continue; }
        if (seen.has(id)) continue;
        seen.add(id);
        if (raw.transaction_successful === false || raw.successful === false) continue;
        await visit(raw);
      }
      onProgress?.({ phase: `Scanning ${kind} for ${account.slice(0, 6)}…`, pages, records: recordsSeen,
        hits: proceedsLedger.length + purchaseLedger.length + outgoingLedger.length });
      if (beforeWindow || records.length < FETCH_LIMIT) break;
      const next = String(records.at(-1)?.paging_token ?? "");
      if (!next || visitedCursors.has(next)) { warn(`Pagination did not advance for ${account} ${kind}; cursor cycle detected.`); break; }
      visitedCursors.add(next);
      cursor = next;
    }
  };

  for (const account of accountList) {
    checkAbort();
    await scan(account, "payments", async (raw) => {
      const operationId = String(raw.id);
      operationCache.set(operationId, raw);
      const entry = (category: ProceedsLedgerEntry["category"], amountXlm: number): ProceedsLedgerEntry => ({
        id: `${category}-${operationId}`, operationId, account, category, amountXlm,
        txHash: String(raw.transaction_hash ?? ""), createdAt: String(raw.created_at ?? ""),
        from: account, to: String(raw.to ?? raw.into ?? raw.account ?? ""), successful: true,
        toMuxed: raw.to_muxed == null ? undefined : String(raw.to_muxed),
        toMuxedId: raw.to_muxed_id == null ? undefined : String(raw.to_muxed_id),
      });
      if (raw.type === "invoke_host_function") {
        verifiedContractOperations.add(`${account}:${operationId}`);
        const conversion = resolveContractConversion(raw, account, assetCode, issuer);
        if (conversion.warning) warn(`${conversion.warning} Operation ${operationId}.`);
        if (conversion.sale) proceedsLedger.push({ ...entry("contract_sale", conversion.sale.amountXlm), ...conversion.sale, to: account });
        if (conversion.purchase) purchaseLedger.push({ ...entry("contract_purchase", conversion.purchase.amountXlm), ...conversion.purchase, to: account });
      } else if (isPath(raw) && raw.from === account) {
        if (isTargetAsset(raw, assetCode, issuer, "source_asset") && isNativeAsset(raw)) {
          const sale = entry("path_sale", parseAmount(raw.amount));
          sale.assetSoldAmount = parseAmount(raw.source_amount);
          if (sale.assetSoldAmount > 0 && sale.amountXlm > 0) {
            proceedsLedger.push(sale);
            if (sale.to && sale.to !== account) {
              const delivery = { ...sale, id: `sale-delivery-${operationId}`, category: "sale_delivery" as const };
              saleDeliveryLedger.push(delivery);
              transfer(delivery);
            }
          }
        } else if (isNativeAsset(raw, "source_asset") && !isNativeAsset(raw)) {
          const purchase = entry("path_purchase", parseAmount(raw.source_amount));
          purchase.targetAssetPurchase = isTargetAsset(raw, assetCode, issuer);
          if (purchase.amountXlm > 0) purchaseLedger.push(purchase);
        } else if (isNativeAsset(raw, "source_asset") && isNativeAsset(raw)) {
          const amount = parseAmount(raw.amount);
          if (parseAmount(raw.source_amount) !== amount)
            warn(`Native path ${operationId} consumed ${parseAmount(raw.source_amount)} XLM and delivered ${amount} XLM; conversion difference is not a destination payment.`);
          if (amount > 0) transfer(entry("path_native_out", amount));
        }
      } else if (raw.type === "payment" && raw.from === account && isNativeAsset(raw)) {
        const amount = parseAmount(raw.amount);
        if (amount > 0) transfer(entry("payment", amount));
      } else if (raw.type === "create_account" && raw.funder === account) {
        const amount = parseAmount(raw.starting_balance);
        if (amount > 0) transfer(entry("create_account", amount));
      } else if (raw.type === "account_merge" && raw.source_account === account) {
        const url = `${base}/operations/${operationId}/effects?limit=200`;
        options.onLog?.(`  GET ${url}`);
        const amount = await fetchAccountMergeAmount(base, operationId, String(raw.into ?? ""), signal, options.requestTimeoutMs);
        checkAbort();
        if (amount > 0) transfer(entry("account_merge", amount));
        else warn(`Account merge ${operationId} amount unavailable.`);
      }
    });

    await scan(account, "trades", async (raw) => {
      if (raw.base_account !== account && raw.counter_account !== account) return;
      const sale = resolveAssetToXlmTrade(raw, account, assetCode, issuer);
      const ownPrefix = raw.base_account === account ? "base" : "counter";
      const otherPrefix = ownPrefix === "base" ? "counter" : "base";
      const purchase = isNativeAsset(raw, `${ownPrefix}_asset`) && !isNativeAsset(raw, `${otherPrefix}_asset`);
      if (!sale && !purchase) return;
      const links = raw._links as { operation?: { href?: string } } | undefined;
      const href = links?.operation?.href;
      const operationId = href?.match(/\/operations\/([^/?#]+)/)?.[1] ??
        (raw.operation_id ? String(raw.operation_id) : undefined);
      if (operationId && verifiedContractOperations.has(`${account}:${operationId}`)) return;
      let operation: HorizonRecord | undefined;
      if (operationId) {
        operation = operationCache.get(operationId);
        if (!operation) {
          try {
            operation = await get(`${base}/operations/${encodeURIComponent(operationId)}`);
            operationCache.set(operationId, operation!);
          } catch (error) {
            checkAbort();
            warn(`Trade ${raw.id} operation ${operationId} unavailable; unverified trade skipped: ${getErrorMessage(error)}`);
            return;
          }
        }
        if (!operation?.type) {
          warn(`Trade ${raw.id} operation ${operationId} could not be verified; trade skipped.`);
          return;
        }
        if (operation.transaction_successful === false || operation.successful === false) return;
        // A path source's fills are conversion legs; only its payment endpoint realizes proceeds.
        if (isPath(operation) && operation.from === account) return;
      } else {
        warn(`Trade ${raw.id} lacks operation evidence; unverified trade skipped.`);
        return;
      }
      const entry: ProceedsLedgerEntry = {
        id: `dex-${String(raw.id)}`, operationId, account, category: sale ? "dex_sale" : "dex_purchase",
        amountXlm: sale?.received ?? parseAmount(raw[`${ownPrefix}_amount`]),
        txHash: String(operation?.transaction_hash ?? raw.transaction_hash ?? ""),
        createdAt: String(raw.ledger_close_time ?? ""), from: account, successful: true,
      };
      if (sale && sale.sold > 0 && sale.received > 0) {
        entry.assetSoldAmount = sale.sold;
        proceedsLedger.push(entry);
      } else if (purchase && entry.amountXlm > 0) {
        entry.targetAssetPurchase = isTargetAsset(raw, assetCode, issuer, `${otherPrefix}_asset`);
        purchaseLedger.push(entry);
      }
    });

    let currentXlmBalance: number | null = null;
    try {
      const data = await get(`${base}/accounts/${account}`);
      const native = (data.balances as HorizonRecord[] | undefined)?.find((balance) => balance.asset_type === "native");
      const amount = Number(native?.balance);
      if (native && Number.isFinite(amount)) currentXlmBalance = amount;
      else warn(`Current XLM balance unavailable for ${account}.`);
    } catch (error) {
      checkAbort();
      if (error instanceof HorizonFetchError && error.status === 404) currentXlmBalance = 0;
      else warn(`Current XLM balance unavailable for ${account}: ${getErrorMessage(error)}`);
    }
    const sales = proceedsLedger.filter((entry) => entry.account === account);
    const purchases = purchaseLedger.filter((entry) => entry.account === account);
    const summary: AccountSummary = {
      account, totalXlmProceeds: sum(sales), totalAssetSold: sales.reduce((total, sale) => total + (sale.assetSoldAmount ?? 0), 0),
      totalXlmSpentOnPurchases: sum(purchases.filter((entry) => entry.targetAssetPurchase)),
      accountWideXlmSpentOnPurchases: sum(purchases),
      totalOutgoingXlm: sum(outgoingLedger.filter((entry) => entry.account === account)), currentXlmBalance,
      confirmedSeller: sales.length > 0, saleEvidenceIds: sales.map((entry) => entry.id),
    };
    accountSummaries.push(summary);
    options.onResult?.(summary);
  }
  checkAbort();
  const accountHistoryStarts: NonNullable<NonNullable<AssetProceedsResult["coverage"]>["accountHistoryStarts"]> = [];
  if (retention && (!fromDate || !Number.isFinite(retention.retainedFrom) || fromTs < retention.retainedFrom)) {
    for (const account of accountList) {
      const first = earliestPayments.get(account);
      const createdAt = String(first?.created_at ?? "");
      const createdTs = Date.parse(createdAt);
      // Bound coverage to the observed lifetime; a previous merged incarnation is not proven absent.
      if (first?.type === "create_account" && first.account === account && first.transaction_successful === true &&
        first.successful !== false && first.id && first.transaction_hash && Number.isFinite(createdTs) &&
        createdTs >= retention.retainedFrom && createdTs <= toTs) {
        accountHistoryStarts.push({ account, createdAt, operationId: String(first.id), txHash: String(first.transaction_hash) });
      }
    }
    if (accountHistoryStarts.length !== accountList.length || !accountList.length)
      warn(`Horizon retains history from ledger ${retention.elder}; coverage before this boundary is unproven for accounts without retained creation evidence.`);
  }
  const destinations = new Map<string, { totalXlm: number; count: number }>();
  for (const entry of outgoingLedger) {
    if (!entry.to) continue;
    const previous = destinations.get(entry.to) ?? { totalXlm: 0, count: 0 };
    destinations.set(entry.to, { totalXlm: previous.totalXlm + entry.amountXlm, count: previous.count + 1 });
  }
  if (options.network) onProgress?.({ phase: "Verifying beneficiary transaction memos", pages: 0, records: outgoingLedger.length });
  const beneficiaryGrouping = options.network
    ? await fetchBeneficiaryGrouping(outgoingLedger, options.network, signal, hash => get(`${base}/transactions/${encodeURIComponent(hash)}`))
    : undefined;
  checkAbort();
  const totalXlmProceeds = sum(proceedsLedger);
  const totalOutgoingXlm = sum(outgoingLedger);
  return {
    assetCode, issuer, accounts: accountList, beneficiaryGrouping,
    totalAssetSold: accountSummaries.reduce((total, summary) => total + summary.totalAssetSold, 0),
    totalXlmProceeds, totalOutgoingXlm, estimatedOnHandXlm: totalXlmProceeds - totalOutgoingXlm,
    totalXlmSpentOnPurchases: sum(purchaseLedger.filter((entry) => entry.targetAssetPurchase)),
    accountWideXlmSpentOnPurchases: sum(purchaseLedger),
    currentXlmBalance: accountSummaries.some((summary) => summary.currentXlmBalance === null) ? null :
      accountSummaries.reduce((total, summary) => total + (summary.currentXlmBalance ?? 0), 0),
    totalInternalTransferXlm: sum(internalTransferLedger), externalSaleDeliveryXlm: sum(saleDeliveryLedger.filter((entry) => !selected.has(entry.to ?? ""))),
    contractSaleCount: proceedsLedger.filter((entry) => entry.category === "contract_sale").length,
    dexTradeCount: proceedsLedger.filter((entry) => entry.category === "dex_sale").length,
    pathSaleCount: proceedsLedger.filter((entry) => entry.category === "path_sale").length,
    proceedsLedger: sortByDateDesc(proceedsLedger), outgoingLedger: sortByDateDesc(outgoingLedger),
    purchaseLedger: sortByDateDesc(purchaseLedger), internalTransferLedger: sortByDateDesc(internalTransferLedger),
    saleDeliveryLedger: sortByDateDesc(saleDeliveryLedger), accountSummaries,
    coverage: { requestedFrom: fromDate?.toISOString() ?? null, requestedTo: new Date(toTs).toISOString(),
      oldestObserved, newestObserved, complete: historyComplete, warnings: [...warnings],
      ...(accountHistoryStarts.length ? { accountHistoryStarts } : {}) },
    topDestinations: [...destinations].map(([address, info]) => ({ address, ...info }))
      .sort((a, b) => b.totalXlm - a.totalXlm).slice(0, 50),
  };
}

export async function fetchAddressInvestigation(
  horizonBase: string,
  account: string,
  signal: AbortSignal,
  onProgress?: (progress: ScanProgress) => void,
  fromDate?: Date,
  toDate?: Date,
): Promise<AddressInvestigationResult> {
  const base = horizonBase.replace(/\/+$/, "");
  const incomingLedger: AddressLedgerEntry[] = [];
  const outgoingLedger: AddressLedgerEntry[] = [];
  const senders = new Map<string, { total: number; count: number }>();
  const recipients = new Map<string, { total: number; count: number }>();

  const fromTs = fromDate ? fromDate.getTime() : 0;
  const toTs = toDate ? toDate.getTime() : Date.now() + 86_400_000;

  let complete = true;
  let warning: string | undefined;

  let cursor: string | undefined;
  let pages = 0;
  let recordsSeen = 0;

  try {
  while (!signal.aborted) {
    const params = new URLSearchParams({
      order: "desc",
      limit: String(FETCH_LIMIT),
    });
    if (cursor) params.set("cursor", cursor);

    const data = await fetchJson(
      `${base}/accounts/${account}/operations?${params.toString()}`,
      signal,
    );
    const records = (data._embedded?.records ?? []) as Record<
      string,
      unknown
    >[];
    pages += 1;
    recordsSeen += records.length;

    let doneEarly = false;
    for (const raw of records) {
      const opTs = new Date(String(raw.created_at ?? "")).getTime();
      if (opTs > toTs) continue;
      if (opTs < fromTs) { doneEarly = true; break; }
      const type = String(raw.type ?? "");
      const opId = String(raw.id ?? "");
      const txHash = String(raw.transaction_hash ?? "");
      const createdAt = String(raw.created_at ?? "");
      const successful = (raw.transaction_successful as boolean) ?? true;

      if (type === "payment" && isNativeAsset(raw)) {
        if (raw.to === account) {
          const amount = parseAmount(raw.amount);
          const from = String(raw.from ?? "");
          if (amount > 0) {
            incomingLedger.push({
              id: `in-pay-${opId}`,
              direction: "incoming",
              category: "payment",
              amountXlm: amount,
              txHash,
              createdAt,
              from,
              to: account,
              successful,
            });
            const current = senders.get(from) ?? { total: 0, count: 0 };
            senders.set(from, {
              total: current.total + amount,
              count: current.count + 1,
            });
          }
        }
        if (raw.from === account) {
          const amount = parseAmount(raw.amount);
          const to = String(raw.to ?? "");
          if (amount > 0) {
            outgoingLedger.push({
              id: `out-pay-${opId}`,
              direction: "outgoing",
              category: "payment",
              amountXlm: amount,
              txHash,
              createdAt,
              from: account,
              to,
              successful,
            });
            const current = recipients.get(to) ?? { total: 0, count: 0 };
            recipients.set(to, {
              total: current.total + amount,
              count: current.count + 1,
            });
          }
        }
      } else if (type === "create_account") {
        if (raw.account === account) {
          const amount = parseAmount(raw.starting_balance);
          const from = String(raw.funder ?? "");
          if (amount > 0) {
            incomingLedger.push({
              id: `in-ca-${opId}`,
              direction: "incoming",
              category: "create_account",
              amountXlm: amount,
              txHash,
              createdAt,
              from,
              to: account,
              successful,
            });
            const current = senders.get(from) ?? { total: 0, count: 0 };
            senders.set(from, {
              total: current.total + amount,
              count: current.count + 1,
            });
          }
        }
        if (raw.funder === account) {
          const amount = parseAmount(raw.starting_balance);
          const to = String(raw.account ?? "");
          if (amount > 0) {
            outgoingLedger.push({
              id: `out-ca-${opId}`,
              direction: "outgoing",
              category: "create_account",
              amountXlm: amount,
              txHash,
              createdAt,
              from: account,
              to,
              successful,
            });
            const current = recipients.get(to) ?? { total: 0, count: 0 };
            recipients.set(to, {
              total: current.total + amount,
              count: current.count + 1,
            });
          }
        }
      } else if (
        type === "path_payment_strict_send" ||
        type === "path_payment_strict_receive"
      ) {
        if (raw.to === account && isNativeAsset(raw)) {
          const amount = parseAmount(raw.amount);
          const from = String(raw.from ?? "");
          if (amount > 0) {
            incomingLedger.push({
              id: `in-path-${opId}`,
              direction: "incoming",
              category: "path_payment",
              amountXlm: amount,
              txHash,
              createdAt,
              from,
              to: account,
              successful,
            });
            const current = senders.get(from) ?? { total: 0, count: 0 };
            senders.set(from, {
              total: current.total + amount,
              count: current.count + 1,
            });
          }
        }

        if (raw.from === account && isNativeAsset(raw, "source_asset")) {
          const amount = parseAmount(raw.source_amount);
          const to = String(raw.to ?? "");
          if (amount > 0) {
            outgoingLedger.push({
              id: `out-path-${opId}`,
              direction: "outgoing",
              category: "path_payment",
              amountXlm: amount,
              txHash,
              createdAt,
              from: account,
              to,
              successful,
            });
            const current = recipients.get(to) ?? { total: 0, count: 0 };
            recipients.set(to, {
              total: current.total + amount,
              count: current.count + 1,
            });
          }
        }
      } else if (type === "account_merge") {
        const destination = String(raw.into ?? "");
        let amount: number;
        try {
          amount = await fetchAccountMergeAmount(
            base,
            opId,
            destination,
            signal,
          );
        } catch (error) {
          if (signal.aborted) throw error;
          complete = false;
          const issue = `Account merge ${opId} amount unavailable: ${getErrorMessage(error)}`;
          warning = warning ? `${warning}; ${issue}` : issue;
          continue;
        }
        if (amount > 0 && raw.source_account === account) {
          outgoingLedger.push({
            id: `out-merge-${opId}`,
            direction: "outgoing",
            category: "account_merge",
            amountXlm: amount,
            txHash,
            createdAt,
            from: account,
            to: destination,
            successful,
          });
          const current = recipients.get(destination) ?? { total: 0, count: 0 };
          recipients.set(destination, {
            total: current.total + amount,
            count: current.count + 1,
          });
        }
        if (amount > 0 && raw.into === account) {
          const from = String(raw.source_account ?? "");
          incomingLedger.push({
            id: `in-merge-${opId}`,
            direction: "incoming",
            category: "account_merge",
            amountXlm: amount,
            txHash,
            createdAt,
            from,
            to: account,
            successful,
          });
          const current = senders.get(from) ?? { total: 0, count: 0 };
          senders.set(from, {
            total: current.total + amount,
            count: current.count + 1,
          });
        }
      }
    }

    onProgress?.({
      phase: "Scanning account operations…",
      pages,
      records: recordsSeen,
      hits: incomingLedger.length + outgoingLedger.length,
    });

    if (doneEarly || records.length < FETCH_LIMIT) break;
    cursor = String(records[records.length - 1].paging_token);
  }
  } catch (e) {
    if (!signal.aborted) {
      complete = false;
      warning = `Operation scan incomplete: ${getErrorMessage(e)}`;
    }
  }

  cursor = undefined;
  pages = 0;
  recordsSeen = 0;

  try {
  while (!signal.aborted) {
    const params = new URLSearchParams({
      order: "desc",
      limit: String(FETCH_LIMIT),
      include_failed: "true",
    });
    if (cursor) params.set("cursor", cursor);

    const data = await fetchJson(
      `${base}/accounts/${account}/transactions?${params.toString()}`,
      signal,
    );
    const records = (data._embedded?.records ?? []) as Record<
      string,
      unknown
    >[];
    pages += 1;
    recordsSeen += records.length;

    let doneEarly = false;
    for (const raw of records) {
      const feeTs = new Date(String(raw.created_at ?? "")).getTime();
      if (feeTs > toTs) continue;
      if (feeTs < fromTs) { doneEarly = true; break; }
      if (raw.fee_account !== account) continue;
      const fee = parseAmount(raw.fee_charged) / 10_000_000;
      if (fee <= 0) continue;
      outgoingLedger.push({
        id: `out-fee-${String(raw.hash ?? "")}`,
        direction: "outgoing",
        category: "fee",
        amountXlm: fee,
        txHash: String(raw.hash ?? ""),
        createdAt: String(raw.created_at ?? ""),
        from: account,
        to: "NETWORK_FEES",
        successful: (raw.successful as boolean) ?? true,
      });
      const current = recipients.get("NETWORK_FEES") ?? { total: 0, count: 0 };
      recipients.set("NETWORK_FEES", {
        total: current.total + fee,
        count: current.count + 1,
      });
    }

    onProgress?.({
      phase: "Scanning transaction fees…",
      pages,
      records: recordsSeen,
      hits: incomingLedger.length + outgoingLedger.length,
    });

    if (doneEarly || records.length < FETCH_LIMIT) break;
    cursor = String(records[records.length - 1].paging_token);
  }
  } catch (e) {
    if (!signal.aborted) {
      complete = false;
      warning = warning
        ? `${warning}; Fee scan incomplete: ${getErrorMessage(e)}`
        : `Fee scan incomplete: ${getErrorMessage(e)}`;
    }
  }

  const totalIncomingXlm = incomingLedger.reduce(
    (sum, row) => sum + row.amountXlm,
    0,
  );
  const totalOutgoingXlm = outgoingLedger.reduce(
    (sum, row) => sum + row.amountXlm,
    0,
  );

  // Compute totals from the FULL maps before slicing to top-N, so percentages
  // shown/exported aren't undercounted when there are >20 unique counterparties.
  const totalIncomingFromSendersXlm = [...senders.values()].reduce(
    (sum, entry) => sum + entry.total,
    0,
  );
  const totalOutgoingToRecipientsXlm = [...recipients.entries()]
    .filter(([address]) => address !== "NETWORK_FEES")
    .reduce((sum, [, entry]) => sum + entry.total, 0);

  const topSenders = [...senders.entries()]
    .map(([address, info]) => ({
      address,
      totalXlm: info.total,
      count: info.count,
    }))
    .sort((a, b) => b.totalXlm - a.totalXlm)
    .slice(0, 20);

  const topRecipients = [...recipients.entries()]
    .filter(([address]) => address !== "NETWORK_FEES")
    .map(([address, info]) => ({
      address,
      totalXlm: info.total,
      count: info.count,
    }))
    .sort((a, b) => b.totalXlm - a.totalXlm)
    .slice(0, 20);

  return {
    account,
    totalIncomingXlm,
    totalOutgoingXlm,
    totalIncomingFromSendersXlm,
    totalOutgoingToRecipientsXlm,
    netXlm: totalIncomingXlm - totalOutgoingXlm,
    topSenders,
    topRecipients,
    incomingLedger: sortByDateDesc(incomingLedger),
    outgoingLedger: sortByDateDesc(outgoingLedger),
    complete,
    warning,
  };
}
