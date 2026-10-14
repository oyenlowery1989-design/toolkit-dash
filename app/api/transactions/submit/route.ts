import { NextRequest, NextResponse } from "next/server";
import { FeeBumpTransaction, Horizon, Networks, TransactionBuilder } from "stellar-sdk";
import { requireAuth } from "@/lib/supabase-server";
import { mainnetSubmissionIntent } from "@/lib/mainnet-submit-policy";
import { MainnetSigningBudgetUnavailableError, reserveMainnetSignature } from "@/lib/mainnet-signing-budget";
import { beginPaymentSubmission, finishPaymentSubmission, readPaymentSubmission, reconcilePaymentSubmission, type PaymentSubmission } from "@/lib/payments/submission-journal";
import { isLocalDataBlocked } from "@/lib/local-restore-lock";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const xdr = (body as { xdr?: unknown } | null)?.xdr;
  const tracked = (body as { trackPayment?: unknown } | null)?.trackPayment === true;
  if (typeof xdr !== "string" || !xdr || xdr.length > 100_000) {
    return NextResponse.json({ error: "Signed transaction XDR is required" }, { status: 400 });
  }
  const state = globalThis as typeof globalThis & { _paymentsInFlight?: Set<symbol> };
  const inFlight = state._paymentsInFlight ??= new Set();
  const requestId = Symbol();
  if (tracked && isLocalDataBlocked()) return NextResponse.json({ error: "Local recovery is in progress" }, { status: 409 });
  if (tracked) inFlight.add(requestId);
  let journal: PaymentSubmission | null = null;
  const unresolved = () => NextResponse.json({ hash: journal?.hash, unresolved: true,
    error: "Payment outcome is not confirmed. Check its status before starting another payment." }, { status: 502 });
  try {
    const tx = TransactionBuilder.fromXDR(xdr, Networks.PUBLIC);
    const inner = tx instanceof FeeBumpTransaction ? tx.innerTransaction : tx;
    if (!tx.signatures.length || (tx instanceof FeeBumpTransaction && !inner.signatures.length)) {
      return NextResponse.json({ error: "Transaction is not signed" }, { status: 400 });
    }
    if (tracked) {
      journal = await readPaymentSubmission(auth.userId);
      if (journal) {
        if (journal.hash !== tx.hash().toString("hex")) return NextResponse.json({ error: "Review the previous payment before starting another", hash: journal.hash }, { status: 409 });
        journal = await reconcilePaymentSubmission(auth.userId);
        if (journal?.response) return NextResponse.json(journal.response.body, { status: journal.response.status });
      }
    }
    const expiresAt = Number(inner.timeBounds?.maxTime);
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + 300) {
      if (journal) return unresolved();
      return NextResponse.json({ error: "Transaction must expire within five minutes; rebuild it and retry" }, { status: 400 });
    }

    const intent = await mainnetSubmissionIntent(tx);
    const errors = await reserveMainnetSignature(auth.userId, tx.hash().toString("hex"), expiresAt, intent);
    if (errors.length) return NextResponse.json({ error: errors.join("; ") }, { status: 403 });
    if (tracked) {
      journal = await beginPaymentSubmission(auth.userId, tx);
      if (journal.hash !== tx.hash().toString("hex")) return NextResponse.json({ error: "Another payment requires review", hash: journal.hash }, { status: 409 });
      if (journal.response) return NextResponse.json(journal.response.body, { status: journal.response.status });
    }
    try {
      const result = await new Horizon.Server("https://horizon.stellar.org").submitTransaction(tx);
      if (journal) await finishPaymentSubmission(auth.userId, journal, "success", { status: 200, body: { ...result, hash: journal.hash } });
      return NextResponse.json(result);
    } catch (error) {
      const response = (error as { response?: { status?: number; data?: Record<string, unknown> & { extras?: { result_codes?: { transaction?: string } } } } }).response;
      if (journal) {
        const recovered = await reconcilePaymentSubmission(auth.userId);
        if (recovered?.response) return NextResponse.json(recovered.response.body, { status: recovered.response.status });
        // Only an explicit atomic failure is final; bad-sequence/transport errors can follow a committed payment.
        if (response?.status === 400 && response.data?.extras?.result_codes?.transaction === "tx_failed") {
          await finishPaymentSubmission(auth.userId, journal, "failed", { status: 400, body: response.data });
          return NextResponse.json(response.data, { status: 400 });
        }
        return unresolved();
      }
      if (response?.data && typeof response.data === "object") {
        return NextResponse.json(response.data, { status: response.status && response.status >= 400 && response.status < 600 ? response.status : 400 });
      }
      return NextResponse.json({ error: "Could not reach Horizon; check the transaction hash before retrying" }, { status: 502 });
    }
  } catch (error) {
    if (journal) return unresolved();
    if (error instanceof MainnetSigningBudgetUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "Invalid transaction";
    return NextResponse.json({ error: message }, { status: message.includes("Could not verify the account balance") ? 503 : 400 });
  } finally {
    inFlight.delete(requestId);
  }
}
