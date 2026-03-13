import type {
  AddressInvestigationResult,
  AddressLedgerEntry,
  AssetProceedsResult,
  ProceedsLedgerEntry,
  ScanProgress,
} from "./types";

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
  const code = String(raw[`${prefix}_code`] ?? "").toUpperCase();
  const assetIssuer = String(raw[`${prefix}_issuer`] ?? "");
  return code === assetCode.toUpperCase() && assetIssuer === issuer;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(
  url: string,
  signal: AbortSignal,
): Promise<Record<string, any>> {
  const MAX_RETRIES = 4;
  let delay = 2000;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, { signal });
    if (res.status === 429 || res.status === 503) {
      if (attempt === MAX_RETRIES) {
        throw new Error(`Horizon rate limited (${res.status}) — try again later`);
      }
      const retryAfter = parseInt(res.headers.get("retry-after") ?? "0") * 1000;
      await sleep(retryAfter > 0 ? retryAfter : delay);
      delay = Math.min(delay * 2, 30_000);
      continue;
    }
    if (!res.ok) throw new Error(`Horizon request failed (${res.status})`);
    return (await res.json()) as Record<string, any>;
  }
  throw new Error("Max retries exceeded");
}

async function fetchAccountMergeAmount(
  horizonBase: string,
  operationId: string,
  destination: string | undefined,
  signal: AbortSignal,
): Promise<number> {
  try {
    const base = horizonBase.replace(/\/+$/, "");
    const data = await fetchJson(
      `${base}/operations/${operationId}/effects?limit=200`,
      signal,
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
  } catch {
    return 0;
  }
}

async function scanAccountDexAssetToXlm(
  horizonBase: string,
  account: string,
  assetCode: string,
  issuer: string,
  signal: AbortSignal,
  fromTs: number,
  toTs: number,
  onProgress?: (progress: ScanProgress) => void,
): Promise<{
  assetSold: number;
  xlmReceived: number;
  tradeCount: number;
  proceedsLedger: ProceedsLedgerEntry[];
}> {
  const base = horizonBase.replace(/\/+$/, "");
  let cursor: string | undefined;
  let pages = 0;
  let recordsSeen = 0;
  let assetSold = 0;
  let xlmReceived = 0;
  let tradeCount = 0;
  const proceedsLedger: ProceedsLedgerEntry[] = [];

  // Scan desc so we can stop early when we pass fromDate
  while (!signal.aborted) {
    const params = new URLSearchParams({
      account_id: account,
      limit: String(FETCH_LIMIT),
      order: "desc",
    });
    if (cursor) params.set("cursor", cursor);

    const data = await fetchJson(`${base}/trades?${params.toString()}`, signal);
    const records = (data._embedded?.records ?? []) as Record<
      string,
      unknown
    >[];
    pages += 1;
    recordsSeen += records.length;

    let doneEarly = false;
    for (const raw of records) {
      const ts = new Date(String(raw.ledger_close_time ?? "")).getTime();
      if (ts > toTs) continue;
      if (ts < fromTs) { doneEarly = true; break; }

      const isBase = raw.base_account === account;
      const assetIsBase =
        String(raw.base_asset_code ?? "").toUpperCase() ===
          assetCode.toUpperCase() && raw.base_asset_issuer === issuer;
      const assetIsCounter =
        String(raw.counter_asset_code ?? "").toUpperCase() ===
          assetCode.toUpperCase() && raw.counter_asset_issuer === issuer;
      const xlmIsBase = raw.base_asset_type === "native";
      const xlmIsCounter = raw.counter_asset_type === "native";

      let sold = 0;
      let received = 0;

      if (isBase && assetIsBase && xlmIsCounter) {
        sold = parseAmount(raw.base_amount);
        received = parseAmount(raw.counter_amount);
      } else if (!isBase && assetIsCounter && xlmIsBase) {
        sold = parseAmount(raw.counter_amount);
        received = parseAmount(raw.base_amount);
      }

      if (sold <= 0 || received < 0) continue;

      assetSold += sold;
      xlmReceived += received;
      tradeCount += 1;

      proceedsLedger.push({
        id: `dex-${raw.id ?? `${account}-${tradeCount}`}`,
        account,
        category: "dex_sale",
        amountXlm: received,
        assetSoldAmount: sold,
        txHash: `trade:${String(raw.id ?? "")}`,
        createdAt: String(raw.ledger_close_time ?? ""),
        from: account,
        successful: true,
      });
    }

    onProgress?.({
      phase: `Scanning DEX trades for ${account.slice(0, 6)}…`,
      pages,
      records: recordsSeen,
      hits: tradeCount,
    });

    if (doneEarly || records.length < FETCH_LIMIT) break;
    cursor = String(records[records.length - 1].paging_token);
  }

  return { assetSold, xlmReceived, tradeCount, proceedsLedger };
}

async function scanAccountOpsForProceedsAndOutflows(
  horizonBase: string,
  account: string,
  assetCode: string,
  issuer: string,
  signal: AbortSignal,
  fromTs: number,
  toTs: number,
  onProgress?: (progress: ScanProgress) => void,
): Promise<{
  pathAssetSold: number;
  pathXlmReceived: number;
  pathSaleCount: number;
  outgoingWithoutFees: number;
  proceedsLedger: ProceedsLedgerEntry[];
  outgoingLedger: ProceedsLedgerEntry[];
  destinationTotals: Map<string, { total: number; count: number }>;
}> {
  const base = horizonBase.replace(/\/+$/, "");
  let cursor: string | undefined;
  let pages = 0;
  let recordsSeen = 0;
  let hits = 0;

  let pathAssetSold = 0;
  let pathXlmReceived = 0;
  let pathSaleCount = 0;
  let outgoingWithoutFees = 0;

  const proceedsLedger: ProceedsLedgerEntry[] = [];
  const outgoingLedger: ProceedsLedgerEntry[] = [];
  const destinationTotals = new Map<string, { total: number; count: number }>();

  // Scan desc — newest first, stop when we pass fromDate
  while (!signal.aborted) {
    const params = new URLSearchParams({
      order: "desc",
      limit: String(FETCH_LIMIT),
    });
    if (cursor) params.set("cursor", cursor);

    const data = await fetchJson(
      `${base}/accounts/${account}/payments?${params.toString()}`,
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
      const ts = new Date(String(raw.created_at ?? "")).getTime();
      if (ts > toTs) continue;
      if (ts < fromTs) { doneEarly = true; break; }

      const type = String(raw.type ?? "");
      const opId = String(raw.id ?? "");
      const txHash = String(raw.transaction_hash ?? "");
      const createdAt = String(raw.created_at ?? "");
      const successful = (raw.transaction_successful as boolean) ?? true;

      if (
        (type === "path_payment_strict_send" ||
          type === "path_payment_strict_receive") &&
        raw.from === account &&
        isTargetAsset(raw, assetCode, issuer, "source_asset") &&
        isNativeAsset(raw)
      ) {
        const sold = parseAmount(raw.source_amount);
        const xlm = parseAmount(raw.amount);
        if (sold > 0) {
          pathAssetSold += sold;
          pathXlmReceived += xlm;
          pathSaleCount += 1;
          hits += 1;
          proceedsLedger.push({
            id: `path-sale-${opId}`,
            account,
            category: "path_sale",
            amountXlm: xlm,
            assetSoldAmount: sold,
            txHash,
            createdAt,
            from: String(raw.from ?? account),
            to: String(raw.to ?? ""),
            successful,
          });
        }
      }

      let outflowAmount = 0;
      let outflowCategory: ProceedsLedgerEntry["category"] | null = null;
      let to: string | undefined;
      let from: string | undefined;

      if (type === "payment" && raw.from === account && isNativeAsset(raw)) {
        outflowAmount = parseAmount(raw.amount);
        outflowCategory = "payment";
        from = String(raw.from ?? account);
        to = String(raw.to ?? "");
      } else if (type === "create_account" && raw.funder === account) {
        outflowAmount = parseAmount(raw.starting_balance);
        outflowCategory = "create_account";
        from = String(raw.funder ?? account);
        to = String(raw.account ?? "");
      } else if (
        (type === "path_payment_strict_send" ||
          type === "path_payment_strict_receive") &&
        raw.from === account &&
        isNativeAsset(raw, "source_asset")
      ) {
        outflowAmount = parseAmount(raw.source_amount);
        outflowCategory = "path_native_out";
        from = String(raw.from ?? account);
        to = String(raw.to ?? "");
      } else if (type === "account_merge" && raw.source_account === account) {
        const destination = String(raw.into ?? "");
        const mergeAmount = await fetchAccountMergeAmount(
          base,
          opId,
          destination,
          signal,
        );
        outflowAmount = mergeAmount;
        outflowCategory = "account_merge";
        from = String(raw.source_account ?? account);
        to = destination;
      }

      if (outflowCategory && outflowAmount > 0) {
        outgoingWithoutFees += outflowAmount;
        hits += 1;
        const entry: ProceedsLedgerEntry = {
          id: `${outflowCategory}-${opId}`,
          account,
          category: outflowCategory,
          amountXlm: outflowAmount,
          txHash,
          createdAt,
          from,
          to,
          successful,
        };
        outgoingLedger.push(entry);

        const destination = to?.trim();
        if (destination) {
          const current = destinationTotals.get(destination) ?? {
            total: 0,
            count: 0,
          };
          destinationTotals.set(destination, {
            total: current.total + outflowAmount,
            count: current.count + 1,
          });
        }
      }
    }

    onProgress?.({
      phase: `Scanning payments for ${account.slice(0, 6)}…`,
      pages,
      records: recordsSeen,
      hits,
    });

    if (doneEarly || records.length < FETCH_LIMIT) break;
    cursor = String(records[records.length - 1].paging_token);
  }

  return {
    pathAssetSold,
    pathXlmReceived,
    pathSaleCount,
    outgoingWithoutFees,
    proceedsLedger,
    outgoingLedger,
    destinationTotals,
  };
}

function sortByDateDesc<T extends { createdAt: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const ta = new Date(a.createdAt).getTime();
    const tb = new Date(b.createdAt).getTime();
    return tb - ta;
  });
}

export async function fetchAssetXlmProceeds(
  horizonBase: string,
  assetCode: string,
  issuer: string,
  accounts: string[],
  signal: AbortSignal,
  onProgress?: (progress: ScanProgress) => void,
  fromDate?: Date,
  toDate?: Date,
): Promise<AssetProceedsResult> {
  const accountList = [
    ...new Set(accounts.map((a) => a.trim()).filter(Boolean)),
  ];

  const fromTs = fromDate ? fromDate.getTime() : 0;
  const toTs = toDate ? toDate.getTime() : Date.now() + 86_400_000;

  let totalAssetSold = 0;
  let totalXlmProceeds = 0;
  let totalOutgoingXlm = 0;
  let dexTradeCount = 0;
  let pathSaleCount = 0;

  const proceedsLedger: ProceedsLedgerEntry[] = [];
  const outgoingLedger: ProceedsLedgerEntry[] = [];
  const destinationTotals = new Map<string, { total: number; count: number }>();

  for (const account of accountList) {
    if (signal.aborted) break;

    const dex = await scanAccountDexAssetToXlm(
      horizonBase,
      account,
      assetCode,
      issuer,
      signal,
      fromTs,
      toTs,
      onProgress,
    );
    totalAssetSold += dex.assetSold;
    totalXlmProceeds += dex.xlmReceived;
    dexTradeCount += dex.tradeCount;
    proceedsLedger.push(...dex.proceedsLedger);

    const ops = await scanAccountOpsForProceedsAndOutflows(
      horizonBase,
      account,
      assetCode,
      issuer,
      signal,
      fromTs,
      toTs,
      onProgress,
    );
    totalAssetSold += ops.pathAssetSold;
    totalXlmProceeds += ops.pathXlmReceived;
    pathSaleCount += ops.pathSaleCount;
    totalOutgoingXlm += ops.outgoingWithoutFees;
    proceedsLedger.push(...ops.proceedsLedger);
    outgoingLedger.push(...ops.outgoingLedger);

    for (const [destination, info] of ops.destinationTotals.entries()) {
      const current = destinationTotals.get(destination) ?? {
        total: 0,
        count: 0,
      };
      destinationTotals.set(destination, {
        total: current.total + info.total,
        count: current.count + info.count,
      });
    }
  }

  const topDestinations = [...destinationTotals.entries()]
    .map(([address, info]) => ({
      address,
      totalXlm: info.total,
      count: info.count,
    }))
    .sort((a, b) => b.totalXlm - a.totalXlm)
    .slice(0, 50);

  return {
    assetCode: assetCode.toUpperCase(),
    issuer,
    accounts: accountList,
    totalAssetSold,
    totalXlmProceeds,
    totalOutgoingXlm,
    estimatedOnHandXlm: totalXlmProceeds - totalOutgoingXlm,
    dexTradeCount,
    pathSaleCount,
    proceedsLedger: sortByDateDesc(proceedsLedger),
    outgoingLedger: sortByDateDesc(outgoingLedger),
    topDestinations,
  };
}

export async function fetchAddressInvestigation(
  horizonBase: string,
  account: string,
  signal: AbortSignal,
  onProgress?: (progress: ScanProgress) => void,
): Promise<AddressInvestigationResult> {
  const base = horizonBase.replace(/\/+$/, "");
  const incomingLedger: AddressLedgerEntry[] = [];
  const outgoingLedger: AddressLedgerEntry[] = [];
  const senders = new Map<string, { total: number; count: number }>();
  const recipients = new Map<string, { total: number; count: number }>();

  let cursor: string | undefined;
  let pages = 0;
  let recordsSeen = 0;

  while (!signal.aborted) {
    const params = new URLSearchParams({
      order: "asc",
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

    for (const raw of records) {
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
        const amount = await fetchAccountMergeAmount(
          base,
          opId,
          destination,
          signal,
        );
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

    if (records.length < FETCH_LIMIT) break;
    cursor = String(records[records.length - 1].paging_token);
  }

  cursor = undefined;
  pages = 0;
  recordsSeen = 0;

  while (!signal.aborted) {
    const params = new URLSearchParams({
      order: "asc",
      limit: String(FETCH_LIMIT),
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

    for (const raw of records) {
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

    if (records.length < FETCH_LIMIT) break;
    cursor = String(records[records.length - 1].paging_token);
  }

  const totalIncomingXlm = incomingLedger.reduce(
    (sum, row) => sum + row.amountXlm,
    0,
  );
  const totalOutgoingXlm = outgoingLedger.reduce(
    (sum, row) => sum + row.amountXlm,
    0,
  );

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

  const totalOutgoingToRecipientsXlm = topRecipients.reduce(
    (sum, row) => sum + row.totalXlm,
    0,
  );

  return {
    account,
    totalIncomingXlm,
    totalOutgoingXlm,
    totalOutgoingToRecipientsXlm,
    netXlm: totalIncomingXlm - totalOutgoingXlm,
    topSenders,
    topRecipients,
    incomingLedger: sortByDateDesc(incomingLedger),
    outgoingLedger: sortByDateDesc(outgoingLedger),
  };
}
