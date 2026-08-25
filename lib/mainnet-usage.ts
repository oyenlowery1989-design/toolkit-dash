import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly } from "@/lib/supabase-server";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function autoSendXlmLast24Hours(walletAddress: string, now = Date.now()): Promise<number> {
  const since = now - DAY_MS;
  if (isSupabaseOnly()) {
    const { data, error } = await getSupabase()!.from("auto_send_run_log")
      .select("amount_sent")
      .eq("wallet_address", walletAddress)
      .eq("status", "sent")
      .gte("ran_at", since);
    if (error) throw new Error(error.message);
    return (data ?? []).reduce((sum, row) => sum + Number(row.amount_sent ?? 0), 0);
  }
  const row = getDb().prepare(
    "SELECT COALESCE(SUM(amount_sent), 0) AS total FROM auto_send_run_log WHERE wallet_address = ? AND status = 'sent' AND ran_at >= ?",
  ).get(walletAddress, since) as { total: number };
  return Number(row.total ?? 0);
}

export async function tieredRewardXlmLast24Hours(userId?: string, now = Date.now()): Promise<number> {
  const since = now - DAY_MS;
  if (isSupabaseOnly()) {
    let query = getSupabase()!.from("tiered_reward_run_log")
      .select("amount_sent")
      .eq("status", "sent")
      .eq("asset_code", "XLM")
      .gte("ran_at", since);
    if (userId) query = query.eq("user_id", userId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? []).reduce((sum, row) => sum + Number(row.amount_sent ?? 0), 0);
  }
  const row = getDb().prepare(
    "SELECT COALESCE(SUM(amount_sent), 0) AS total FROM tiered_reward_run_log WHERE status = 'sent' AND UPPER(asset_code) = 'XLM' AND ran_at >= ?",
  ).get(since) as { total: number };
  return Number(row.total ?? 0);
}
