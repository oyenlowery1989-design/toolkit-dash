import { FeeBumpTransaction, Networks, Transaction, TransactionBuilder, Keypair } from "stellar-sdk";
import { authHeaders, waitForAuth } from "@/lib/db-client";

export async function signPaymentTransaction<T extends Transaction | FeeBumpTransaction>(
  tx: T, walletId: string | null, manualSecret: string,
): Promise<T> {
  if (!walletId) {
    tx.sign(Keypair.fromSecret(manualSecret.trim()));
    return tx;
  }
  await waitForAuth();
  const response = await fetch("/api/wallet/sign", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ walletId, xdr: tx.toXDR() }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Could not sign with saved wallet");
  const signed = TransactionBuilder.fromXDR(body.xdr, Networks.PUBLIC);
  if (!signed.hash().equals(tx.hash())) throw new Error("Signing response changed the transaction");
  const publicKey = tx instanceof FeeBumpTransaction ? tx.feeSource : tx.source;
  if (!signed.signatures.some((signature) => Keypair.fromPublicKey(publicKey).verify(signed.hash(), signature.signature()))) {
    throw new Error("Signing response has no valid wallet signature");
  }
  return signed as T;
}
