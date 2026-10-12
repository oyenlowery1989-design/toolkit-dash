import { Keypair, TransactionBuilder, type Transaction, type FeeBumpTransaction } from "stellar-sdk";
import { authHeaders } from "@/lib/db-client";

export async function signFunderTransaction<T extends Transaction | FeeBumpTransaction>(
  tx: T, walletId: string | null, manualSigner: Keypair | null,
  purpose: "direct" | "sponsored" | "close", networkPassphrase: string, signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  if (!walletId) {
    if (!manualSigner) throw new Error("Signing key is required");
    tx.sign(manualSigner);
    return tx;
  }
  const response = await fetch("/api/account-funder/sign", {
    method: "POST", signal,
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ walletId, purpose, xdr: tx.toXDR() }),
  });
  const body = await response.json();
  if (!response.ok || typeof body.xdr !== "string") throw new Error(body.error || "Could not sign funding transaction");
  return TransactionBuilder.fromXDR(body.xdr, networkPassphrase) as T;
}
