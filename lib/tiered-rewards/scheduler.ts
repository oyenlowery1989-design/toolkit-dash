/**
 * Tiered Rewards scheduler.
 * Uses node-cron to schedule enabled configs server-side.
 * Uses a global singleton so HMR restarts don't spawn duplicate schedulers.
 */

import type { ScheduledTask } from "node-cron";
import type { TieredRewardConfig, RunLogRow } from "./types";
import { getSupabase, isSupabaseOnly } from "@/lib/supabase-server";

declare global {
  var _tieredRewardsTasks: Map<string, ScheduledTask> | undefined;
  var _tieredRewardsStarted: boolean | undefined;
  var _tieredRewardsRunningConfigs: Set<string> | undefined;
}

/**
 * Globalized like the two singletons above — an HMR module reload must not hand new cron
 * closures a fresh, empty overlap-guard while an old in-flight execution keeps running
 * unaware. Shared by name with lib/tiered-rewards/runner.ts's `runConfig`, which is the sole
 * place that adds/removes entries (so it also covers the manual-run API route). This module
 * only reads the Set here, for a cheap early "still running" skip + log before doing any
 * preview/balance work for the tick.
 */
if (!global._tieredRewardsRunningConfigs) global._tieredRewardsRunningConfigs = new Set<string>();
const _runningConfigs = global._tieredRewardsRunningConfigs;

/** A loaded config, tagged with the Supabase user_id that owns it (Supabase mode only —
 *  used so runner.ts can attribute run-log rows / last_run_at writes to the right user). */
type ScheduledConfig = TieredRewardConfig & { userId?: string };

function getDb() {
  const { getDb: _getDb } = require("@/lib/db");
  return _getDb();
}

/** Mirrors app/api/tiered-rewards/run/route.ts's loadConfigFromSupabase mapping, but for
 *  every enabled+scheduled config across all users — the scheduler runs as a single
 *  background process, not behind a per-request auth session, so it uses the service-role
 *  client (bypasses RLS) rather than filtering by a specific user_id. */
async function loadEnabledConfigsFromSupabase(): Promise<ScheduledConfig[]> {
  const sb = getSupabase();
  if (!sb) return [];

  const { data: configs, error } = await sb
    .from("tiered_reward_configs")
    .select("*")
    .eq("enabled", true)
    .not("interval_minutes", "is", null)
    .order("created_at", { ascending: true });

  if (error || !configs) {
    console.error("[tiered-rewards] Failed to load configs from Supabase:", error);
    return [];
  }

  const result: ScheduledConfig[] = [];
  for (const c of configs as Record<string, unknown>[]) {
    const { data: tiers } = await sb
      .from("tiered_reward_tiers")
      .select("*")
      .eq("config_id", c.id)
      .order("position", { ascending: true });

    const mappedTiers = await Promise.all(
      (tiers ?? []).map(async (t: Record<string, unknown>) => {
        const { data: assets } = await sb.from("tiered_reward_assets").select("*").eq("tier_id", t.id);
        return {
          id: t.id as string,
          configId: t.config_id as string,
          tierNumber: t.tier_number as number,
          minTokens: t.min_tokens as number,
          maxTokens: (t.max_tokens as number | null) ?? undefined,
          position: t.position as number,
          assets: (assets ?? []).map((a: Record<string, unknown>) => ({
            id: a.id as string,
            tierId: a.tier_id as string,
            assetCode: a.asset_code as string,
            assetIssuer: (a.asset_issuer as string | null) ?? undefined,
            amount: a.amount as number,
          })),
        };
      })
    );

    result.push({
      id: c.id as string,
      name: c.name as string,
      assetCode: c.asset_code as string,
      assetIssuer: c.asset_issuer as string,
      network: (c.network as string) ?? "public",
      secretKey: (c.secret_key as string) || null,
      hasKey: !!((c.secret_key as string) || ""),
      intervalMinutes: (c.interval_minutes as number | null) ?? null,
      enabled: c.enabled === true || c.enabled === 1,
      minReserve: (c.min_reserve as number) ?? 10.0,
      minSenderThreshold: (c.min_sender_threshold as number) ?? 0,
      previewOnly: c.preview_only === true || c.preview_only === 1,
      batchSend: c.batch_send !== false && c.batch_send !== 0,
      memo: (c.memo as string | null) ?? null,
      feeMultiplier: (c.fee_multiplier as number) ?? 1.0,
      excludeAddresses: Array.isArray(c.exclude_addresses)
        ? (c.exclude_addresses as string[])
        : (() => { try { return JSON.parse((c.exclude_addresses as string) ?? "[]"); } catch { return []; } })(),
      lastRunAt: (c.last_run_at as number | null) ?? undefined,
      lastFailureAt: (c.last_failure_at as number | null) ?? undefined,
      createdAt: c.created_at as number,
      tiers: mappedTiers,
      userId: (c.user_id as string | undefined) || undefined,
    });
  }
  return result;
}

/**
 * Loads enabled+scheduled configs. Self-hosted (non-Vercel) deployments explicitly
 * configured with DB_PROVIDER=supabase must read from Supabase here too — otherwise the
 * scheduler process keeps reading stale/absent local SQLite while the UI's API routes
 * correctly write to Supabase, so enabling/disabling/deleting a config through the UI has
 * zero effect on what the running scheduler actually executes.
 */
async function loadEnabledConfigs(): Promise<ScheduledConfig[]> {
  if (isSupabaseOnly()) return loadEnabledConfigsFromSupabase();
  try {
    const { loadEnabledConfigs: _load } = require("./db") as typeof import("./db");
    return _load(getDb());
  } catch (err) {
    console.error("[tiered-rewards] Failed to load configs from DB:", err);
    return [];
  }
}

function minutesToCronExpression(minutes: number): string {
  if (minutes < 60) return `*/${Math.max(1, minutes)} * * * *`;
  const hours = Math.floor(minutes / 60);
  return `0 */${Math.max(1, hours)} * * *`;
}

/**
 * Sets/clears last_failure_at for a config. Must be Supabase-aware like runner.ts's
 * last_run_at write — otherwise on Vercel+Supabase this unconditional getDb() call would
 * silently no-op and the UI's failure banner would never reflect real scheduled-run outcomes.
 */
async function setConfigLastFailure(configId: string, userId: string | undefined, timestamp: number | null): Promise<void> {
  if (isSupabaseOnly()) {
    const sb = getSupabase();
    if (!sb) return;
    try {
      const query = sb.from("tiered_reward_configs").update({ last_failure_at: timestamp }).eq("id", configId);
      const { error } = await (userId ? query.eq("user_id", userId) : query);
      if (error) console.error("[tiered-rewards] last_failure_at Supabase update failed:", error);
    } catch (err) {
      console.error("[tiered-rewards] last_failure_at Supabase update threw:", err);
    }
    return;
  }
  try {
    const db = getDb();
    db.prepare("UPDATE tiered_reward_configs SET last_failure_at = ? WHERE id = ?").run(timestamp, configId);
  } catch { /* non-fatal */ }
}

export function startTieredRewardsScheduler(): void {
  if (process.env.VERCEL) return;
  if (global._tieredRewardsStarted) return;
  global._tieredRewardsStarted = true;
  global._tieredRewardsTasks = new Map();

  console.log("[tiered-rewards] Scheduler starting...");
  scheduleAll().catch((err) => console.error("[tiered-rewards] scheduleAll failed:", err));
}

async function scheduleAll(): Promise<void> {
  const cron = require("node-cron") as typeof import("node-cron");
  const tasks = global._tieredRewardsTasks!;

  for (const task of tasks.values()) task.stop();
  tasks.clear();

  const configs = await loadEnabledConfigs();
  for (const config of configs) {
    if (!config.intervalMinutes) continue;
    const expr = minutesToCronExpression(config.intervalMinutes);
    const task = cron.schedule(expr, async () => {
      // Cheap early skip + log. The authoritative overlap guard (add/delete on this same
      // globalized Set) lives inside runner.ts's runConfig, so a manual run and a scheduler
      // tick for this configId can never both execute a real send concurrently even if this
      // check races past this point.
      if (_runningConfigs.has(config.id)) {
        console.warn(`[tiered-rewards] Config "${config.name}" still running — skipping tick`);
        return;
      }
      console.log(`[tiered-rewards] Running config "${config.name}" (${config.id})`);
      try {
        const { calculatePreview } = await import("./calculator");
        const { runConfig, insertLogRows } = await import("./runner");

        // Reload config from DB to get latest
        const freshConfigs = await loadEnabledConfigs();
        const fresh = freshConfigs.find((c) => c.id === config.id);
        if (!fresh) return;

        const preview = await calculatePreview(fresh);
        if ("error" in preview) {
          console.error(`[tiered-rewards] Preview failed for "${fresh.name}":`, preview.error);
          await setConfigLastFailure(fresh.id, fresh.userId, Date.now());
          return;
        }

        if (preview.blocked) {
          console.warn(`[tiered-rewards] Config "${fresh.name}" blocked:`, preview.blockReasons.join("; "));
          await setConfigLastFailure(fresh.id, fresh.userId, Date.now());
          return;
        }

        if (fresh.previewOnly) {
          // Log preview rows instead of running
          const ranAt = Date.now();
          const rows: Omit<RunLogRow, "id">[] = [];
          for (const assignment of preview.assignments) {
            for (const holder of assignment.holders) {
              for (const asset of assignment.tier.assets) {
                rows.push({
                  configId: fresh.id,
                  tierNumber: assignment.tier.tierNumber,
                  holderAddress: holder.address,
                  assetCode: asset.assetCode,
                  assetIssuer: asset.assetIssuer,
                  amountSent: asset.amount,
                  status: "preview",
                  ranAt,
                });
              }
            }
          }
          await insertLogRows(rows, fresh.userId);
          return;
        }

        const result = await runConfig(fresh, preview.assignments, fresh.userId);
        if ("error" in result) {
          console.error(`[tiered-rewards] Run failed for "${fresh.name}":`, result.error);
          await setConfigLastFailure(fresh.id, fresh.userId, Date.now());
        } else if (result.totalFailed > 0) {
          await setConfigLastFailure(fresh.id, fresh.userId, Date.now());
        } else {
          await setConfigLastFailure(fresh.id, fresh.userId, null);
        }
      } catch (err) {
        console.error(`[tiered-rewards] Config "${config.name}" run failed:`, err);
      }
    });
    tasks.set(config.id, task);
    console.log(`[tiered-rewards] Scheduled "${config.name}" every ${config.intervalMinutes}m (${expr})`);
  }
}

/** Call after config changes to reload all schedules. */
export function refreshTieredRewardsScheduler(): void {
  if (!global._tieredRewardsStarted) return;
  scheduleAll().catch((err) => console.error("[tiered-rewards] scheduleAll failed:", err));
}
