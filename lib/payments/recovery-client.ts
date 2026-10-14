import { authHeaders, dbDelete, waitForAuth } from "@/lib/db-client";
import type { PaymentSubmission } from "./submission-journal";

export async function loadPaymentSubmission(): Promise<PaymentSubmission | null> {
  await waitForAuth();
  const response = await fetch("/api/payments/submission", { headers: authHeaders(), cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error("Could not check the previous payment. Check again before sending.");
  return response.json();
}

export async function acknowledgePayment(hash: string) {
  await dbDelete("/api/payments/submission", { hash });
}
