import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly, requireAuth } from "@/lib/supabase-server";
import { readPages } from "@/lib/supabase-read-all";

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

      const { data: ownedGroups, error: oge } = await readPages((from, to) => sb
        .from("auto_send_groups")
        .select("id", { count: "exact" })
        .eq("user_id", auth.userId!)
        .order("id")
        .range(from, to));
      if (oge) return NextResponse.json({ error: oge.message }, { status: 500 });
      const ownedGroupIds = (ownedGroups ?? []).map((group) => group.id as string);

      const rows: Record<string, unknown>[] = [];
      for (let i = 0; i < ownedGroupIds.length; i += 100) {
        const ids = ownedGroupIds.slice(i, i + 100);
        const { data, error } = await readPages((from, to) => sb.from("auto_send_run_log")
          .select("ran_at, group_id, status, amount_sent", { count: "exact" })
          .in("group_id", ids)
          .neq("status", "guard")
          .order("id")
          .range(from, to));
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        rows.push(...(data ?? []));
      }
      const runKeys = new Set(rows.map((r) => `${r.ran_at}|${r.group_id}`));
      const totalRuns = runKeys.size;
      const totalSent = rows.filter((r) => r.status === "sent").length;
      const totalSkipped = rows.filter((r) => r.status === "skipped").length;
      const totalFailed = rows.filter((r) => r.status === "failed").length;
      const totalXlm = rows.reduce((s, r) => s + (r.status === "sent" ? Number(r.amount_sent ?? 0) : 0), 0);
      const lastRunAt = rows.reduce<number | null>((latest, row) => Math.max(latest ?? 0, Number(row.ran_at)), null);

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
        SUM(CASE WHEN status = 'sent' THEN COALESCE(amount_sent, 0) ELSE 0 END) AS total_xlm,
        MAX(ran_at)                                          AS last_run_at
      FROM auto_send_run_log
      WHERE status != 'guard'
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
