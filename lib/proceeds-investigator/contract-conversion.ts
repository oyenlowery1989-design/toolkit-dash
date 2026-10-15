/** Resolve gross account endpoints only; contract-to-contract routing is not a wallet receipt. */
export function resolveContractConversion(operation: Record<string, unknown>, account: string, code: string, issuer: string): {
  sale?: { amountXlm: number; assetSoldAmount: number };
  purchase?: { amountXlm: number; targetAssetPurchase: boolean };
  warning?: string;
} {
  if (operation.transaction_successful !== true) return { warning: "Contract transaction success is unverified." };
  if (!Array.isArray(operation.asset_balance_changes)) return { warning: "Contract balance evidence is unavailable; conversion coverage is incomplete." };
  type Endpoint = { native: boolean; code?: string; issuer?: string; amount: bigint };
  const debits = new Map<string, Endpoint>();
  const credits = new Map<string, Endpoint>();
  for (const change of operation.asset_balance_changes) {
    if (!change || typeof change !== "object") return { warning: "Contract balance evidence is malformed." };
    if (change.from !== account && change.to !== account) continue;
    if (change.from === account && change.to === account) continue;
    const isNative = change.asset_type === "native";
    if (typeof change.from !== "string" || !change.from.trim() || typeof change.to !== "string" || !change.to.trim()
      || change.type !== "transfer" || typeof change.amount !== "string" || !/^\d+(?:\.\d{1,7})?$/.test(change.amount)
      || (!isNative && (!["credit_alphanum4", "credit_alphanum12"].includes(change.asset_type) || typeof change.asset_code !== "string" || !change.asset_code || typeof change.asset_issuer !== "string" || !change.asset_issuer))) {
      return { warning: "Contract account endpoints cannot be verified; conversion coverage is incomplete." };
    }
    const [whole, fraction = ""] = change.amount.split(".");
    const amount = BigInt(whole) * BigInt(10000000) + BigInt(fraction.padEnd(7, "0"));
    if (amount === BigInt(0)) continue;
    const key = isNative ? "native" : JSON.stringify([change.asset_code, change.asset_issuer]);
    const bucket = change.from === account ? debits : credits;
    const previous = bucket.get(key);
    bucket.set(key, { native: isNative, code: change.asset_code, issuer: change.asset_issuer, amount: amount + (previous?.amount ?? BigInt(0)) });
  }
  const incomingXlm = credits.get("native");
  const outgoingXlm = debits.get("native");
  if (!incomingXlm && !outgoingXlm) return {};
  // A round trip or multi-asset operation has no unique gross sale attribution.
  if (debits.size !== 1 || credits.size !== 1 || [...debits.keys()].some(key => credits.has(key))) {
    return { warning: "Contract account endpoints are ambiguous or include a native transfer; amounts were not attributed automatically." };
  }
  const spent = [...debits.values()][0];
  const received = [...credits.values()][0];
  if (incomingXlm && spent.code === code && spent.issuer === issuer) return {
    sale: { amountXlm: Number(incomingXlm.amount) / 10000000, assetSoldAmount: Number(spent.amount) / 10000000 },
  };
  if (outgoingXlm && !received.native) return {
    purchase: { amountXlm: Number(outgoingXlm.amount) / 10000000, targetAssetPurchase: received.code === code && received.issuer === issuer },
  };
  return {};
}
