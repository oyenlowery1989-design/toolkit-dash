import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly, requireAuth } from "@/lib/supabase-server";

export interface AutoSendStats {
  totalRuns: number;
  totalSent: number;
  totalSkipped: number;
  totalFailed: number;
  totalXlm: number;
  lastRunAt: number | null;
  activeGroups: number;
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;

    if (isSupabaseOnly()) {
      const sb = getSupabase()!;

      const { data: logRows, error: le } = await sb
        .from("auto_send_run_log")
        .select("ran_at, group_id, status, amount_sent")
        .eq("user_id", auth.userId!);
      if (le) return NextResponse.json({ error: le.message }, { status: 500 });

      const rows = logRows ?? [];
      const runKeys = new Set(rows.map((r) => `${r.ran_at}|${r.group_id}`));
      const totalRuns = runKeys.size;
      const totalSent = rows.filter((r) => r.status === "sent").length;
      const totalSkipped = rows.filter((r) => r.status === "skipped").length;
      const totalFailed = rows.filter((r) => r.status === "failed").length;
      const totalXlm = rows.reduce((s, r) => s + ((r.amount_sent as number) ?? 0), 0);
      const lastRunAt = rows.length ? Math.max(...rows.map((r) => r.ran_at as number)) : null;

      const { count: activeGroups, error: ge } = await sb
        .from("auto_send_groups")
        .select("id", { count: "exact", head: true })
        .eq("user_id", auth.userId!)
        .eq("enabled", 1)
        .not("interval_minutes", "is", null);
      if (ge) return NextResponse.json({ error: ge.message }, { status: 500 });

      const stats: AutoSendStats = {
        totalRuns,
        totalSent,
        totalSkipped,
        totalFailed,
        totalXlm,
        lastRunAt,
        activeGroups: activeGroups ?? 0,
      };
      return NextResponse.json(stats);
    }

    const db = getDb();

    const log = db.prepare(`
      SELECT
        COUNT(DISTINCT ran_at || group_id) AS total_runs,
        SUM(CASE WHEN status = 'sent'    THEN 1 ELSE 0 END) AS total_sent,
        SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS total_skipped,
        SUM(CASE WHEN status = 'failed'  THEN 1 ELSE 0 END) AS total_failed,
        SUM(COALESCE(amount_sent, 0))                        AS total_xlm,
        MAX(ran_at)                                          AS last_run_at
      FROM auto_send_run_log
    `).get() as Record<string, unknown>;

    const activeGroups = (db.prepare(
      `SELECT COUNT(*) AS n FROM auto_send_groups WHERE enabled = 1 AND interval_minutes IS NOT NULL`
    ).get() as { n: number }).n;

    const stats: AutoSendStats = {
      totalRuns:    (log.total_runs    as number) ?? 0,
      totalSent:    (log.total_sent    as number) ?? 0,
      totalSkipped: (log.total_skipped as number) ?? 0,
      totalFailed:  (log.total_failed  as number) ?? 0,
      totalXlm:     (log.total_xlm     as number) ?? 0,
      lastRunAt:    (log.last_run_at   as number) ?? null,
      activeGroups,
    };

    return NextResponse.json(stats);
  } catch (e) {
    console.error("[auto-send/stats] GET unhandled:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
