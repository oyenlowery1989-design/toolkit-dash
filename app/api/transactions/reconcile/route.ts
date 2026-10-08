import { NextRequest, NextResponse } from "next/server";
import { Horizon } from "stellar-sdk";
import { requireAuth } from "@/lib/supabase-server";
import { readExecution, finishExecution } from "@/lib/transaction-budget";

/** Only ledger evidence can settle an uncertain outcome. A 404 never releases funds. */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  try {
    const { hash } = await req.json();
    if (typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash)) return NextResponse.json({ error: "Invalid transaction hash" }, { status: 400 });
    const execution = await readExecution(hash);
    if (!execution) return NextResponse.json({ error: "Execution not found" }, { status: 404 });
    if (execution.status !== "unknown" && execution.status !== "reserved") return NextResponse.json({ status: execution.status });
    const result = await new Horizon.Server("https://horizon.stellar.org").transactions().transaction(hash).call();
    if (result.hash !== hash) throw new Error("Ledger hash mismatch");
    await finishExecution(hash, result.successful ? "submitted" : "rejected", result, result.successful ? undefined : BigInt(result.fee_charged));
    return NextResponse.json({ status: result.successful ? "submitted" : "rejected", hash });
  } catch {
    return NextResponse.json({ error: "Outcome remains unconfirmed; budget hold retained. Do not retry the payment." }, { status: 409 });
  }
}
