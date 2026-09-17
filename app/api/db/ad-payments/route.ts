import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isSupabaseOnly, requireAuth } from "@/lib/supabase-server";
import { readSavedAnalysisRows } from "@/lib/saved-analyses/server";
import { compactPaymentReview, summarizeAdPayments, type PaymentReviewAnalysis } from "@/lib/saved-analyses/payment-review";

function mapRow(row: Record<string, unknown>): PaymentReviewAnalysis {
  return {
    id: String(row.id), assetCode: String(row.asset_code), issuer: String(row.issuer), network: String(row.network), timestamp: Number(row.created_at),
    result: typeof row.result_json === "string" ? JSON.parse(row.result_json) : row.result_json as PaymentReviewAnalysis["result"],
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const recipient = req.nextUrl.searchParams.get("recipient") ?? "";
  const rows = isSupabaseOnly()
    ? await readSavedAnalysisRows(auth.userId!)
    : { data: getDb().prepare("SELECT * FROM saved_analyses ORDER BY created_at DESC").all() as Record<string, unknown>[], error: null };
  if (rows.error) return NextResponse.json({ error: rows.error.message }, { status: 500 });
  return NextResponse.json(compactPaymentReview(summarizeAdPayments((rows.data ?? []).map(mapRow), recipient)));
}
