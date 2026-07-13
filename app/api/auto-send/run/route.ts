import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly, requireAuth } from "@/lib/supabase-server";
import { runGroup, previewGroup } from "@/lib/auto-send/runner";
import { refreshScheduler } from "@/lib/auto-send/scheduler";
import { rowToGroup } from "@/lib/auto-send/db-map";
import type { AutoSendGroup, DestinationRunResult } from "@/lib/auto-send/types";

type Row = Record<string, unknown>;

async function loadGroup(groupId: string, userId: string | null): Promise<AutoSendGroup | null> {
  if (isSupabaseOnly()) {
    const sb = getSupabase()!;
    const { data: g, error: ge } = await sb.from("auto_send_groups").select("*").eq("id", groupId).eq("user_id", userId ?? "").single();
    if (ge || !g) return null;
    const { data: dests } = await sb.from("auto_send_destinations").select("*").eq("group_id", groupId).order("position", { ascending: true });
    return rowToGroup(g, dests ?? []);
  }
  const db = getDb();
  const g = db.prepare(`SELECT * FROM auto_send_groups WHERE id = ?`).get(groupId) as Row | undefined;
  if (!g) return null;
  const dests = db.prepare(`SELECT * FROM auto_send_destinations WHERE group_id = ? ORDER BY position ASC`).all(groupId) as Row[];
  return rowToGroup(g, dests);
}

/**
 * Writes the run-log rows for a completed group run to Supabase (local/SQLite mode logs
 * incrementally inside runner.ts and never reaches this function).
 *
 * Never throws — a failure to persist the run log must not prevent the caller from returning
 * the actual send/skip/fail results to the client (money may already have moved). Instead this
 * resolves to `{ ok: false }` so the route can surface `logWriteFailed: true` in the response.
 */
async function writeRunLog(userId: string | null, groupId: string, walletAddress: string, results: DestinationRunResult[], ranAt: number): Promise<{ ok: boolean }> {
  if (!isSupabaseOnly()) return { ok: true }; // SQLite logging is handled inside runner.ts for local mode
  if (results.length === 0) return { ok: true };
  try {
    const sb = getSupabase()!;
    const rows = results.map((r) => ({
      id: crypto.randomUUID(),
      user_id: userId ?? "",
      group_id: groupId,
      wallet_address: walletAddress,
      destination: r.destination,
      amount_sent: r.amountSent ?? null,
      status: r.status,
      error: r.error ?? null,
      ran_at: ranAt,
      tx_hash: r.txHash ?? null,
    }));
    const { error } = await sb.from("auto_send_run_log").insert(rows);
    if (error) {
      console.error("[auto-send/run] run-log insert failed for group", groupId, ":", error);
      return { ok: false };
    }
    return { ok: true };
  } catch (err) {
    console.error("[auto-send/run] run-log insert threw for group", groupId, ":", err);
    return { ok: false };
  }
}

/** Logs the run result after runFn completes. If runFn throws, no result exists to log — the
 *  error propagates to the outer handler. (runGroup never throws today; it always resolves a
 *  GroupRunResult.) */
async function runAndLog(
  userId: string | null,
  group: AutoSendGroup,
  runFn: () => Promise<Awaited<ReturnType<typeof runGroup>>>
): Promise<{ result: Awaited<ReturnType<typeof runGroup>>; logWriteFailed: boolean }> {
  let result: Awaited<ReturnType<typeof runGroup>> | undefined;
  let logWriteFailed = false;
  try {
    result = await runFn();
  } finally {
    if (result) {
      const { ok } = await writeRunLog(userId, group.id, result.walletAddress, result.results, result.ranAt);
      logWriteFailed = !ok;
    }
  }
  return { result, logWriteFailed };
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;

    let body: Row;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

    const { groupId, action, dryRun, testRun } = body as Record<string, unknown>;

    if (action === "refresh-scheduler") {
      refreshScheduler();
      return NextResponse.json({ ok: true });
    }

    if (!groupId) return NextResponse.json({ error: "groupId required" }, { status: 400 });

    const group = await loadGroup(groupId as string, auth.userId ?? null);
    if (!group) return NextResponse.json({ error: "Group not found. It may have been deleted or not yet saved." }, { status: 404 });
    if (!group.secretKey) return NextResponse.json({ error: "This group has no secret key configured. Edit the group and set a wallet key." }, { status: 400 });

    if (dryRun) {
      const preview = await previewGroup(group);
      return NextResponse.json(preview);
    }

    if (testRun) {
      const testGroup = { ...group, testMode: true };
      const { result, logWriteFailed } = await runAndLog(auth.userId ?? null, group, () => runGroup(testGroup));
      return NextResponse.json(logWriteFailed ? { ...result, logWriteFailed: true } : result);
    }

    const { result, logWriteFailed } = await runAndLog(auth.userId ?? null, group, () => runGroup(group));
    return NextResponse.json(logWriteFailed ? { ...result, logWriteFailed: true } : result);
  } catch (e) {
    console.error("[auto-send/run] POST unhandled:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
