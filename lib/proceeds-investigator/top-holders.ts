import { fetchJson } from "@/lib/horizon-fetch";

export interface TopHoldersResult {
  holders: { address: string; balance: string; percentage: number | null }[];
  holderCount: number;
  accountsScanned: number;
  observedSupply: string | null;
  checkedAt: string;
  warning?: string;
}
const UNIT = BigInt(10000000);
function units(value: unknown): bigint {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,7})?$/.test(value)) throw new Error("Invalid asset balance received from Horizon.");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * UNIT + BigInt(fraction.padEnd(7, "0"));
}
const amount = (value: bigint) => `${value / UNIT}.${String(value % UNIT).padStart(7, "0")}`;

/** Scans all account trustlines before ranking; no per-account balance requests. */
export async function fetchTopAssetHolders(horizonUrl: string, assetCode: string, issuer: string, signal: AbortSignal, callbacks: {
  onLog?: (message: string) => void;
  onProgress?: (accountsScanned: number) => void;
  onResult?: (result: TopHoldersResult) => void;
} = {}): Promise<TopHoldersResult> {
  const base = horizonUrl.replace(/\/+$/, "");
  const get = async (url: string) => {
    signal.throwIfAborted();callbacks.onLog?.(`  GET ${url}`);
    const result = await fetchJson(url, signal, { onLog: callbacks.onLog });
    signal.throwIfAborted();return result;
  };
  const metadata = get(`${base}/assets?${new URLSearchParams({ asset_code: assetCode, asset_issuer: issuer })}`).then(data => {
    const asset = data._embedded?.records?.find((record: Record<string, unknown>) => record.asset_code === assetCode && record.asset_issuer === issuer);
    if (!asset) throw new Error("Asset supply metadata is unavailable.");
    let extra = BigInt(0);
    for (const [field, count] of [["claimable_balances_amount", "num_claimable_balances"], ["liquidity_pools_amount", "num_liquidity_pools"], ["contracts_amount", "num_contracts"]]) {
      extra += units(asset[field] ?? (asset[count] === 0 ? "0" : undefined));
    }
    return { extra, warning: undefined as string | undefined };
  }).catch(() => ({ extra: null, warning: "Supply outside account trustlines could not be verified; percentages are unknown." }));
  const top: { address: string; balance: string; value: bigint }[] = [];
  const accounts = new Set<string>(), cursors = new Set<string>();
  let cursor: string | undefined, total = BigInt(0), holderCount = 0;
  while (true) {
    const params = new URLSearchParams({ asset: `${assetCode}:${issuer}`, limit: "200", order: "asc" });
    if (cursor) params.set("cursor", cursor);
    const data = await get(`${base}/accounts?${params}`);
    const records = data._embedded?.records;
    if (!Array.isArray(records)) throw new Error("Invalid holder response; ranking could not be verified.");
    for (const record of records) {
      signal.throwIfAborted();
      const address = record.account_id ?? record.id;
      if (typeof address !== "string" || !address || !Array.isArray(record.balances)) throw new Error("Invalid holder account received.");
      if (accounts.has(address)) continue;
      accounts.add(address);
      const balance = record.balances.find((line: Record<string, unknown>) => line.asset_type !== "native" && line.asset_code === assetCode && line.asset_issuer === issuer);
      if (!balance) continue;
      const value = units(balance.balance);
      total += value;
      if (value === BigInt(0)) continue;
      holderCount++;
      top.push({ address, balance: balance.balance, value });
      top.sort((a, b) => a.value === b.value ? a.address.localeCompare(b.address) : a.value > b.value ? -1 : 1);
      if (top.length > 3) top.pop();
    }
    callbacks.onProgress?.(accounts.size);signal.throwIfAborted();
    if (records.length < 200) break;
    const next = records.at(-1)?.paging_token;
    if (typeof next !== "string" || !next || cursors.has(next)) throw new Error("Holder pagination did not advance; ranking is incomplete.");
    cursors.add(next);cursor = next;
  }
  const supply = await metadata;signal.throwIfAborted();
  const observed = supply.extra === null ? null : total + supply.extra;
  const result: TopHoldersResult = {
    holders: top.map(holder => ({ address: holder.address, balance: holder.balance, percentage: observed && observed > BigInt(0) ? Number(holder.value) / Number(observed) * 100 : null })),
    holderCount, accountsScanned: accounts.size, observedSupply: observed === null ? null : amount(observed), checkedAt: new Date().toISOString(), warning: supply.warning,
  };
  callbacks.onResult?.(result);return result;
}
