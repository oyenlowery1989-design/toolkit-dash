import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase-server";
import { acknowledgePaymentSubmission, reconcilePaymentSubmission } from "@/lib/payments/submission-journal";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json(await reconcilePaymentSubmission(auth.userId), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not check the previous payment. Try again before sending." }, { status: 503 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  let hash: unknown;
  try { hash = (await req.json())?.hash; } catch { /* invalid JSON */ }
  if (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) return NextResponse.json({ error: "Invalid transaction hash" }, { status: 400 });
  try {
    await acknowledgePaymentSubmission(auth.userId, hash);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not acknowledge payment" }, { status: 409 });
  }
}
