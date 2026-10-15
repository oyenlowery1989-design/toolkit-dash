import { Horizon, Asset } from "stellar-sdk";
import { fetchJson } from "../horizon-fetch";
import { authHeaders, waitForAuth } from "@/lib/db-client";
import { resolveAssetToXlmTrade } from "@/lib/trade-helpers";
import type {
  DistributionEvidence,
  Holder,
  DistribCandidate,
  IssuerInfo,
  PaymentTotals,
  ClaimableBalanceSummary,
  AssetXlmTradeSummary,
  AccountTradeSummary,
  PriceBucket,
} from "./types";

// ---------------------------------------------------------------------------
// Price histogram helper
// ---------------------------------------------------------------------------

interface RawTrade {
  price: number;
  assetSold: number;
  xlmReceived: number;
}

function computePriceBuckets(
  trades: RawTrade[],
  numBuckets = 10,
): PriceBucket[] {
  if (trades.length === 0) return [];

  const prices = trades.map((t) => t.price).filter((p) => p > 0);
  if (prices.length === 0) return [];

  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);

  // If all trades are at the same price, one bucket
  if (minP === maxP) {
    return [
      {
        priceFrom: minP,
        priceTo: maxP,
        assetSold: trades.reduce((s, t) => s + t.assetSold, 0),
        xlmReceived: trades.reduce((s, t) => s + t.xlmReceived, 0),
        count: trades.length,
      },
    ];
  }

  const step = (maxP - minP) / numBuckets;
  const buckets: PriceBucket[] = Array.from({ length: numBuckets }, (_, i) => ({
    priceFrom: minP + i * step,
    priceTo: minP + (i + 1) * step,
    assetSold: 0,
    xlmReceived: 0,
    count: 0,
  }));

  for (const t of trades) {
    if (t.price <= 0) continue;
    const idx = Math.min(
      Math.floor(((t.price - minP) / (maxP - minP)) * numBuckets),
      numBuckets - 1,
    );
    buckets[idx].assetSold += t.assetSold;
    buckets[idx].xlmReceived += t.xlmReceived;
    buckets[idx].count++;
  }

  return buckets.filter((b) => b.count > 0);
}

export const FETCH_PAGE_SIZE = 200;

// ---------------------------------------------------------------------------
// Creator
// ---------------------------------------------------------------------------

export async function fetchAccountCreator(
  server: Horizon.Server,
  address: string,
  signal: AbortSignal,
): Promise<string | null> {
  try {
    let page = await server
      .operations()
      .forAccount(address)
      .order("asc")
      .limit(200)
      .call();

    for (let pageIndex = 0; pageIndex < 8; pageIndex++) {
      if (signal.aborted) return null;

      for (const rawOp of page.records) {
        if (signal.aborted) return null;
        const op = rawOp as unknown as Record<string, unknown>;
        // Only return on an exact create_account match for this address.
        // Never use heuristic fallback — it returns wrong data (e.g. first payment sender).
        if (op.type === "create_account" && op.account === address) {
          return (
            (op.funder as string | undefined) ??
            (op.source_account as string | undefined) ??
            null
          );
        }
      }

      if (page.records.length === 0 || pageIndex === 7) break;
      page = await page.next();
    }

    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Issuer info
// ---------------------------------------------------------------------------

export async function fetchIssuerInfo(
  server: Horizon.Server,
  issuer: string,
  signal: AbortSignal,
): Promise<IssuerInfo> {
  const [account, createdBy] = await Promise.all([
    server.loadAccount(issuer),
    fetchAccountCreator(server, issuer, signal),
  ]);
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");

  const nativeBal = account.balances.find((b) => b.asset_type === "native");
  const raw = account as unknown as Record<string, unknown>;
  const flags = (raw.flags ?? {}) as Record<string, boolean>;

  return {
    homeDomain: (raw.home_domain as string | undefined) || undefined,
    xlmBalance: nativeBal ? nativeBal.balance : "0",
    authRequired: !!flags.auth_required,
    authRevocable: !!flags.auth_revocable,
    authClawbackEnabled: !!flags.auth_clawback_enabled,
    authImmutable: !!flags.auth_immutable,
    createdBy: createdBy ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Full holder crawl
// ---------------------------------------------------------------------------

export async function fetchAllHolders(
  server: Horizon.Server,
  asset: Asset,
  assetCode: string,
  issuerAddress: string,
  signal: AbortSignal,
  onProgress: (count: number, page: number) => void,
): Promise<Holder[]> {
  const all: Holder[] = [];
  let cursor: string | null = null;
  let page = 0;

  while (true) {
    if (signal.aborted) break;
    let query = server.accounts().forAsset(asset).limit(FETCH_PAGE_SIZE);
    if (cursor) query = query.cursor(cursor);
    const response = await query.call();
    if (signal.aborted) break;
    if (response.records.length === 0) break;

    for (const record of response.records) {
      const balanceLine = record.balances.find((b) => {
        if ("asset_code" in b && "asset_issuer" in b) {
          return b.asset_code === assetCode && b.asset_issuer === issuerAddress;
        }
        return false;
      });
      const balance =
        balanceLine && "balance" in balanceLine ? balanceLine.balance : "0";
      const limit =
        balanceLine && "limit" in balanceLine ? balanceLine.limit : undefined;
      all.push({
        id: record.id,
        balance,
        limit,
        homeDomain: (record as unknown as Record<string, unknown>)
          .home_domain as string | undefined,
      });
    }

    page++;
    onProgress(all.length, page);
    if (response.records.length < FETCH_PAGE_SIZE) break;
    cursor = response.records[response.records.length - 1].paging_token;
  }

  return all;
}

// ---------------------------------------------------------------------------
// Distribution address inference
// ---------------------------------------------------------------------------

export async function inferDistributionAddresses(
  server: Horizon.Server,
  assetCode: string,
  issuer: string,
  fullHolders: Holder[],
  signal: AbortSignal,
): Promise<DistribCandidate[]> {
  const candidates = new Map<string, { reasons: string[]; score: number }>();

  // Heuristic 1: Top 3 holders by balance share (low weight — tiebreaker only)
  // A top holder is often a buyer/market maker, NOT the distribution address.
  // The definitive signal is issuer outgoing payments (heuristic 2 below).
  const totalBalance = fullHolders.reduce(
    (sum, h) => sum + parseFloat(h.balance),
    0,
  );
  const sortedHolders = [...fullHolders].sort(
    (a, b) => parseFloat(b.balance) - parseFloat(a.balance),
  );
  let topUsed = 0;
  for (const h of sortedHolders) {
    if (topUsed >= 3) break;
    if (h.id === issuer) continue;
    const bal = parseFloat(h.balance);
    if (bal <= 0) break;
    const pct =
      totalBalance > 0 ? ((bal / totalBalance) * 100).toFixed(2) : "?";
    const rank = topUsed + 1;
    const reason = `#${rank} holder by balance — holds ${Number(h.balance).toLocaleString()} ${assetCode} (${pct}% of total held)`;
    const existing = candidates.get(h.id);
    const rankScore = rank === 1 ? 1 : 0; // low weight — just a tiebreaker
    if (existing) {
      existing.reasons.push(reason);
      existing.score += rankScore;
    } else {
      candidates.set(h.id, { reasons: [reason], score: rankScore });
    }
    topUsed++;
  }

  // Heuristic 2: Issuer outgoing asset payments (full deep scan)
  const paymentTotals = new Map<string, { amount: number; count: number }>();
  let opCursor: string | undefined;
  try {
    while (!signal.aborted) {
      const q = opCursor
        ? server.operations().forAccount(issuer).limit(200).cursor(opCursor)
        : server.operations().forAccount(issuer).limit(200);
      const opPage = await q.call();
      if (signal.aborted) break;

      for (const op of opPage.records) {
        const isPaymentType =
          op.type === "payment" ||
          op.type === "path_payment_strict_send" ||
          op.type === "path_payment_strict_receive";
        if (!isPaymentType) continue;
        const typedOp = op as unknown as Record<string, unknown>;
        if (
          (typedOp.asset_code as string | undefined)?.toUpperCase() !==
            assetCode.toUpperCase() ||
          typedOp.asset_issuer !== issuer
        )
          continue;
        const to = typedOp.to as string | undefined;
        if (!to || to === issuer) continue;
        const amount = parseFloat((typedOp.amount as string) ?? "0");
        const existing = paymentTotals.get(to) ?? { amount: 0, count: 0 };
        paymentTotals.set(to, {
          amount: existing.amount + amount,
          count: existing.count + 1,
        });
      }

      if (opPage.records.length < 200) break;
      opCursor = opPage.records[opPage.records.length - 1].paging_token;
    }
  } catch {
    // Partial results are acceptable
  }

  const paymentRanked = [...paymentTotals.entries()]
    .sort((a, b) => b[1].amount - a[1].amount)
    .slice(0, 5);

  let payRank = 1;
  for (const [addr, info] of paymentRanked) {
    if (addr === issuer) continue;
    const reason = `Received ${Number(info.amount).toLocaleString()} ${assetCode} from issuer across ${info.count} payment${info.count !== 1 ? "s" : ""} (rank #${payRank} by amount)`;
    const rankScore = payRank === 1 ? 4 : payRank === 2 ? 2 : 1;
    const existing = candidates.get(addr);
    if (existing) {
      existing.reasons.push(reason);
      existing.score += rankScore;
    } else {
      candidates.set(addr, { reasons: [reason], score: rankScore });
    }
    payRank++;
  }

  return [...candidates.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 5)
    .map(([address, { reasons, score }]) => ({
      address,
      reasons,
      // Score breakdown: holder rank#1=1, payment rank#1=4, rank#2=2, rank#3+=1
      // Max possible = 5 (top holder + top payment recipient) → high
      // 4 = top payment recipient only → high
      // 2-3 = secondary signals → medium
      confidence:
        score >= 4 ? "high" : score >= 2 ? "medium" : ("low" as const),
    }));
}

// ---------------------------------------------------------------------------
// Lightweight distribution inference (no full holder crawl required)
// ---------------------------------------------------------------------------

/** Rank issuer-funded recipients, following only proven claimable-balance receipts. */
export async function inferDistribLite(
  horizonUrl: string,
  assetCode: string,
  issuer: string,
  signal: AbortSignal,
  onLog?: (message: string) => void,
): Promise<{ address: string; score: number; reason: string; evidence?: DistributionEvidence[] }[]> {
  const horizonBase = horizonUrl.replace(/\/$/, "");
  type RecordData = Record<string, unknown>;
  type Receipt = { amount: number; cursor?: string };
  type Funding = { amount: number; count: number; cursor?: string; claimed: boolean; evidence: DistributionEvidence[]; receipts: Receipt[]; forwarded: number };
  const totals = new Map<string, Funding>();
  const metadata = (op: RecordData) => ({
    ...(typeof op.transaction_hash === "string" ? { transactionHash: op.transaction_hash } : {}),
    ...(typeof op.created_at === "string" ? { createdAt: op.created_at } : {}),
  });
  const operationId = (op: RecordData) => {
    const id = op.id ?? op.paging_token;
    if (typeof id !== "string") throw new Error("Missing distribution operation ID. Enter seller accounts manually.");
    return id;
  };
  const before = (a: string | undefined, b: string | undefined) => {
    if (!a || !b || !/^\d+$/.test(a) || !/^\d+$/.test(b)) {
      throw new Error("Distribution history cannot prove operation order. Enter seller accounts manually.");
    }
    return BigInt(a) < BigInt(b);
  };
  const readRecords = async (path: string, firstCursor?: string, pageLimit = 20) => {
    const records: RecordData[] = [];
    let cursor = firstCursor;
    const cursors = new Set<string>(cursor ? [cursor] : []);
    for (let page = 0; page < pageLimit; page++) {
      signal.throwIfAborted();
      const params = new URLSearchParams({ limit: "200", order: "asc" });
      if (cursor) params.set("cursor", cursor);
      const url = `${horizonBase}${path}?${params}`;
      onLog?.(`  GET ${url}`);
      const data = await fetchJson(url, signal, { onLog });
      signal.throwIfAborted();
      const batch: RecordData[] = data._embedded?.records;
      if (!Array.isArray(batch)) throw new Error("Distributor inference history is incomplete. Enter seller accounts manually.");
      records.push(...batch);
      if (batch.length < 200) return records;
      const next = batch[batch.length - 1].paging_token;
      if (typeof next !== "string" || cursors.has(next)) break;
      cursors.add(next);
      cursor = next;
    }
    throw new Error("Distributor inference history limit reached. Enter seller accounts manually.");
  };

  const payments = await readRecords(`/accounts/${encodeURIComponent(issuer)}/payments`, undefined, Infinity);
  for (const op of payments) {
    if (!["payment", "path_payment_strict_send", "path_payment_strict_receive"].includes(String(op.type))) continue;
    if (op.transaction_successful === false || op.from !== issuer) continue;
    if (op.asset_code !== assetCode || op.asset_issuer !== issuer) continue;
    const to = op.to;
    const amount = Number(op.amount);
    if (typeof to !== "string" || to === issuer || !Number.isFinite(amount) || amount <= 0) continue;
    const existing = totals.get(to);
    totals.set(to, {
      amount: (existing?.amount ?? 0) + amount,
      count: (existing?.count ?? 0) + 1,
      cursor: existing?.cursor ?? (typeof op.paging_token === "string" ? op.paging_token : undefined),
      claimed: false,
      evidence: [...(existing?.evidence ?? []), { kind: "issuer_payment", from: issuer, to,
        amount: String(op.amount), operationId: operationId(op), ...metadata(op) }],
      receipts: [...(existing?.receipts ?? []), { amount, cursor: typeof op.paging_token === "string" ? op.paging_token : undefined }],
      forwarded: 0,
    });
  }

  // shortcut: trace at most twenty funded accounts and three claim hops; wider or deeper routes require manual sellers.
  if (totals.size > 20) throw new Error("Distributor inference account limit reached. Enter seller accounts manually.");
  const queue = [{ address: issuer, depth: -1 }, ...[...totals.entries()]
    .sort((a, b) => b[1].amount - a[1].amount).map(([address]) => ({ address, depth: 0 }))];
  const visited = new Set<string>();
  const seenBalances = new Set<string>();
  for (let index = 0; index < queue.length; index++) {
    signal.throwIfAborted();
    const { address, depth } = queue[index];
    if (visited.has(address)) continue;
    if (visited.size >= 21) throw new Error("Distributor inference account limit reached. Enter seller accounts manually.");
    visited.add(address);
    const info = address === issuer
      ? { amount: Infinity, count: 0, claimed: false, evidence: [], receipts: [], forwarded: 0 } as Funding
      : totals.get(address)!;
    const operations = await readRecords(`/accounts/${encodeURIComponent(address)}/operations`, info.cursor);
    for (const op of operations) {
      if (op.type !== "create_claimable_balance" || op.transaction_successful === false) continue;
      if (op.source_account !== address || op.asset !== `${assetCode}:${issuer}`) continue;
      const amount = Number(op.amount);
      if (!Number.isFinite(amount) || amount <= 0 || info.amount <= 0) continue;
      if (typeof op.id !== "string") throw new Error("Missing claimable-balance creation ID. Enter seller accounts manually.");
      // Creation operations omit balance_id; the successful creation effect proves it.
      const effects = await readRecords(`/operations/${encodeURIComponent(op.id)}/effects`);
      const effect = effects.find(e => e.type === "claimable_balance_created"
        && e.account === address && e.asset === op.asset && Number(e.amount) === amount);
      if (typeof effect?.balance_id !== "string") {
        throw new Error("Claimable-balance creation history is incomplete. Enter seller accounts manually.");
      }
      const balanceId = effect.balance_id;
      if (seenBalances.has(balanceId)) continue;
      seenBalances.add(balanceId);
      const history = await readRecords(`/claimable_balances/${encodeURIComponent(balanceId)}/operations`);
      if (!history.some(ref => ref.type === "create_claimable_balance" && ref.id === op.id && ref.source_account === address
        && ref.asset === op.asset && Number(ref.amount) === amount && ref.transaction_successful === true)) {
        throw new Error("Claimable-balance history does not prove its creation. Enter seller accounts manually.");
      }
      const claim = history.find(ref => ref.type === "claim_claimable_balance" && ref.balance_id === balanceId && ref.transaction_successful === true
        && (ref.source_account === undefined || ref.source_account === ref.claimant));
      if (!claim || typeof claim.claimant !== "string" || claim.claimant === address || claim.claimant === issuer) continue;
      if (history.some(ref => ref.type === "clawback_claimable_balance" && ref.transaction_successful === true)) continue;
      const claimants = op.claimants as { destination?: string }[] | undefined;
      if (!claimants?.some(c => c.destination === claim.claimant)) continue;
      if (!before(typeof op.paging_token === "string" ? op.paging_token : op.id,
        typeof claim.paging_token === "string" ? claim.paging_token : operationId(claim))) {
        throw new Error("Claimable-balance history cannot prove claim order. Enter seller accounts manually.");
      }
      const available = address === issuer ? Infinity : info.receipts
        .filter(receipt => before(receipt.cursor, typeof op.paging_token === "string" ? op.paging_token : op.id as string))
        .reduce((sum, receipt) => sum + receipt.amount, 0) - info.forwarded;
      const transferred = Math.min(amount, info.amount, Math.max(0, available));
      if (transferred <= 0) continue;
      if (depth >= 3 || visited.has(claim.claimant)) {
        throw new Error("Distributor inference reached a claim hop limit, cycle or converging route. Enter seller accounts manually.");
      }
      info.amount -= transferred;
      info.forwarded += transferred;
      const recipient = totals.get(claim.claimant);
      totals.set(claim.claimant, {
        amount: (recipient?.amount ?? 0) + transferred,
        count: (recipient?.count ?? 0) + 1,
        cursor: recipient?.cursor && before(recipient.cursor, claim.paging_token as string)
          ? recipient.cursor : typeof claim.paging_token === "string" ? claim.paging_token : undefined,
        claimed: true,
        evidence: [...(recipient?.evidence ?? []), ...info.evidence.filter(evidence => before(
          evidence.kind === "claimable_balance" ? evidence.claimOperationId : evidence.operationId,
          typeof op.paging_token === "string" ? op.paging_token : op.id as string,
        )), {
          kind: "claimable_balance", from: address, to: claim.claimant, amount: String(op.amount),
          ...(transferred < amount ? { attributedAmount: String(transferred) } : {}),
          operationId: op.id, ...metadata(op), balanceId, claimOperationId: operationId(claim),
          ...(typeof claim.transaction_hash === "string" ? { claimTransactionHash: claim.transaction_hash } : {}),
          ...(typeof claim.created_at === "string" ? { claimCreatedAt: claim.created_at } : {}),
        }],
        receipts: [...(recipient?.receipts ?? []), { amount: transferred, cursor: typeof claim.paging_token === "string" ? claim.paging_token : undefined }],
        forwarded: recipient?.forwarded ?? 0,
      });
      if (totals.size > 20) throw new Error("Distributor inference account limit reached. Enter seller accounts manually.");
      queue.push({ address: claim.claimant, depth: depth + 1 });
    }
  }
  signal.throwIfAborted();
  const ranked = [...totals.entries()]
    .sort((a, b) => b[1].amount - a[1].amount);
  return ranked.map(([address, info], i) => ({
    address,
    score: ranked.length - i,
    evidence: [...new Map(info.evidence.map(item => [`${item.kind}:${item.operationId}:${item.to}`, item])).values()],
    reason: info.amount === 0
      ? `Issuer-funded recipient forwarded its attributed amount; historical sales still require checking; retained Horizon history only`
      : info.claimed
      ? `Verified claim recipient of up to ${info.amount.toLocaleString()} ${assetCode} from issuer-funded distribution; retained Horizon history only`
      : `Remaining issuer-funded amount: ${info.amount.toLocaleString()} ${assetCode} across ${info.count} direct payment${info.count !== 1 ? "s" : ""}; retained Horizon history only`,
  }));
}

// ---------------------------------------------------------------------------
// On-demand: payment totals
// ---------------------------------------------------------------------------

export async function fetchPaymentTotals(
  server: Horizon.Server,
  issuerAddress: string,
  assetCode: string,
  trackedAddresses: string[],
  signal: AbortSignal,
): Promise<PaymentTotals> {
  const totalsMap = new Map<string, { total: number; count: number }>();
  let cursor: string | undefined;

  while (!signal.aborted) {
    const q = cursor
      ? server.payments().forAccount(issuerAddress).limit(200).cursor(cursor)
      : server.payments().forAccount(issuerAddress).limit(200);
    const page = await q.call();
    if (signal.aborted) break;

    for (const op of page.records) {
      const raw = op as unknown as Record<string, unknown>;
      const isOut =
        (op.type === "payment" ||
          op.type === "path_payment_strict_send" ||
          op.type === "path_payment_strict_receive") &&
        raw.from === issuerAddress;
      if (!isOut) continue;
      if (
        String(raw.asset_code ?? "").toUpperCase() !== assetCode.toUpperCase() ||
        raw.asset_issuer !== issuerAddress
      )
        continue;
      const to = raw.to as string;
      if (!to || to === issuerAddress) continue;
      const amount = parseFloat((raw.amount as string) ?? "0");
      const existing = totalsMap.get(to) ?? { total: 0, count: 0 };
      totalsMap.set(to, {
        total: existing.total + amount,
        count: existing.count + 1,
      });
    }

    if (page.records.length < 200) break;
    cursor = page.records[page.records.length - 1].paging_token;
  }

  const trackedSet = new Set(trackedAddresses);
  let totalSentByIssuer = 0;
  let otherTotal = 0;
  let otherCount = 0;
  const byAddress: { address: string; total: number; count: number }[] = [];

  for (const [addr, info] of totalsMap) {
    totalSentByIssuer += info.total;
    if (trackedSet.has(addr)) {
      byAddress.push({ address: addr, total: info.total, count: info.count });
    } else {
      otherTotal += info.total;
      otherCount += info.count;
    }
  }

  byAddress.sort((a, b) => b.total - a.total);
  return { totalSentByIssuer, byAddress, otherTotal, otherCount };
}

// ---------------------------------------------------------------------------
// On-demand: DEX trades — asset sold for XLM
//
// Strategy:
//   1. Scan the full ASSET/XLM trade pair (base=ASSET, counter=XLM) for
//      overall volume. Each record: base_amount = ASSET sold, counter_amount
//      = XLM received.
//   2. For each tracked address (distrib candidates), scan their personal
//      trade history and filter to this asset/XLM pair — gives exact per-
//      account breakdown regardless of which side of the trade they were on.
// ---------------------------------------------------------------------------

interface SellerAccum {
  assetSold: number;
  xlmReceived: number;
  count: number;
  rawTrades: RawTrade[];
}

async function scanTradePair(
  horizonBase: string,
  assetCode: string,
  issuerAddress: string,
  signal: AbortSignal,
  onProgress?: (count: number) => void,
): Promise<{
  assetSold: number;
  xlmReceived: number;
  tradeCount: number;
  rawTrades: RawTrade[];
  sellerMap: Map<string, SellerAccum>;
}> {
  let assetSold = 0;
  let xlmReceived = 0;
  let tradeCount = 0;
  const rawTrades: RawTrade[] = [];
  const sellerMap = new Map<string, SellerAccum>();
  // Deduplicate by trade ID — Horizon may return the same trade in both
  // direction queries (base=ASSET/counter=XLM and base=XLM/counter=ASSET)
  // with swapped fields, which would cause 2× counting without this guard.
  const seenIds = new Set<string>();
  let cursor: string | undefined;

  const assetType =
    assetCode.length <= 4 ? "credit_alphanum4" : "credit_alphanum12";

  function accumulateSeller(address: string, sold: number, received: number) {
    const existing = sellerMap.get(address) ?? {
      assetSold: 0,
      xlmReceived: 0,
      count: 0,
      rawTrades: [],
    };
    existing.assetSold += sold;
    existing.xlmReceived += received;
    existing.count++;
    if (sold > 0)
      existing.rawTrades.push({
        price: received / sold,
        assetSold: sold,
        xlmReceived: received,
      });
    sellerMap.set(address, existing);
  }

  // Direction 1: ASSET is base, XLM is counter — base_account is the seller
  while (!signal.aborted) {
    const params = new URLSearchParams({
      base_asset_type: assetType,
      base_asset_code: assetCode,
      base_asset_issuer: issuerAddress,
      counter_asset_type: "native",
      limit: "200",
      order: "asc",
    });
    if (cursor) params.set("cursor", cursor);

    const data: any = await fetchJson(`${horizonBase}/trades?${params}`, signal);
    const records: Record<string, unknown>[] = data._embedded?.records ?? [];

    for (const r of records) {
      const id = r.id as string | undefined;
      if (id) {
        if (seenIds.has(id)) continue;
        seenIds.add(id);
      }
      const sold = parseFloat((r.base_amount as string) ?? "0");
      const received = parseFloat((r.counter_amount as string) ?? "0");
      assetSold += sold;
      xlmReceived += received;
      tradeCount++;
      if (sold > 0)
        rawTrades.push({
          price: received / sold,
          assetSold: sold,
          xlmReceived: received,
        });
      const sellerAddr = r.base_account as string | undefined;
      if (sellerAddr) accumulateSeller(sellerAddr, sold, received);
    }

    onProgress?.(tradeCount);
    if (records.length < 200) break;
    cursor = records[records.length - 1].paging_token as string;
  }

  // Direction 2: XLM is base, ASSET is counter — counter_account is the seller
  cursor = undefined;
  while (!signal.aborted) {
    const params = new URLSearchParams({
      base_asset_type: "native",
      counter_asset_type: assetType,
      counter_asset_code: assetCode,
      counter_asset_issuer: issuerAddress,
      limit: "200",
      order: "asc",
    });
    if (cursor) params.set("cursor", cursor);

    const data: any = await fetchJson(`${horizonBase}/trades?${params}`, signal);
    const records: Record<string, unknown>[] = data._embedded?.records ?? [];

    for (const r of records) {
      const id = r.id as string | undefined;
      if (id) {
        if (seenIds.has(id)) continue;
        seenIds.add(id);
      }
      const sold = parseFloat((r.counter_amount as string) ?? "0");
      const received = parseFloat((r.base_amount as string) ?? "0");
      assetSold += sold;
      xlmReceived += received;
      tradeCount++;
      if (sold > 0)
        rawTrades.push({
          price: received / sold,
          assetSold: sold,
          xlmReceived: received,
        });
      const sellerAddr = r.counter_account as string | undefined;
      if (sellerAddr) accumulateSeller(sellerAddr, sold, received);
    }

    onProgress?.(tradeCount);
    if (records.length < 200) break;
    cursor = records[records.length - 1].paging_token as string;
  }

  return { assetSold, xlmReceived, tradeCount, rawTrades, sellerMap };
}

/**
 * Scan a single account's trades and return exactly what they sold for XLM.
 * More accurate than the global pair scan for per-account attribution because
 * it filters by account_id — no direction ambiguity, no risk of double-count.
 */
async function scanAccountTrades(
  horizonBase: string,
  address: string,
  assetCode: string,
  issuerAddress: string,
  signal: AbortSignal,
): Promise<{
  assetSold: number;
  xlmReceived: number;
  tradeCount: number;
  rawTrades: RawTrade[];
}> {
  let assetSold = 0;
  let xlmReceived = 0;
  let tradeCount = 0;
  const rawTrades: RawTrade[] = [];
  let cursor: string | undefined;

  while (!signal.aborted) {
    const params = new URLSearchParams({
      account_id: address,
      limit: "200",
      order: "asc",
    });
    if (cursor) params.set("cursor", cursor);
    const data: any = await fetchJson(`${horizonBase}/trades?${params}`, signal);
    const records: Record<string, unknown>[] = data._embedded?.records ?? [];

    for (const r of records) {
      const trade = resolveAssetToXlmTrade(r, address, assetCode, issuerAddress);
      if (trade && trade.sold > 0) {
        assetSold += trade.sold;
        xlmReceived += trade.received;
        tradeCount++;
        rawTrades.push({
          price: trade.received / trade.sold,
          assetSold: trade.sold,
          xlmReceived: trade.received,
        });
      }
    }

    if (records.length < 200) break;
    cursor = records[records.length - 1].paging_token as string;
  }

  return { assetSold, xlmReceived, tradeCount, rawTrades };
}

/** Fetch the total amount of assetCode currently listed in open sell offers for an address. */
async function fetchOpenOfferAmount(
  horizonBase: string,
  address: string,
  assetCode: string,
  issuerAddress: string,
  signal: AbortSignal,
): Promise<number> {
  const assetType =
    assetCode.length <= 4 ? "credit_alphanum4" : "credit_alphanum12";
  let total = 0;
  let cursor: string | undefined;
  while (!signal.aborted) {
    const params = new URLSearchParams({
      seller: address,
      selling_asset_type: assetType,
      selling_asset_code: assetCode,
      selling_asset_issuer: issuerAddress,
      limit: "200",
    });
    if (cursor) params.set("cursor", cursor);
    const data: any = await fetchJson(`${horizonBase}/offers?${params}`, signal);
    const records: Record<string, unknown>[] = data._embedded?.records ?? [];
    for (const r of records) {
      total += parseFloat((r.amount as string) ?? "0");
    }
    if (records.length < 200) break;
    cursor = records[records.length - 1].paging_token as string;
  }
  return total;
}

export async function fetchAssetXlmTrades(
  horizonBase: string,
  assetCode: string,
  issuerAddress: string,
  trackedAddresses: string[],
  signal: AbortSignal,
  onProgress?: (tradeCount: number) => void,
): Promise<AssetXlmTradeSummary> {
  const { assetSold, xlmReceived, tradeCount, rawTrades, sellerMap } =
    await scanTradePair(
      horizonBase,
      assetCode,
      issuerAddress,
      signal,
      onProgress,
    );

  const trackedSet = new Set(trackedAddresses);

  // Per-distrib: scan each account's trades directly — accurate, no direction ambiguity.
  // Open offers: fetch in parallel alongside account scans.
  const [accountResults, openOfferAmounts] = await Promise.all([
    Promise.all(
      trackedAddresses.map((addr) =>
        scanAccountTrades(horizonBase, addr, assetCode, issuerAddress, signal),
      ),
    ),
    Promise.all(
      trackedAddresses.map((addr) =>
        fetchOpenOfferAmount(
          horizonBase,
          addr,
          assetCode,
          issuerAddress,
          signal,
        ),
      ),
    ),
  ]);

  const byAccount: AccountTradeSummary[] = [];
  for (let i = 0; i < trackedAddresses.length; i++) {
    const addr = trackedAddresses[i];
    const acc = accountResults[i];
    const open = openOfferAmounts[i];
    if (acc.tradeCount === 0 && open === 0) continue;
    byAccount.push({
      address: addr,
      assetSold: acc.assetSold,
      xlmReceived: acc.xlmReceived,
      tradeCount: acc.tradeCount,
      avgPrice: acc.assetSold > 0 ? acc.xlmReceived / acc.assetSold : 0,
      priceBuckets: computePriceBuckets(acc.rawTrades),
      openOfferAmount: open > 0 ? open : undefined,
    });
  }

  // otherSellers: non-tracked sellers from the global pair scan sellerMap
  const otherSellers: AccountTradeSummary[] = [...sellerMap.entries()]
    .filter(([addr]) => !trackedSet.has(addr))
    .map(([addr, acc]) => ({
      address: addr,
      assetSold: acc.assetSold,
      xlmReceived: acc.xlmReceived,
      tradeCount: acc.count,
      avgPrice: acc.assetSold > 0 ? acc.xlmReceived / acc.assetSold : 0,
      priceBuckets: computePriceBuckets(acc.rawTrades),
    }))
    .sort((a, b) => b.assetSold - a.assetSold);

  return {
    totalAssetSold: assetSold,
    totalXlmReceived: xlmReceived,
    tradeCount,
    avgPrice: assetSold > 0 ? xlmReceived / assetSold : 0,
    priceBuckets: computePriceBuckets(rawTrades),
    byAccount,
    otherSellers,
  };
}

// ---------------------------------------------------------------------------
// On-demand: claimable balances
// ---------------------------------------------------------------------------

export async function fetchClaimableBalances(
  _server: Horizon.Server,
  assetCode: string,
  issuerAddress: string,
  signal: AbortSignal,
): Promise<ClaimableBalanceSummary> {
  const assetParam = `${assetCode}:${issuerAddress}`;
  let count = 0;
  let totalAmount = 0;
  let cursor: string | undefined;

  await waitForAuth();

  while (!signal.aborted) {
    const url = `/api/horizon/claimable_balances?asset=${encodeURIComponent(assetParam)}&limit=200${cursor ? `&cursor=${cursor}` : ""}`;
    const data = await fetchJson(url, signal, { headers: authHeaders() });
    const records = data._embedded?.records ?? [];
    for (const r of records) {
      count++;
      totalAmount += parseFloat(r.amount ?? "0");
    }
    if (records.length < 200) break;
    cursor = records[records.length - 1].paging_token;
  }

  return { count, totalAmount };
}
