import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly, syncToSupabase, requireAuth } from "@/lib/supabase-server";

const MAX = 10;

function mapRow(r: Record<string, unknown>) {
  return {
    id: r.id,
    network: r.network,
    memo: r.memo,
    recipientCount: r.recipient_count,
    successCount: r.success_count,
    failedCount: r.failed_count,
    ranAt: r.ran_at,
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  if (isSupabaseOnly()) {
    const { data } = await getSupabase()!
      .from("bulk_run_history")
      .select("*")
      .eq("user_id", userId!)
      .order("ran_at", { ascending: false })
      .limit(MAX);
    return NextResponse.json((data ?? []).map(mapRow));
  }
  const rows = getDb()
    .prepare("SELECT * FROM bulk_run_history ORDER BY ran_at DESC")
    .all() as Record<string, unknown>[];
  return NextResponse.json(rows.map(mapRow));
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  const b = await req.json();
  const now = b.ranAt ?? Date.now();

  if (!isSupabaseOnly()) {
    const db = getDb();
    db.prepare(
      `INSERT OR REPLACE INTO bulk_run_history
         (id, network, memo, recipient_count, success_count, failed_count, ran_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(b.id, b.network, b.memo, b.recipientCount, b.successCount, b.failedCount, now);
    db.prepare(
      `DELETE FROM bulk_run_history WHERE id NOT IN
       (SELECT id FROM bulk_run_history ORDER BY ran_at DESC LIMIT ?)`,
    ).run(MAX);
  }

  syncToSupabase(async () => {
    const sb = getSupabase()!;
    await sb.from("bulk_run_history").upsert({
      user_id: userId,
      id: b.id,
      network: b.network,
      memo: b.memo,
      recipient_count: b.recipientCount,
      success_count: b.successCount,
      failed_count: b.failedCount,
      ran_at: now,
    });
    const { data: oldest } = await sb
      .from("bulk_run_history")
      .select("id")
      .eq("user_id", userId!)
      .order("ran_at", { ascending: true })
      .limit(100);
    if (oldest && oldest.length > MAX) {
      const toDelete = oldest.slice(0, oldest.length - MAX).map((r) => r.id);
      await sb.from("bulk_run_history").delete().eq("user_id", userId!).in("id", toDelete);
    }
  });

  return NextResponse.json({ ok: true });
}
