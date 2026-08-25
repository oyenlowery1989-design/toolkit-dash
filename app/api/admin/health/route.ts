import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getMainnetSafetyConfig } from "@/lib/mainnet-safety";
import { inspectAndMigrateLegacySecrets } from "@/lib/secret-migration";
import { encryptStoredSecret } from "@/lib/secret-storage";
import { getSupabase, isSupabaseConfigured, isSupabaseOnly, requireAuth } from "@/lib/supabase-server";

const DAY_MS = 24 * 60 * 60 * 1000;

async function recentFailures(userId: string | null) {
  const since = Date.now() - DAY_MS;
  if (isSupabaseOnly()) {
    const sb = getSupabase()!;
    const { data: groups, error: groupsError } = await sb.from("auto_send_groups").select("id").eq("user_id", userId ?? "");
    if (groupsError) throw new Error(groupsError.message);
    const groupIds = (groups ?? []).map((group) => group.id as string);
    const autoQuery = groupIds.length > 0
      ? sb.from("auto_send_run_log").select("id", { count: "exact", head: true }).in("group_id", groupIds).eq("status", "failed").gte("ran_at", since)
      : Promise.resolve({ count: 0, error: null });
    const tierQuery = sb.from("tiered_reward_run_log").select("id", { count: "exact", head: true })
      .eq("user_id", userId ?? "").in("status", ["failed", "aborted"]).gte("ran_at", since);
    const [auto, tiered] = await Promise.all([autoQuery, tierQuery]);
    if (auto.error) throw new Error(auto.error.message);
    if (tiered.error) throw new Error(tiered.error.message);
    return { autoSend: auto.count ?? 0, tieredRewards: tiered.count ?? 0 };
  }
  const db = getDb();
  const auto = db.prepare(
    "SELECT COUNT(*) AS count FROM auto_send_run_log WHERE status = 'failed' AND ran_at >= ?",
  ).get(since) as { count: number };
  const tiered = db.prepare(
    "SELECT COUNT(*) AS count FROM tiered_reward_run_log WHERE status IN ('failed', 'aborted') AND ran_at >= ?",
  ).get(since) as { count: number };
  return { autoSend: auto.count, tieredRewards: tiered.count };
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  try {
    const tables = await inspectAndMigrateLegacySecrets(auth.userId, false);
    const plaintextSecrets = Object.values(tables).reduce(
      (sum, report) => sum + report.scanned - report.empty - report.alreadyEncrypted,
      0,
    );
    const storedSecrets = Object.values(tables).reduce((sum, report) => sum + report.scanned - report.empty, 0);
    let encryptionReady = true;
    try { encryptStoredSecret("health-check"); } catch { encryptionReady = false; }
    const failures = await recentFailures(auth.userId);
    const safety = getMainnetSafetyConfig();
    const previewApprovalConfigured = Boolean(process.env.PREVIEW_APPROVAL_SECRET?.trim());
    const warnings = [
      ...(storedSecrets > 0 && !encryptionReady ? ["Signing-key encryption is not configured"] : []),
      ...(plaintextSecrets > 0 ? [`${plaintextSecrets} legacy signing key(s) still need migration`] : []),
      ...(safety.emergencyStop ? ["Mainnet emergency stop is active"] : []),
      ...(!safety.transactionsEnabled ? ["Mainnet transaction execution is disabled"] : []),
      ...(safety.transactionsEnabled && !previewApprovalConfigured
        ? ["Preview approval signing is not configured"]
        : []),
      ...(failures.autoSend + failures.tieredRewards > 0 ? ["Payment failures occurred in the last 24 hours"] : []),
    ];
    return NextResponse.json({
      ok: plaintextSecrets === 0
        && (storedSecrets === 0 || encryptionReady)
        && (!safety.transactionsEnabled || previewApprovalConfigured),
      provider: isSupabaseOnly() ? "supabase" : "sqlite",
      supabaseConfigured: isSupabaseConfigured(),
      encryption: { configured: encryptionReady, storedSecrets, plaintextSecrets },
      browserSigningEnabled: process.env.NODE_ENV !== "production" || process.env.ALLOW_BROWSER_SIGNING_KEYS === "true",
      mainnet: {
        transactionsEnabled: safety.transactionsEnabled,
        emergencyStop: safety.emergencyStop,
        previewApprovalConfigured,
        maxXlmPerRun: safety.maxXlmPerRun,
        maxXlmPerDay: safety.maxXlmPerDay,
        maxOperationsPerRun: safety.maxOperationsPerRun,
        allowlistSize: safety.allowedDestinations.size,
      },
      failuresLast24Hours: failures,
      warnings,
    });
  } catch (error) {
    console.error("[admin/health] health check failed:", error);
    return NextResponse.json({ ok: false, error: "Health check failed" }, { status: 500 });
  }
}
