import { Networks, type FeeBumpTransaction, type Horizon, type Transaction } from "stellar-sdk";
import { authHeaders, waitForAuth } from "@/lib/db-client";

export async function submitMainnetTransaction(
  tx: Transaction | FeeBumpTransaction,
  options?: { trackPayment: true },
): Promise<Awaited<ReturnType<Horizon.Server["submitTransaction"]>>> {
  if (tx.networkPassphrase !== Networks.PUBLIC) throw new Error("Only Mainnet transactions can be submitted by this application");
  await waitForAuth();
  const response = await fetch("/api/transactions/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ xdr: tx.toXDR(), ...(options?.trackPayment ? { trackPayment: true } : {}) }),
  });
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body.error ?? body.detail ?? "Could not submit transaction") as Error & {
      response: { status: number; data: unknown };
    };
    error.response = { status: response.status, data: body };
    throw error;
  }
  return body;
}
