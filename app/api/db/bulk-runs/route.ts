import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

const MAX = 10;

export async function GET() {
  const rows = getDb()
    .prepare("SELECT * FROM bulk_run_history ORDER BY ran_at DESC")
    .all() as Record<string, unknown>[];
  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      network: r.network,
      memo: r.memo,
      recipientCount: r.recipient_count,
      successCount: r.success_count,
      failedCount: r.failed_count,
      ranAt: r.ran_at,
    })),
  );
}

export async function POST(req: NextRequest) {
  const b = await req.json();
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO bulk_run_history
       (id, network, memo, recipient_count, success_count, failed_count, ran_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(b.id, b.network, b.memo, b.recipientCount, b.successCount, b.failedCount, b.ranAt ?? Date.now());
  db.prepare(
    `DELETE FROM bulk_run_history WHERE id NOT IN
     (SELECT id FROM bulk_run_history ORDER BY ran_at DESC LIMIT ?)`,
  ).run(MAX);
  return NextResponse.json({ ok: true });
}
