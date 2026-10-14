import { isLocalRestoreActive } from "@/lib/local-restore-lock";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly, requireAuth } from "@/lib/supabase-server";
import { AutoSendApprovalChangedError, AutoSendRunInProgressError, runGroup, previewGroup } from "@/lib/auto-send/runner";
import { refreshScheduler } from "@/lib/auto-send/scheduler";
import { rowToGroup } from "@/lib/auto-send/db-map";
import type { AutoSendGroup, DestinationRunResult } from "@/lib/auto-send/types";
import { getReservedMainnetXlm, MainnetSigningBudgetUnavailableError } from "@/lib/mainnet-signing-budget";
import { createPreviewApproval, stablePreviewDigest, validateMainnetRun, verifyPreviewApproval } from "@/lib/mainnet-safety";
import { AutoSendReconciliationRequiredError, deleteAutoSendRunGuard, readAutoSendRunGuard } from "@/lib/auto-send/run-guard";

type Row = Record<string, unknown>;

function previewDigest(preview: Exclude<Awaited<ReturnType<typeof previewGroup>>, { error: string }>): string {
  return stablePreviewDigest({
    groupId: preview.groupId,
    walletAddress: preview.walletAddress,
    items: preview.items.map((item) => ({ destination: item.destination, amountXlm: item.amountXlm, wouldSkip: item.wouldSkip })),
  });
}

async function loadGroup(groupId: string, userId: string | null): Promise<AutoSendGroup | null> {
  if (isSupabaseOnly()) {
    const sb = getSupabase()!;
    const { data: g, error: ge } = await sb.from("auto_send_groups").select("*").eq("id", groupId).eq("user_id", userId ?? "").single();
    if (ge) {
      if (ge.code === "PGRST116") return null;
      throw new Error(`Could not load auto-send group: ${ge.message}`);
    }
    if (!g) return null;
    const { data: dests, error: destinationsError } = await sb.from("auto_send_destinations").select("*").eq("group_id", groupId).order("position", { ascending: true });
    if (destinationsError) throw new Error(`Could not load auto-send destinations: ${destinationsError.message}`);
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
async function writeRunLog(groupId: string, walletAddress: string, results: DestinationRunResult[], ranAt: number): Promise<{ ok: boolean }> {
  if (!isSupabaseOnly()) return { ok: true }; // SQLite logging is handled inside runner.ts for local mode
  if (results.length === 0) return { ok: true };
  try {
    const sb = getSupabase()!;
    const rows = results.map((r) => ({
      id: crypto.randomUUID(),
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

declare global {
  var _autoSendLoggingGroups: Set<string> | undefined;
}
if (!global._autoSendLoggingGroups) global._autoSendLoggingGroups = new Set<string>();
const loggingGroups = global._autoSendLoggingGroups;

/** Logs the run result after runFn completes. If runFn throws, no result exists to log — the
 *  error propagates to the outer handler. (runGroup never throws today; it always resolves a
 *  GroupRunResult.) */
async function runAndLog(
  group: AutoSendGroup,
  runFn: () => Promise<Awaited<ReturnType<typeof runGroup>>>
): Promise<{ result: Awaited<ReturnType<typeof runGroup>>; logWriteFailed: boolean }> {
  if (isLocalRestoreActive()) throw new AutoSendRunInProgressError("A local restore is in progress. Try again after it finishes.");
  if (loggingGroups.has(group.id)) throw new AutoSendRunInProgressError();
  loggingGroups.add(group.id);
  try {
  let result: Awaited<ReturnType<typeof runGroup>> | undefined;
  let logWriteFailed = false;
  try {
    result = await runFn();
  } finally {
    if (result) {
      const { ok } = await writeRunLog(group.id, result.walletAddress, result.results, result.ranAt);
      logWriteFailed = !ok;
    }
  }
  return { result, logWriteFailed };
  } finally {
    loggingGroups.delete(group.id);
  }

}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const groupId = req.nextUrl.searchParams.get("groupId");
  if (!groupId) return NextResponse.json({ error: "groupId required" }, { status: 400 });
  try {
    if (!await loadGroup(groupId, auth.userId ?? null)) return NextResponse.json({ error: "Group not found" }, { status: 404 });
    return NextResponse.json({ guard: await readAutoSendRunGuard(groupId) });
  } catch (error) {
    console.error("[auto-send/run] GET guard failed:", error);
    return NextResponse.json({ error: "Could not check run status" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;

    let body: Row;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

    const { groupId, action, dryRun, testRun, previewToken } = body as Record<string, unknown>;

    if (action === "refresh-scheduler") {
      refreshScheduler();
      return NextResponse.json({ ok: true });
    }

    if (!groupId) return NextResponse.json({ error: "groupId required" }, { status: 400 });

    const group = await loadGroup(groupId as string, auth.userId ?? null);
    if (!group) return NextResponse.json({ error: "Group not found. It may have been deleted or not yet saved." }, { status: 404 });

    if (action === "resolve-guard") {
      if (body.confirmation !== "I checked every transaction hash and the wallet balance") {
        return NextResponse.json({ error: "Ledger reconciliation confirmation required" }, { status: 400 });
      }
      const guard = await readAutoSendRunGuard(group.id);
      if (!guard) return NextResponse.json({ error: "No blocked run found" }, { status: 404 });
      if (guard.state === "running" && Date.now() - guard.startedAt < 24 * 60 * 60 * 1000) {
        return NextResponse.json({ error: "This run may still be active. Wait 24 hours before resolving an interrupted run." }, { status: 409 });
      }
      const lease = isSupabaseOnly()
        ? await getSupabase()!.from("auto_send_run_leases").select("expires_at").eq("resource_id", group.id).maybeSingle()
        : { data: getDb().prepare("SELECT expires_at FROM auto_send_run_leases WHERE resource_id = ?").get(group.id) as { expires_at: number } | undefined, error: null };
      if (lease.error) throw new Error(`Could not check active run: ${lease.error.message}`);
      if (Number(lease.data?.expires_at ?? 0) > Date.now()) {
        return NextResponse.json({ error: "A run is still active" }, { status: 409 });
      }
      await deleteAutoSendRunGuard(group.id, guard);
      return NextResponse.json({ ok: true });
    }

    if (!group.secretKey) return NextResponse.json({ error: "This group has no secret key configured. Edit the group and set a wallet key." }, { status: 400 });

    if (dryRun) {
      const preview = await previewGroup(group);
      if ("error" in preview) return NextResponse.json(preview, { status: 400 });
      const daily = await getReservedMainnetXlm();
      const intended = preview.items.filter((item) => !item.wouldSkip);
      const safetyWarnings = validateMainnetRun({
        destinations: intended.map((item) => item.destination),
        operationCount: intended.length,
        xlmAmount: intended.reduce((sum, item) => sum + item.amountXlm, 0) + intended.length * 100 / 1e7,
        xlmSentLast24Hours: daily,
      });
      const token = createPreviewApproval(`auto-send:${group.id}`, auth.userId ?? "local", previewDigest(preview));
      return NextResponse.json({ ...preview, previewToken: token ?? undefined, safetyWarnings });
    }

    if (testRun) {
      const testGroup = { ...group, testMode: true };
      const { result, logWriteFailed } = await runAndLog(group, () => runGroup(testGroup));
      return NextResponse.json(logWriteFailed ? { ...result, logWriteFailed: true } : result);
    }

    const freshPreview = await previewGroup(group);
    if ("error" in freshPreview) return NextResponse.json(freshPreview, { status: 400 });
    const approved = verifyPreviewApproval(
      previewToken,
      `auto-send:${group.id}`,
      auth.userId ?? "local",
      previewDigest(freshPreview),
    );
    if (!approved) {
      return NextResponse.json({ error: "Preview approval is missing, expired, or the payment amounts changed. Preview again." }, { status: 428 });
    }

    const { result, logWriteFailed } = await runAndLog(group, () => runGroup(group, freshPreview));
    return NextResponse.json(logWriteFailed ? { ...result, logWriteFailed: true } : result);
  } catch (e) {
    if (e instanceof AutoSendApprovalChangedError) {
      return NextResponse.json({ error: e.message }, { status: 428 });
    }
    if (e instanceof MainnetSigningBudgetUnavailableError) {
      return NextResponse.json({ error: e.message }, { status: 503 });
    }
    if (e instanceof AutoSendRunInProgressError || e instanceof AutoSendReconciliationRequiredError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    console.error("[auto-send/run] POST unhandled:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
