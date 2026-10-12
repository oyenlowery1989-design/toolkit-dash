import { NextRequest, NextResponse } from "next/server";
import { FeeBumpTransaction, Horizon, Networks, TransactionBuilder } from "stellar-sdk";
import { requireAuth } from "@/lib/supabase-server";
import { mainnetSubmissionIntent } from "@/lib/mainnet-submit-policy";
import { MainnetSigningBudgetUnavailableError, reserveMainnetSignature } from "@/lib/mainnet-signing-budget";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const xdr = (body as { xdr?: unknown } | null)?.xdr;
  if (typeof xdr !== "string" || !xdr || xdr.length > 100_000) {
    return NextResponse.json({ error: "Signed transaction XDR is required" }, { status: 400 });
  }

  try {
    const tx = TransactionBuilder.fromXDR(xdr, Networks.PUBLIC);
    const inner = tx instanceof FeeBumpTransaction ? tx.innerTransaction : tx;
    if (!tx.signatures.length || (tx instanceof FeeBumpTransaction && !inner.signatures.length)) {
      return NextResponse.json({ error: "Transaction is not signed" }, { status: 400 });
    }
    const expiresAt = Number(inner.timeBounds?.maxTime);
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + 300) {
      return NextResponse.json({ error: "Transaction must expire within five minutes; rebuild it and retry" }, { status: 400 });
    }

    const intent = await mainnetSubmissionIntent(tx);
    const errors = await reserveMainnetSignature(auth.userId, tx.hash().toString("hex"), expiresAt, intent);
    if (errors.length) return NextResponse.json({ error: errors.join("; ") }, { status: 403 });
    try {
      return NextResponse.json(await new Horizon.Server("https://horizon.stellar.org").submitTransaction(tx));
    } catch (error) {
      const response = (error as { response?: { status?: number; data?: unknown } }).response;
      if (response?.data && typeof response.data === "object") {
        return NextResponse.json(response.data, { status: response.status && response.status >= 400 && response.status < 600 ? response.status : 400 });
      }
      return NextResponse.json({ error: "Could not reach Horizon; check the transaction hash before retrying" }, { status: 502 });
    }
  } catch (error) {
    if (error instanceof MainnetSigningBudgetUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "Invalid transaction";
    return NextResponse.json({ error: message }, { status: message.includes("Could not verify the account balance") ? 503 : 400 });
  }
}
