import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly, requireAuth } from "@/lib/supabase-server";
import type { RunLogEntry } from "@/lib/auto-send/types";

type Row = Record<string, unknown>;

function clusterRuns(rows: Row[]): RunLogEntry[] {
  const byRun = new Map<number, Row[]>();
  for (const r of rows) {
    const t = r.ran_at as number;
    if (!byRun.has(t)) byRun.set(t, []);
    byRun.get(t)!.push(r);
  }

  const runs: RunLogEntry[] = [];
  for (const [ranAt, runRows] of byRun) {
    const sentCount = runRows.filter((r) => r.status === "sent").length;
    const skippedCount = runRows.filter((r) => r.status === "skipped").length;
    const failedCount = runRows.filter((r) => r.status === "failed").length;
    const previewCount = runRows.filter((r) => r.status === "preview").length;
    const totalXlm = runRows.reduce((s, r) => s + ((r.amount_sent as number) ?? 0), 0);
    runs.push({
      ranAt,
      walletAddress: (runRows[0].wallet_address as string) ?? "",
      sentCount,
      skippedCount,
      failedCount,
      previewCount,
      totalXlm,
      results: runRows.map((r) => ({
        destination: r.destination as string,
        status: r.status as string,
        amountSent: (r.amount_sent as number) ?? undefined,
        txHash: (r.tx_hash as string) ?? undefined,
        error: (r.error as string) ?? undefined,
      })),
    });
  }
  return runs;
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;

    const groupId = req.nextUrl.searchParams.get("groupId");
    if (!groupId) return NextResponse.json({ error: "groupId required" }, { status: 400 });

    // ?totals=1 — return per-destination lifetime aggregates
    if (req.nextUrl.searchParams.get("totals") === "1") {
      if (isSupabaseOnly()) {
        const sb = getSupabase()!;
        const { data, error } = await sb
          .from("auto_send_run_log")
          .select("destination, amount_sent")
          .eq("group_id", groupId)
          .eq("user_id", auth.userId!)
          .eq("status", "sent");
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        const result: Record<string, { totalXlm: number; sentCount: number }> = {};
        for (const r of data ?? []) {
          const dest = r.destination as string;
          if (!result[dest]) result[dest] = { totalXlm: 0, sentCount: 0 };
          result[dest].totalXlm += (r.amount_sent as number) ?? 0;
          result[dest].sentCount += 1;
        }
        return NextResponse.json(result);
      }

      const db = getDb();
      const rows = db
        .prepare(
          `SELECT destination, SUM(amount_sent) as total_xlm, COUNT(*) FILTER (WHERE status = 'sent') as sent_count
           FROM auto_send_run_log WHERE group_id = ? AND status = 'sent'
           GROUP BY destination`
        )
        .all(groupId) as Row[];
      const result: Record<string, { totalXlm: number; sentCount: number }> = {};
      for (const r of rows) {
        result[r.destination as string] = {
          totalXlm: (r.total_xlm as number) ?? 0,
          sentCount: (r.sent_count as number) ?? 0,
        };
      }
      return NextResponse.json(result);
    }

    if (isSupabaseOnly()) {
      const sb = getSupabase()!;
      const { data, error } = await sb
        .from("auto_send_run_log")
        .select("*")
        .eq("group_id", groupId)
        .eq("user_id", auth.userId!)
        .order("ran_at", { ascending: false })
        .limit(200);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json(clusterRuns(data ?? []));
    }

    const db = getDb();
    const rows = db
      .prepare(`SELECT * FROM auto_send_run_log WHERE group_id = ? ORDER BY ran_at DESC LIMIT 200`)
      .all(groupId) as Row[];
    return NextResponse.json(clusterRuns(rows));
  } catch (e) {
    console.error("[auto-send/history] GET unhandled:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
