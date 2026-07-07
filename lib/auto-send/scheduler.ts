/**
 * Auto-Send Group scheduler.
 * Uses node-cron to schedule enabled groups server-side.
 * Uses a global singleton so HMR restarts don't spawn duplicate schedulers.
 */

import type { ScheduledTask } from "node-cron";
import type { AutoSendGroup } from "./types";

declare global {
  var _autoSendTasks: Map<string, ScheduledTask> | undefined;
  var _autoSendStarted: boolean | undefined;
  var _autoSendRunningGroups: Set<string> | undefined;
}

// Globalized like the two singletons above — an HMR module reload must not
// hand a running group a fresh, empty overlap-guard while its run is in flight.
if (!global._autoSendRunningGroups) global._autoSendRunningGroups = new Set<string>();
const _runningGroups = global._autoSendRunningGroups;

function getDb() {
  // Lazy import to avoid issues in non-Node contexts
  const { getDb: _getDb } = require("@/lib/db");
  return _getDb();
}

function loadEnabledGroups(): AutoSendGroup[] {
  try {
    const db = getDb();
    const groups = db
      .prepare(
        `SELECT * FROM auto_send_groups WHERE enabled = 1 AND interval_minutes IS NOT NULL ORDER BY created_at ASC`
      )
      .all() as Record<string, unknown>[];

    return groups.map((g) => {
      const dests = db
        .prepare(`SELECT * FROM auto_send_destinations WHERE group_id = ? ORDER BY position ASC`)
        .all(g.id) as Record<string, unknown>[];
      return {
        id: g.id as string,
        name: g.name as string,
        network: (g.network as string) ?? "public",
        secretKey: (g.secret_key as string) ?? "",
        intervalMinutes: g.interval_minutes as number,
        enabled: true,
        batchSend: (g.batch_send as number) === 1,
        batchMemo: (g.batch_memo as string) ?? undefined,
        minReserve: (g.min_reserve as number) ?? 10.0,
        minSenderThreshold: (g.min_sender_threshold as number) ?? 0,
        previewOnly: (g.preview_only as number) === 1,
        lastFailureAt: (g.last_failure_at as number) ?? undefined,
        createdAt: g.created_at as number,
        destinations: dests.map((d) => ({
          id: d.id as string,
          groupId: d.group_id as string,
          destination: d.destination as string,
          percentage: d.percentage as number,
          isRemainder: (d.is_remainder as number) === 1,
          paused: (d.is_paused as number) === 1,
          label: (d.label as string) ?? undefined,
          memo: (d.memo as string) ?? undefined,
          minThreshold: (d.min_threshold as number) ?? 0,
          maxCap: (d.max_cap as number) ?? 0,
          position: d.position as number,
        })),
      };
    });
  } catch (err) {
    console.error("[auto-send] Failed to load groups from DB:", err);
    return [];
  }
}

function minutesToCronExpression(minutes: number): string {
  if (minutes < 60) return `*/${Math.max(1, minutes)} * * * *`;
  const hours = Math.floor(minutes / 60);
  return `0 */${Math.max(1, hours)} * * *`;
}

export function startScheduler(): void {
  // Skip on Vercel (serverless — no persistent process)
  if (process.env.VERCEL) return;

  // Singleton guard — only start once per process
  if (global._autoSendStarted) return;
  global._autoSendStarted = true;
  global._autoSendTasks = new Map();

  console.log("[auto-send] Scheduler starting...");
  scheduleAll();
}

function scheduleAll(): void {
  const cron = require("node-cron") as typeof import("node-cron");
  const tasks = global._autoSendTasks!;

  // Destroy existing tasks
  for (const task of tasks.values()) task.stop();
  tasks.clear();

  const groups = loadEnabledGroups();
  for (const group of groups) {
    if (!group.intervalMinutes) continue;
    const expr = minutesToCronExpression(group.intervalMinutes);
    const task = cron.schedule(expr, async () => {
      if (_runningGroups.has(group.id)) {
        console.warn(`[auto-send] Group "${group.name}" still running — skipping tick`);
        return;
      }
      _runningGroups.add(group.id);
      console.log(`[auto-send] Running group "${group.name}" (${group.id})`);
      try {
        const { runGroup, previewGroup } = await import("./runner");
        // Reload group from DB to get latest config
        const freshGroups = loadEnabledGroups();
        const fresh = freshGroups.find((g) => g.id === group.id);
        if (fresh) {
          if (fresh.previewOnly) {
            const result = await previewGroup(fresh);
            if (!("error" in result)) {
              // Log each item as "preview" status
              const db = getDb();
              const ranAt = Date.now();
              const walletAddress = result.walletAddress;
              for (const item of result.items) {
                try {
                  db.prepare(
                    `INSERT INTO auto_send_run_log (id, group_id, wallet_address, destination, amount_sent, status, error, ran_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
                  ).run(
                    crypto.randomUUID(), fresh.id, walletAddress, item.destination,
                    item.wouldSkip ? null : item.amountXlm, "preview",
                    item.wouldSkip ? item.skipReason ?? null : null, ranAt
                  );
                } catch { /* non-fatal */ }
              }
            }
          } else {
            const result = await runGroup(fresh);
            // Track failure/success for alert banner
            try {
              const db = getDb();
              const ranAt = Date.now();
              const hasFailed = result.results.some((r) => r.status === "failed");
              const nonSkipped = result.results.filter((r) => r.status !== "skipped");
              // Require at least one real send — otherwise an all-skipped run (e.g. every
              // destination below its threshold) vacuously satisfies .every() and would
              // wrongly clear an existing failure banner.
              const allSent = nonSkipped.length > 0 && nonSkipped.every((r) => r.status === "sent");
              if (hasFailed) {
                db.prepare("UPDATE auto_send_groups SET last_failure_at = ? WHERE id = ?").run(ranAt, fresh.id);
              } else if (allSent) {
                db.prepare("UPDATE auto_send_groups SET last_failure_at = NULL WHERE id = ?").run(fresh.id);
              }
            } catch { /* non-fatal */ }
          }
        }
      } catch (err) {
        console.error(`[auto-send] Group "${group.name}" run failed:`, err);
      } finally {
        _runningGroups.delete(group.id);
      }
    });
    tasks.set(group.id, task);
    console.log(`[auto-send] Scheduled "${group.name}" every ${group.intervalMinutes}m (${expr})`);
  }
}

/** Call after group changes to reload all schedules. */
export function refreshScheduler(): void {
  if (!global._autoSendStarted) return;
  scheduleAll();
}
