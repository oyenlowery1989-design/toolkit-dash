/**
 * Auto-Send Group scheduler.
 * Uses node-cron to schedule enabled groups server-side.
 * Uses a global singleton so HMR restarts don't spawn duplicate schedulers.
 */

import type { ScheduledTask } from "node-cron";
import type { AutoSendGroup } from "./types";
import { rowToGroup } from "./db-map";
import { getSupabase, isSupabaseOnly } from "@/lib/supabase-server";

declare global {
  var _autoSendTasks: Map<string, ScheduledTask> | undefined;
  var _autoSendStarted: boolean | undefined;
  var _autoSendRunningGroups: Set<string> | undefined;
}

// Globalized like the two singletons above — an HMR module reload must not
// hand a running group a fresh, empty overlap-guard while its run is in flight.
if (!global._autoSendRunningGroups) global._autoSendRunningGroups = new Set<string>();
const _runningGroups = global._autoSendRunningGroups;

/** A loaded group, tagged with the Supabase user_id that owns it (Supabase mode only —
 *  used so last_failure_at write-back can be scoped to the right user). */
type ScheduledGroup = AutoSendGroup & { userId?: string };

function getDb() {
  // Lazy import to avoid issues in non-Node contexts
  const { getDb: _getDb } = require("@/lib/db");
  return _getDb();
}

function loadEnabledGroupsFromSqlite(): ScheduledGroup[] {
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
      return rowToGroup(g, dests);
    });
  } catch (err) {
    console.error("[auto-send] Failed to load groups from DB:", err);
    return [];
  }
}

/** Self-hosted (non-Vercel) deployments explicitly configured with DB_PROVIDER=supabase must
 *  read from Supabase here too — otherwise the scheduler process keeps reading stale/absent
 *  local SQLite while the UI's API routes correctly write to Supabase, so enabling/disabling/
 *  deleting a group through the UI has zero effect on what the running scheduler executes.
 *  Uses the service-role client (bypasses RLS) since the scheduler runs across all users. */
async function loadEnabledGroupsFromSupabase(): Promise<ScheduledGroup[]> {
  const sb = getSupabase();
  if (!sb) return [];

  const { data: groups, error } = await sb
    .from("auto_send_groups")
    .select("*")
    .eq("enabled", true)
    .not("interval_minutes", "is", null)
    .order("created_at", { ascending: true });

  if (error || !groups) {
    console.error("[auto-send] Failed to load groups from Supabase:", error);
    return [];
  }

  const result: ScheduledGroup[] = [];
  for (const g of groups as Record<string, unknown>[]) {
    const { data: dests } = await sb
      .from("auto_send_destinations")
      .select("*")
      .eq("group_id", g.id)
      .order("position", { ascending: true });
    result.push({ ...rowToGroup(g, dests ?? []), userId: (g.user_id as string | undefined) || undefined });
  }
  return result;
}

async function loadEnabledGroups(): Promise<ScheduledGroup[]> {
  if (isSupabaseOnly()) return loadEnabledGroupsFromSupabase();
  return loadEnabledGroupsFromSqlite();
}

/** Dual-mode write-back for the group's failure-alert timestamp — scheduler.ts is the only
 *  caller (the manual-run route has no equivalent write). Pass `null` to clear it. */
async function setGroupLastFailure(groupId: string, userId: string | undefined, timestamp: number | null): Promise<void> {
  if (isSupabaseOnly()) {
    const sb = getSupabase();
    if (!sb) return;
    try {
      const query = sb.from("auto_send_groups").update({ last_failure_at: timestamp }).eq("id", groupId);
      const { error } = await (userId ? query.eq("user_id", userId) : query);
      if (error) console.error("[auto-send] last_failure_at Supabase update failed:", error);
    } catch (err) {
      console.error("[auto-send] last_failure_at Supabase update threw:", err);
    }
    return;
  }
  try {
    const db = getDb();
    db.prepare("UPDATE auto_send_groups SET last_failure_at = ? WHERE id = ?").run(timestamp, groupId);
  } catch { /* non-fatal */ }
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
  scheduleAll().catch((err) => console.error("[auto-send] scheduleAll failed:", err));
}

async function scheduleAll(): Promise<void> {
  const cron = require("node-cron") as typeof import("node-cron");
  const tasks = global._autoSendTasks!;

  // Destroy existing tasks
  for (const task of tasks.values()) task.stop();
  tasks.clear();

  const groups = await loadEnabledGroups();
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
        const freshGroups = await loadEnabledGroups();
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
            const hasFailed = result.results.some((r) => r.status === "failed");
            const nonSkipped = result.results.filter((r) => r.status !== "skipped");
            // Require at least one real send — otherwise an all-skipped run (e.g. every
            // destination below its threshold) vacuously satisfies .every() and would
            // wrongly clear an existing failure banner.
            const allSent = nonSkipped.length > 0 && nonSkipped.every((r) => r.status === "sent");
            if (hasFailed) {
              await setGroupLastFailure(fresh.id, fresh.userId, Date.now());
            } else if (allSent) {
              await setGroupLastFailure(fresh.id, fresh.userId, null);
            }
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
  scheduleAll().catch((err) => console.error("[auto-send] scheduleAll failed:", err));
}
