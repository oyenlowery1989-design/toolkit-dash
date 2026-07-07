export interface TradeDirection {
  sold: number;
  received: number;
}

function parseAmount(value: unknown): number {
  const parsed = parseFloat(String(value ?? "0"));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Given a raw Horizon /trades record, determines whether `account` sold
 *  `assetCode:issuer` for native XLM in this trade, and if so how much of each.
 *  Asset code comparison is case-insensitive per project convention. Returns
 *  null if this trade doesn't match (account not involved on the matching side,
 *  or not an asset<->XLM trade for this asset). */
export function resolveAssetToXlmTrade(
  raw: Record<string, unknown>,
  account: string,
  assetCode: string,
  issuer: string,
): TradeDirection | null {
  const isBase = raw.base_account === account;
  const assetIsBase =
    String(raw.base_asset_code ?? "").toUpperCase() === assetCode.toUpperCase() &&
    raw.base_asset_issuer === issuer;
  const assetIsCounter =
    String(raw.counter_asset_code ?? "").toUpperCase() === assetCode.toUpperCase() &&
    raw.counter_asset_issuer === issuer;
  const xlmIsBase = raw.base_asset_type === "native";
  const xlmIsCounter = raw.counter_asset_type === "native";

  if (isBase && assetIsBase && xlmIsCounter) {
    return { sold: parseAmount(raw.base_amount), received: parseAmount(raw.counter_amount) };
  }
  if (!isBase && assetIsCounter && xlmIsBase) {
    return { sold: parseAmount(raw.counter_amount), received: parseAmount(raw.base_amount) };
  }
  return null;
}
