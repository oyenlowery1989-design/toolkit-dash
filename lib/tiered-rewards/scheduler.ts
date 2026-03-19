/**
 * Tiered Rewards scheduler.
 * Uses node-cron to schedule enabled configs server-side.
 * Uses a global singleton so HMR restarts don't spawn duplicate schedulers.
 */

import type { ScheduledTask } from "node-cron";
import type { TieredRewardConfig, Tier, RewardAsset } from "./types";

declare global {
  var _tieredRewardsTasks: Map<string, ScheduledTask> | undefined;
  var _tieredRewardsStarted: boolean | undefined;
}

function getDb() {
  const { getDb: _getDb } = require("@/lib/db");
  return _getDb();
}

function loadEnabledConfigs(): TieredRewardConfig[] {
  try {
    const db = getDb();
    const configs = db
      .prepare(
        `SELECT * FROM tiered_reward_configs WHERE enabled = 1 AND interval_minutes IS NOT NULL ORDER BY created_at ASC`
      )
      .all() as Record<string, unknown>[];

    return configs.map((c) => {
      const tiers = db
        .prepare(`SELECT * FROM tiered_reward_tiers WHERE config_id = ? ORDER BY position ASC`)
        .all(c.id) as Record<string, unknown>[];

      const mappedTiers: Tier[] = tiers.map((t) => {
        const assets = db
          .prepare(`SELECT * FROM tiered_reward_assets WHERE tier_id = ? ORDER BY rowid ASC`)
          .all(t.id) as Record<string, unknown>[];

        const mappedAssets: RewardAsset[] = assets.map((a) => ({
          id: a.id as string,
          tierId: a.tier_id as string,
          assetCode: a.asset_code as string,
          assetIssuer: (a.asset_issuer as string) ?? undefined,
          amount: a.amount as number,
        }));

        return {
          id: t.id as string,
          configId: t.config_id as string,
          tierNumber: t.tier_number as number,
          minTokens: t.min_tokens as number,
          maxTokens: (t.max_tokens as number) ?? undefined,
          position: t.position as number,
          assets: mappedAssets,
        };
      });

      return {
        id: c.id as string,
        name: c.name as string,
        assetCode: c.asset_code as string,
        assetIssuer: c.asset_issuer as string,
        network: (c.network as string) ?? "public",
        secretKey: (c.secret_key as string) ?? "",
        intervalMinutes: c.interval_minutes as number,
        enabled: true,
        minReserve: (c.min_reserve as number) ?? 10.0,
        minSenderThreshold: (c.min_sender_threshold as number) ?? 0,
        previewOnly: (c.preview_only as number) === 1,
        lastRunAt: (c.last_run_at as number) ?? undefined,
        lastFailureAt: (c.last_failure_at as number) ?? undefined,
        createdAt: c.created_at as number,
        tiers: mappedTiers,
      };
    });
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

export function startTieredRewardsScheduler(): void {
  if (process.env.VERCEL) return;
  if (global._tieredRewardsStarted) return;
  global._tieredRewardsStarted = true;
  global._tieredRewardsTasks = new Map();

  console.log("[tiered-rewards] Scheduler starting...");
  scheduleAll();
}

function scheduleAll(): void {
  const cron = require("node-cron") as typeof import("node-cron");
  const tasks = global._tieredRewardsTasks!;

  for (const task of tasks.values()) task.stop();
  tasks.clear();

  const configs = loadEnabledConfigs();
  for (const config of configs) {
    if (!config.intervalMinutes) continue;
    const expr = minutesToCronExpression(config.intervalMinutes);
    const task = cron.schedule(expr, async () => {
      console.log(`[tiered-rewards] Running config "${config.name}" (${config.id})`);
      try {
        const { calculatePreview } = await import("./calculator");
        const { runConfig } = await import("./runner");

        // Reload config from DB to get latest
        const freshConfigs = loadEnabledConfigs();
        const fresh = freshConfigs.find((c) => c.id === config.id);
        if (!fresh) return;

        const preview = await calculatePreview(fresh);
        if ("error" in preview) {
          console.error(`[tiered-rewards] Preview failed for "${fresh.name}":`, preview.error);
          try {
            const db = getDb();
            db.prepare("UPDATE tiered_reward_configs SET last_failure_at = ? WHERE id = ?").run(Date.now(), fresh.id);
          } catch { /* non-fatal */ }
          return;
        }

        if (preview.blocked) {
          console.warn(`[tiered-rewards] Config "${fresh.name}" blocked:`, preview.blockReasons.join("; "));
          try {
            const db = getDb();
            db.prepare("UPDATE tiered_reward_configs SET last_failure_at = ? WHERE id = ?").run(Date.now(), fresh.id);
          } catch { /* non-fatal */ }
          return;
        }

        if (fresh.previewOnly) {
          // Log preview rows instead of running
          const ranAt = Date.now();
          try {
            const db = getDb();
            const stmt = db.prepare(
              `INSERT INTO tiered_reward_run_log
               (id, config_id, tier_number, holder_address, asset_code, asset_issuer, amount_sent, status, ran_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
            );
            const insertMany = db.transaction(() => {
              for (const assignment of preview.assignments) {
                for (const holder of assignment.holders) {
                  for (const asset of assignment.tier.assets) {
                    stmt.run(
                      crypto.randomUUID(), fresh.id, assignment.tier.tierNumber,
                      holder.address, asset.assetCode, asset.assetIssuer ?? null,
                      asset.amount, "preview", ranAt
                    );
                  }
                }
              }
            });
            insertMany();
          } catch { /* non-fatal */ }
          return;
        }

        const result = await runConfig(fresh, preview.assignments);
        if ("error" in result) {
          console.error(`[tiered-rewards] Run failed for "${fresh.name}":`, result.error);
          try {
            const db = getDb();
            db.prepare("UPDATE tiered_reward_configs SET last_failure_at = ? WHERE id = ?").run(Date.now(), fresh.id);
          } catch { /* non-fatal */ }
        } else if (result.totalFailed > 0) {
          try {
            const db = getDb();
            db.prepare("UPDATE tiered_reward_configs SET last_failure_at = ? WHERE id = ?").run(Date.now(), fresh.id);
          } catch { /* non-fatal */ }
        } else {
          try {
            const db = getDb();
            db.prepare("UPDATE tiered_reward_configs SET last_failure_at = NULL WHERE id = ?").run(fresh.id);
          } catch { /* non-fatal */ }
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
  global._tieredRewardsStarted = false;
  global._tieredRewardsStarted = true;
  scheduleAll();
}
