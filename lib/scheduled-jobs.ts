import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly } from "@/lib/supabase-server";

/** Minute-resolution polling with a durable interval cursor; supports 90m, 48h, etc. */
export async function claimSchedule(kind: string, id: string, minutes: number, claim = true, now = Date.now()): Promise<boolean> {
  if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 525_600) throw new Error("Invalid schedule interval");
  if (isSupabaseOnly()) {
    const { data, error } = await getSupabase()!.rpc("claim_scheduled_job", { p_kind: kind, p_id: id, p_minutes: minutes, p_claim: claim });
    if (error) throw new Error(error.message);
    return data === true;
  }
  const db = getDb();
  return db.transaction(() => {
    const row = db.prepare("SELECT interval_minutes, next_run_at FROM scheduled_jobs WHERE kind = ? AND resource_id = ?").get(kind, id) as { interval_minutes: number; next_run_at: number } | undefined;
    if (!row || row.interval_minutes !== minutes) {
      db.prepare("INSERT INTO scheduled_jobs (kind, resource_id, interval_minutes, next_run_at) VALUES (?, ?, ?, ?) ON CONFLICT(kind, resource_id) DO UPDATE SET interval_minutes=excluded.interval_minutes, next_run_at=excluded.next_run_at").run(kind, id, minutes, now + minutes * 60_000);
      return false;
    }
    if (!claim || row.next_run_at > now) return false;
    // Skip missed ticks rather than replaying payments after a restart.
    db.prepare("UPDATE scheduled_jobs SET next_run_at = ? WHERE kind = ? AND resource_id = ?").run(now + minutes * 60_000, kind, id);
    return true;
  }).immediate();
}
