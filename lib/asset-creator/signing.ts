import { Keypair, Networks, type Transaction } from "stellar-sdk";
import { authHeaders } from "@/lib/db-client";
import { issuanceProofMessage } from "./issuance-proof";
import type { SignedTx } from "./types";

export async function signCreationTransaction(
  tx: Transaction, walletId: string | undefined, secret: string,
  stepId: SignedTx["stepId"], signal: AbortSignal, networkPassphrase: string,
): Promise<string> {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  if (!walletId) {
    const signer = Keypair.fromSecret(secret);
    const unsignedXdr = tx.toXDR();
    tx.sign(signer);
    if (stepId !== "issuance") return tx.toXDR();
    const network = networkPassphrase === Networks.PUBLIC ? "public" : networkPassphrase === Networks.TESTNET ? "testnet" : null;
    if (!network) throw new Error("Unsupported Asset Creator network");
    const response = await fetch("/api/asset-creator/sign", {
      method: "POST", signal,
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ stepId, network, unsignedXdr, signedXdr: tx.toXDR(), issuerProof: signer.sign(issuanceProofMessage(tx.hash())).toString("base64") }),
    });
    const body = await response.json();
    if (!response.ok || typeof body.xdr !== "string") throw new Error(body.error || "Could not protect asset issuance");
    return body.xdr;
  }
  const network = networkPassphrase === Networks.PUBLIC ? "public" : networkPassphrase === Networks.TESTNET ? "testnet" : null;
  if (!network) throw new Error("Unsupported Asset Creator network");
  const response = await fetch("/api/asset-creator/sign", {
    method: "POST", signal,
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ walletId, stepId, network, xdr: tx.toXDR() }),
  });
  const body = await response.json();
  if (!response.ok || typeof body.xdr !== "string") throw new Error(body.error || "Could not sign asset creation transaction");
  return body.xdr;
}
