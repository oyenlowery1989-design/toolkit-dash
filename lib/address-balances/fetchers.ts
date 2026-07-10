import { calcAvailableXlm, type RawHorizonAccount } from "@/lib/stellar-reserve";

const FETCH_TIMEOUT_MS = 15_000;

export type AddressBalanceResult =
  | { status: "unfunded" }
  | { status: "error" }
  | { status: "ok"; total: number; available: number };

/**
 * Fetches the raw Horizon account JSON directly (not via fetchXlmBalance,
 * which only returns a bare balance number) — the reserve/available calc
 * needs subentry_count, num_sponsoring, num_sponsored, and selling_liabilities.
 */
export async function fetchAddressBalance(
  horizonUrl: string,
  address: string,
  signal?: AbortSignal,
): Promise<AddressBalanceResult> {
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onExternalAbort);
  }
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(`${horizonUrl}/accounts/${address}`, {
      signal: controller.signal,
    });
    if (res.status === 404) return { status: "unfunded" };
    if (!res.ok) return { status: "error" };
    const data = (await res.json()) as RawHorizonAccount;
    const { total, available } = calcAvailableXlm(data);
    return { status: "ok", total, available };
  } catch {
    return { status: "error" };
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", onExternalAbort);
  }
}
