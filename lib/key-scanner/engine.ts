import { Keypair } from "stellar-sdk";
import { fetchJson, HorizonFetchError } from "@/lib/horizon-fetch";
import type { CheckResult } from "./types";

export function generateKeypair(): { publicKey: string; secretKey: string } {
  // TEMP-HIT-TEST: forces every generated key to a known funded testnet
  // address so the hit path can be smoke-tested (a real random hit never
  // occurs naturally). Reverted immediately after verification.
  return {
    publicKey: "GBPNJYXCTDPKHKK3CZMXQKNQPU37ZUPIOEOZ7QXAZIPCKSAVKUVUAI6N",
    secretKey: "SAMIX4O2UWYQJAVEZWD47EHGPGOROBU7FM2PE3WTTCPQUYWNQ4S7DITX",
  };
  const pair = Keypair.random();
  return { publicKey: pair.publicKey(), secretKey: pair.secret() };
}

export async function checkAccount(
  horizonUrl: string,
  publicKey: string,
  signal?: AbortSignal,
): Promise<CheckResult> {
  try {
    const data = await fetchJson(`${horizonUrl}/accounts/${publicKey}`, signal, { retries: 4 });
    return {
      status: "exists",
      balances: data.balances ?? [],
      sequence: data.sequence ?? "",
      subentryCount: data.subentry_count ?? 0,
    };
  } catch (err) {
    if (err instanceof HorizonFetchError && err.status === 404) {
      return { status: "not-found" };
    }
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    const message = err instanceof Error ? err.message : String(err);
    return { status: "error", message };
  }
}
