import { fetchJson } from "@/lib/horizon-fetch";

export type BuyerWindow = "7d" | "30d" | "all";
export interface VerifiedBuyerEvidence {
  id: string; operationId: string; txHash: string; createdAt: string;
  xlmSpent: string; assetBought: string; recipient?: string;
}
export interface VerifiedBuyer {
  address: string; xlmSpent: string; assetBought: string; averagePrice: number;
  purchaseCount: number; firstPurchase: string; latestPurchase: string; evidence: VerifiedBuyerEvidence[];
}
export interface TopBuyersResult {
  buyers: VerifiedBuyer[]; checkedAt: string; requestedFrom: string | null; requestedTo: string;
  oldestObserved?: string; newestObserved?: string; warnings: string[];
  skippedRecords: number; tradesScanned: number;
}
type RecordData = Record<string, any>;
const UNIT = BigInt(10000000);
function units(value: unknown): bigint {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,7})?$/.test(value)) throw new Error("Invalid trade amount");
  const [whole, fraction = ""] = value.split(".");
  const result = BigInt(whole) * UNIT + BigInt(fraction.padEnd(7, "0"));
  if (result <= BigInt(0) || result > BigInt("9223372036854775807")) throw new Error("Invalid trade amount");
  return result;
}
const amount = (value: bigint) => `${value / UNIT}.${String(value % UNIT).padStart(7, "0")}`;
const date = (value: unknown): number => typeof value === "string" ? Date.parse(value) : NaN;

/** Credits only ledger trade fills backed by a matching successful operation. */
export async function fetchTopVerifiedBuyers(
  horizonUrl: string, assetCode: string, issuer: string, window: BuyerWindow, signal: AbortSignal,
  callbacks: {
    onLog?: (message: string) => void; onProgress?: (count: number) => void;
    onResult?: (result: TopBuyersResult) => void; requestTimeoutMs?: number; now?: Date;
  } = {},
): Promise<TopBuyersResult> {
  if (!assetCode || assetCode.length > 12 || !issuer || !["7d", "30d", "all"].includes(window)) throw new Error("Invalid asset or buyer window");
  const base = horizonUrl.replace(/\/+$/, "");
  const now = callbacks.now ?? new Date(), to = now.getTime();
  const from = window === "all" ? null : to - (window === "7d" ? 7 : 30) * 86400000;
  const warnings = new Set<string>();
  const result: TopBuyersResult = {
    buyers: [], checkedAt: now.toISOString(), requestedFrom: from === null ? null : new Date(from).toISOString(),
    requestedTo: now.toISOString(), warnings: [], skippedRecords: 0, tradesScanned: 0,
  };
  const get = async (url: string): Promise<RecordData> => {
    signal.throwIfAborted(); callbacks.onLog?.(`  GET ${url}`);
    const data = await fetchJson(url, signal, { onLog: callbacks.onLog, timeoutMs: callbacks.requestTimeoutMs ?? 30000 });
    signal.throwIfAborted(); return data;
  };
  const custom = (record: RecordData, prefix: string) => record[`${prefix}asset_type`] === (assetCode.length <= 4 ? "credit_alphanum4" : "credit_alphanum12") && record[`${prefix}asset_code`] === assetCode && record[`${prefix}asset_issuer`] === issuer;
  try {
    const root = await get(`${base}/`);
    if (!/^\d+$/.test(String(root.history_elder_ledger))) throw new Error("Missing retention metadata");
    if (String(root.history_elder_ledger) !== "1") {
      const elder = await get(`${base}/ledgers/${root.history_elder_ledger}`);
      const elderTime = date(elder.closed_at);
      if (!Number.isFinite(elderTime)) throw new Error("Missing elder ledger date");
      if (from !== null && from < elderTime) warnings.add(`Requested period begins before Horizon's retained history (${elder.closed_at}); ranking is partial.`);
    }
  } catch {
    signal.throwIfAborted(); warnings.add("Horizon history retention could not be verified; period coverage is unknown.");
  }
  if (from === null) warnings.add("All available Horizon history was scanned; complete lifetime history is unproven.");
  const seen = new Set<string>(), operations = new Map<string, Promise<RecordData | null>>();
  const operationIdFor = (trade: RecordData): string | undefined => {
    const id = typeof trade.id === "string" ? trade.id.match(/^(\d+)-\d+$/)?.[1] : undefined;
    try {
      const linked = new URL(trade._links?.operation?.href, `${base}/`).pathname.match(/\/operations\/(\d+)$/)?.[1];
      return id && linked === id ? id : undefined;
    } catch { return undefined; }
  };
  const operationFor = (id: string): Promise<RecordData | null> => {
    if (!operations.has(id)) operations.set(id, get(`${base}/operations/${id}`).catch(() => { signal.throwIfAborted(); return null; }));
    return operations.get(id)!;
  };
  const totals = new Map<string, { xlm: bigint; asset: bigint; evidence: VerifiedBuyerEvidence[]; purchases: Set<string> }>();
  const snapshot = (): TopBuyersResult => {
    result.buyers = [...totals].sort(([a, x], [b, y]) => x.xlm === y.xlm ? a.localeCompare(b) : x.xlm > y.xlm ? -1 : 1).map(([address, total]) => {
      total.evidence.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      return { address, xlmSpent: amount(total.xlm), assetBought: amount(total.asset), averagePrice: Number(total.xlm) / Number(total.asset), purchaseCount: total.purchases.size, firstPurchase: total.evidence[0].createdAt, latestPurchase: total.evidence.at(-1)!.createdAt, evidence: total.evidence };
    });
    return { ...result, buyers: result.buyers.map(buyer => ({ ...buyer, evidence: [...buyer.evidence] })), warnings: [...warnings] };
  };
  const countedPaths = new Set<string>();
  for (const nativeBase of [true, false]) {
    let cursor: string | undefined, previousTime = Infinity;
    const cursors = new Set<string>();
    while (true) {
      signal.throwIfAborted();
      const params = new URLSearchParams({ limit: "200", order: "desc" });
      for (const side of ["base", "counter"]) {
        const native = (side === "base") === nativeBase;
        params.set(`${side}_asset_type`, native ? "native" : assetCode.length <= 4 ? "credit_alphanum4" : "credit_alphanum12");
        if (!native) { params.set(`${side}_asset_code`, assetCode); params.set(`${side}_asset_issuer`, issuer); }
      }
      if (cursor) params.set("cursor", cursor);
      const data = await get(`${base}/trades?${params}`), records = data._embedded?.records;
      if (!Array.isArray(records)) throw new Error("Malformed trade pagination response; ranking is incomplete.");
      let reachedFrom = false;
      for (const trade of records as RecordData[]) {
        if (typeof trade.id !== "string" || !/^\d+-\d+$/.test(trade.id) || typeof trade.paging_token !== "string" || !/^\d+-\d+$/.test(trade.paging_token)) throw new Error("Malformed trade pagination record; ranking is incomplete.");
        const time = date(trade.ledger_close_time);
        if (!Number.isFinite(time) || time > previousTime) throw new Error("Malformed trade pagination dates; ranking is incomplete.");
        previousTime = time;
      }
      let workerFailed = false;
      const processTrade = async (trade: RecordData) => {
        signal.throwIfAborted();
        const time = date(trade.ledger_close_time);
        if (from !== null && time < from) { reachedFrom = true; return; }
        if (time > to || seen.has(trade.id)) return;
        seen.add(trade.id); result.tradesScanned++;
        const createdAt = new Date(time).toISOString();
        result.oldestObserved = !result.oldestObserved || createdAt < result.oldestObserved ? createdAt : result.oldestObserved;
        result.newestObserved = !result.newestObserved || createdAt > result.newestObserved ? createdAt : result.newestObserved;
        callbacks.onProgress?.(result.tradesScanned); signal.throwIfAborted();
        const skip = () => { result.skippedRecords++; };
        const nativeSide = trade.base_asset_type === "native" ? "base" : trade.counter_asset_type === "native" ? "counter" : null;
        const assetSide = nativeSide === "base" ? "counter" : "base";
        if (!nativeSide || !custom(trade, `${assetSide}_`)) { skip(); return; }
        const buyer = trade[`${nativeSide}_account`], seller = trade[`${assetSide}_account`];
        if (typeof buyer !== "string" || !buyer || buyer === issuer || buyer === seller) { skip(); return; }
        const operationId = operationIdFor(trade);
        if (!operationId) { skip(); warnings.add("Some trade operations could not be verified and were excluded."); return; }
        const op = await operationFor(operationId);
        if (workerFailed) return;
        if (!op || op.id !== operationId || op.transaction_successful !== true || op.successful === false || date(op.created_at) !== time || typeof op.transaction_hash !== "string" || !/^[a-f\d]{64}$/i.test(op.transaction_hash) || (trade.transaction_hash !== undefined && trade.transaction_hash !== op.transaction_hash)) {
          skip(); warnings.add("Some trade operations could not be verified and were excluded."); return;
        }
        let xlm: bigint, asset: bigint, recipient: string | undefined;
        try {
          const path = op.type === "path_payment_strict_send" || op.type === "path_payment_strict_receive";
          if (path && (typeof op.from !== "string" || !op.from || (op.source_account !== undefined && op.source_account !== op.from))) { skip(); warnings.add("Some path payment sources could not be verified and were excluded."); return; }
          if (path && buyer === op.from) {
            if (op.source_asset_type !== "native" || !custom(op, "") || typeof op.to !== "string") { skip(); return; }
            if (countedPaths.has(operationId)) return;
            xlm = units(op.source_amount); asset = units(op.amount); recipient = op.to;
            countedPaths.add(operationId);
          } else {
            if (!path && !["manage_buy_offer", "manage_sell_offer", "create_passive_sell_offer"].includes(op.type)) { skip(); return; }
            // A maker pays its actual fill, independently of the operation's path source.
            xlm = units(trade[`${nativeSide}_amount`]); asset = units(trade[`${assetSide}_amount`]);
          }
        } catch { throw new Error("Invalid verified trade amount; ranking is incomplete."); }
        const evidence: VerifiedBuyerEvidence = { id: recipient ? `operation:${operationId}` : trade.id, operationId, txHash: op.transaction_hash, createdAt, xlmSpent: amount(xlm), assetBought: amount(asset), ...(recipient ? { recipient } : {}) };
        const total = totals.get(buyer) ?? { xlm: BigInt(0), asset: BigInt(0), evidence: [], purchases: new Set<string>() };
        total.xlm += xlm; total.asset += asset; total.evidence.push(evidence); total.purchases.add(operationId); totals.set(buyer, total);
        callbacks.onResult?.(snapshot()); signal.throwIfAborted();
      };
      let index = 0;
      await Promise.all(Array.from({ length: Math.min(4, records.length) }, async () => {
        try {
          while (!workerFailed && index < records.length) {
            signal.throwIfAborted();
            await processTrade(records[index++]);
          }
        } catch (error) { workerFailed = true; throw error; }
      }));
      signal.throwIfAborted();
      if (reachedFrom || records.length < 200) break;
      const next = records.at(-1)?.paging_token;
      if (!next || next === cursor || cursors.has(next)) throw new Error("Trade pagination did not advance; ranking is incomplete.");
      cursors.add(next); cursor = next;
    }
  }

  if (result.skippedRecords) warnings.add(`${result.skippedRecords} trade record(s) were excluded; only verified eligible purchases are ranked.`);
  const complete = snapshot(); signal.throwIfAborted(); callbacks.onResult?.(complete); return complete;
}
