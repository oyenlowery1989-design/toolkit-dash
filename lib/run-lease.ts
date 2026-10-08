import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly } from "@/lib/supabase-server";

export type RunLeaseTable = "auto_send_run_leases" | "tiered_reward_run_leases";

const LEASE_TTL_MS = 30 * 60 * 1000;

export async function acquireRunLease(table: RunLeaseTable, resourceId: string): Promise<string | null> {
  const token = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = now + LEASE_TTL_MS;

  if (isSupabaseOnly()) {
    const sb = getSupabase();
    if (!sb) throw new Error("Supabase is not configured for run locking");
    const { error: cleanupError } = await sb.from(table).delete().eq("resource_id", resourceId).lt("expires_at", now);
    if (cleanupError) throw new Error(`Could not clean expired run lease: ${cleanupError.message}`);
    const { error } = await sb.from(table).insert({ resource_id: resourceId, lease_token: token, expires_at: expiresAt });
    if (!error) return token;
    if (error.code === "23505") return null;
    throw new Error(`Could not acquire run lease: ${error.message}`);
  }

  const db = getDb();
  const acquire = db.transaction(() => {
    db.prepare(`DELETE FROM ${table} WHERE resource_id = ? AND expires_at < ?`).run(resourceId, now);
    return db.prepare(
      `INSERT OR IGNORE INTO ${table} (resource_id, lease_token, expires_at) VALUES (?, ?, ?)`,
    ).run(resourceId, token, expiresAt).changes === 1;
  });
  return acquire() ? token : null;
}

export async function releaseRunLease(table: RunLeaseTable, resourceId: string, token: string): Promise<void> {
  if (isSupabaseOnly()) {
    const sb = getSupabase();
    if (!sb) return;
    const { error } = await sb.from(table).delete().eq("resource_id", resourceId).eq("lease_token", token);
    if (error) console.error(`[run-lease] failed to release ${table}/${resourceId}:`, error);
    return;
  }
  getDb().prepare(`DELETE FROM ${table} WHERE resource_id = ? AND lease_token = ?`).run(resourceId, token);
}

/** Revalidate ownership immediately before every network submission. */
export async function renewRunLease(table: RunLeaseTable, resourceId: string, token: string): Promise<void> {
  const now = Date.now();
  if (isSupabaseOnly()) {
    const { data, error } = await getSupabase()!.from(table).update({ expires_at: now + LEASE_TTL_MS })
      .eq("resource_id", resourceId).eq("lease_token", token).gte("expires_at", now).select("resource_id").maybeSingle();
    if (error || !data) throw new Error("Execution lease expired or changed; stop and reconcile before retrying");
  } else {
    const result = getDb().prepare(`UPDATE ${table} SET expires_at = ? WHERE resource_id = ? AND lease_token = ? AND expires_at >= ?`).run(now + LEASE_TTL_MS, resourceId, token, now);
    if (result.changes !== 1) throw new Error("Execution lease expired or changed; stop and reconcile before retrying");
  }
}
