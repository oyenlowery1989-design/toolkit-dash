import { StrKey } from "stellar-sdk";
import { authHeaders, waitForAuth } from "@/lib/db-client";

export async function loadSavedDistributors(
  assetCode: string, issuer: string, network: string, signal: AbortSignal,
  onLog?: (message: string) => void,
): Promise<string[]> {
  try {
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
    requestSignal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => requestSignal.removeEventListener("abort", onAbort);
      const onAbort = () => { cleanup(); reject(requestSignal.reason); };
      requestSignal.addEventListener("abort", onAbort, { once: true });
      waitForAuth().then(
        () => { cleanup(); resolve(); },
        error => { cleanup(); reject(error); },
      );
    });
    requestSignal.throwIfAborted();
    const headers = authHeaders();
    const url = `/api/asset-sales/distributors?${new URLSearchParams({ assetCode, issuer, network })}`;
    onLog?.(`  GET ${url}`);
    const response = await fetch(url, { headers, signal: requestSignal, cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    requestSignal.throwIfAborted();
    if (JSON.stringify(headers) !== JSON.stringify(authHeaders())) throw new Error("Session changed");
    if (!Array.isArray(body.accounts) || body.accounts.some((account: unknown) =>
      typeof account !== "string" || !StrKey.isValidEd25519PublicKey(account))) throw new Error("Invalid saved distributors");
    return [...new Set<string>(body.accounts)];
  } catch (error) {
    signal.throwIfAborted();
    throw new Error("Saved distributors could not be loaded. Retry the analysis or enter seller accounts manually.", { cause: error });
  }
}
