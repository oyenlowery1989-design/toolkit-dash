export type XlmBalanceValue = number | "error" | "unfunded";

const BALANCE_FETCH_TIMEOUT_MS = 15_000;

export async function fetchXlmBalance(
  horizonUrl: string,
  address: string,
  signal?: AbortSignal,
): Promise<XlmBalanceValue> {
  // Merge the caller's signal (if any) with an internal timeout so a hung
  // Horizon URL can't leave this request pending forever.
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onExternalAbort);
  }
  const timeoutId = setTimeout(() => controller.abort(), BALANCE_FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(`${horizonUrl}/accounts/${address}`, { signal: controller.signal });
    if (res.status === 404) return "unfunded";
    if (!res.ok) return "error";
    const data = await res.json();
    const xlm = data.balances?.find(
      (b: { asset_type: string }) => b.asset_type === "native",
    )?.balance;
    return xlm ? parseFloat(xlm) : "error";
  } catch {
    return "error";
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", onExternalAbort);
  }
}
