import type { Horizon } from "stellar-sdk";
import type { SignedTransaction } from "@/lib/transaction-policy";
import { authHeaders, waitForAuth } from "@/lib/db-client";

/** Browser tools keep signing locally, but every application submission is gated on the server. */
export async function submitTransaction(tx: SignedTransaction): Promise<Horizon.HorizonApi.SubmitTransactionResponse> {
  await waitForAuth();
  const response = await fetch("/api/transactions/submit", {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ xdr: tx.toXDR() }),
  });
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body.error ?? "Transaction submission failed") as Error & { response?: unknown };
    error.response = { status: body.upstreamStatus ?? response.status, data: { extras: body.extras } };
    throw error;
  }
  return body;
}
