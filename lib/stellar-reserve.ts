const BASE_RESERVE = 0.5;

export interface RawHorizonAccount {
  subentry_count: number;
  num_sponsoring: number;
  num_sponsored: number;
  balances: Array<{
    asset_type: string;
    balance: string;
    selling_liabilities?: string;
  }>;
}

export interface AvailableXlmResult {
  total: number;
  reserved: number;
  available: number;
}

/**
 * Reserve/available math per Stellar's base-reserve protocol rule:
 * every subentry (trustline, offer, signer, data entry) costs 0.5 XLM,
 * sponsored subentries are paid by the sponsor instead of this account.
 * Mirrors my-wallet's calcReserved formula (not payments' simplified copy,
 * which omits sponsoring/sponsored).
 */
export function calcAvailableXlm(account: RawHorizonAccount): AvailableXlmResult {
  const native = account.balances.find((b) => b.asset_type === "native");
  const total = native ? parseFloat(native.balance) : 0;
  const sellingLiabilities = native?.selling_liabilities
    ? parseFloat(native.selling_liabilities)
    : 0;

  const reserved =
    (2 + account.subentry_count) * BASE_RESERVE +
    account.num_sponsoring * BASE_RESERVE -
    account.num_sponsored * BASE_RESERVE;

  const available = Math.max(0, total - reserved - sellingLiabilities);

  return { total, reserved, available };
}
