import { Keypair, Transaction, TransactionBuilder } from "stellar-sdk";
import { authHeaders, waitForAuth } from "@/lib/db-client";

export interface SavedAssetSigner { id: string; publicKey: string }

export async function signAssetManagerTransaction(tx: Transaction, secret: string, savedSigner?: SavedAssetSigner): Promise<Transaction> {
  if (!savedSigner) {
    tx.sign(Keypair.fromSecret(secret));
    return tx;
  }
  await waitForAuth();
  const response = await fetch("/api/asset-manager/sign", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ walletId: savedSigner.id, xdr: tx.toXDR(), networkPassphrase: tx.networkPassphrase,
      immutableConfirmed: tx.operations.some(op => op.type === "setOptions" && op.setFlags === 4) }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Could not sign with saved wallet");
  const signed = TransactionBuilder.fromXDR(body.xdr, tx.networkPassphrase);
  if (!(signed instanceof Transaction) || !signed.hash().equals(tx.hash()) ||
    !signed.signatures.some(signature => Keypair.fromPublicKey(savedSigner.publicKey).verify(signed.hash(), signature.signature()))) {
    throw new Error("Invalid saved-wallet signing response");
  }
  return signed;
}
