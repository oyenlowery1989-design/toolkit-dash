import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly } from "@/lib/supabase-server";

export type ExecutionStatus = "reserved" | "submitted" | "rejected" | "unknown";
export interface ExecutionRecord { hash: string; source: string; stroops: string; status: ExecutionStatus; result_json: string | null; created_at: number }
const DAY = 86_400_000;

export async function reserveExecution(hash: string, source: string, stroops: bigint, max: bigint): Promise<boolean> {
  if (isSupabaseOnly()) {
    const { data, error } = await getSupabase()!.rpc("reserve_mainnet_execution", {
      p_hash: hash, p_source: source, p_stroops: stroops.toString(), p_max: max.toString(),
    });
    if (error) throw new Error(`Cannot reserve spending budget: ${error.message}`);
    return data === true;
  }
  const db = getDb(), now = Date.now();
  return db.transaction(() => {
    if (db.prepare("SELECT 1 FROM mainnet_executions WHERE hash = ?").get(hash)) return false;
    if (db.prepare("SELECT 1 FROM mainnet_executions WHERE source = ? AND status IN ('reserved','unknown')").get(source)) {
      throw new Error("This account has an unresolved execution; reconcile its transaction before retrying");
    }
    // Uncertain outcomes do not age out. Confirmed submissions are charged for 24h.
    const { total } = db.prepare("SELECT CAST(COALESCE(SUM(stroops),0) AS TEXT) AS total FROM mainnet_executions WHERE status IN ('reserved','unknown') OR (status IN ('submitted','rejected') AND created_at >= ?)").get(now - DAY) as { total: string };
    if (BigInt(total) + stroops > max) throw new Error("Daily deployment XLM budget would be exceeded");
    db.prepare("INSERT INTO mainnet_executions (hash, source, stroops, status, created_at) VALUES (?, ?, ?, 'reserved', ?)").run(hash, source, stroops.toString(), now);
    return true;
  }).immediate();
}
export async function readExecution(hash: string): Promise<ExecutionRecord | null> {
  if (isSupabaseOnly()) {
    const { data, error } = await getSupabase()!.from("mainnet_executions").select("*").eq("hash", hash).maybeSingle();
    if (error) throw new Error(error.message);
    return data as ExecutionRecord | null;
  }
  return getDb().prepare("SELECT * FROM mainnet_executions WHERE hash = ?").get(hash) as ExecutionRecord ?? null;
}
export async function finishExecution(hash: string, status: ExecutionStatus, result?: unknown, chargedStroops?: bigint): Promise<void> {
  const resultJson = result ? JSON.stringify(result) : null;
  if (isSupabaseOnly()) {
    const { error } = await getSupabase()!.from("mainnet_executions").update({ status, result_json: resultJson, ...(status === "submitted" || status === "rejected" ? { created_at: Date.now() } : {}), ...(chargedStroops !== undefined ? { stroops: chargedStroops.toString() } : {}) }).eq("hash", hash).select("hash").single();
    if (error) throw new Error(`Execution accounting failed: ${error.message}`);
  } else {
    const changed = getDb().prepare("UPDATE mainnet_executions SET status = ?, result_json = ?, stroops = COALESCE(?, stroops), created_at = COALESCE(?, created_at) WHERE hash = ?").run(status, resultJson, chargedStroops?.toString() ?? null, status === "submitted" || status === "rejected" ? Date.now() : null, hash);
    if (changed.changes !== 1) throw new Error("Execution accounting row is missing");
  }
}
export async function deploymentUsage(): Promise<number> {
  if (isSupabaseOnly()) {
    const { data, error } = await getSupabase()!.rpc("mainnet_budget_usage");
    if (error) throw new Error(error.message);
    return Number(data) / 1e7;
  }
  const row = getDb().prepare("SELECT CAST(COALESCE(SUM(stroops),0) AS TEXT) AS total FROM mainnet_executions WHERE status IN ('reserved','unknown') OR (status IN ('submitted','rejected') AND created_at >= ?)").get(Date.now() - DAY) as { total: string };
  return Number(row.total) / 1e7;
}
