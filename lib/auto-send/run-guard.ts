import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly } from "@/lib/supabase-server";

export interface AutoSendRunGuard {
  startedAt: number;
  walletAddress: string;
  state: "running" | "blocked";
  transactions: Array<{ hash: string; destination: string; amount: number; status: "prepared" | "sent" | "rejected" }>;
}

export class AutoSendReconciliationRequiredError extends Error {
  constructor() {
    super("A previous payment may have succeeded. Check the transaction hashes and resolve the blocked run before sending again.");
    this.name = "AutoSendReconciliationRequiredError";
  }
}

export const guardId = (groupId: string) => `auto-send-guard:${groupId}`;

// shortcut: use one uniquely keyed run-log row as the durable guard; move to a
// dedicated journal table if runs need automatic resumption or per-operation querying.
export async function claimAutoSendRun(groupId: string, walletAddress: string): Promise<AutoSendRunGuard> {
  const guard: AutoSendRunGuard = { startedAt: Date.now(), walletAddress, state: "running", transactions: [] };
  const row = {
    id: guardId(groupId), group_id: groupId, wallet_address: walletAddress,
    destination: "", status: "guard", error: JSON.stringify(guard), ran_at: guard.startedAt,
  };
  if (isSupabaseOnly()) {
    const sb = getSupabase();
    if (!sb) throw new Error("Supabase is unavailable for Auto-Send run protection");
    const { error } = await sb.from("auto_send_run_log").insert(row);
    if (error?.code === "23505") throw new AutoSendReconciliationRequiredError();
    if (error) throw new Error(`Could not protect Auto-Send run: ${error.message}`);
  } else {
    const changes = getDb().prepare(`INSERT OR IGNORE INTO auto_send_run_log
      (id, group_id, wallet_address, destination, status, error, ran_at)
      VALUES (?, ?, ?, '', 'guard', ?, ?)`).run(row.id, groupId, walletAddress, row.error, guard.startedAt).changes;
    if (changes !== 1) throw new AutoSendReconciliationRequiredError();
  }
  return guard;
}

async function saveAutoSendRun(groupId: string, previous: AutoSendRunGuard, next: AutoSendRunGuard): Promise<void> {
  const oldValue = JSON.stringify(previous);
  const newValue = JSON.stringify(next);
  if (isSupabaseOnly()) {
    const sb = getSupabase();
    if (!sb) throw new Error("Supabase is unavailable for Auto-Send run protection");
    const { data, error } = await sb.from("auto_send_run_log").update({ error: newValue })
      .eq("id", guardId(groupId)).eq("error", oldValue).select("id");
    if (error || data?.length !== 1) throw new Error(`Could not record Auto-Send transaction: ${error?.message ?? "run guard changed"}`);
  } else {
    const changes = getDb().prepare("UPDATE auto_send_run_log SET error = ? WHERE id = ? AND error = ?")
      .run(newValue, guardId(groupId), oldValue).changes;
    if (changes !== 1) throw new Error("Could not record Auto-Send transaction: run guard changed");
  }
}

export async function recordAutoSendTransaction(
  groupId: string,
  guard: AutoSendRunGuard,
  transaction: AutoSendRunGuard["transactions"][number],
): Promise<AutoSendRunGuard> {
  const next = { ...guard, transactions: [...guard.transactions, transaction] };
  await saveAutoSendRun(groupId, guard, next);
  return next;
}

export async function markAutoSendTransactionSent(groupId: string, guard: AutoSendRunGuard, hash: string): Promise<AutoSendRunGuard> {
  const next = { ...guard, transactions: guard.transactions.map((tx) => tx.hash === hash ? { ...tx, status: "sent" as const } : tx) };
  await saveAutoSendRun(groupId, guard, next);
  return next;
}

export async function markAutoSendTransactionRejected(groupId: string, guard: AutoSendRunGuard, hash: string): Promise<AutoSendRunGuard> {
  const next = { ...guard, transactions: guard.transactions.map((tx) => tx.hash === hash ? { ...tx, status: "rejected" as const } : tx) };
  await saveAutoSendRun(groupId, guard, next);
  return next;
}

export async function blockAutoSendRun(groupId: string, guard: AutoSendRunGuard): Promise<void> {
  await saveAutoSendRun(groupId, guard, { ...guard, state: "blocked" });
}

export async function completeAutoSendRun(groupId: string, guard: AutoSendRunGuard): Promise<void> {
  if (guard.transactions.some((tx) => tx.status === "prepared")) throw new AutoSendReconciliationRequiredError();
  await deleteAutoSendRunGuard(groupId, guard);
}

export async function deleteAutoSendRunGuard(groupId: string, guard: AutoSendRunGuard): Promise<void> {
  if (isSupabaseOnly()) {
    const sb = getSupabase();
    if (!sb) throw new Error("Supabase is unavailable for Auto-Send run protection");
    const { data, error } = await sb.from("auto_send_run_log").delete()
      .eq("id", guardId(groupId)).eq("error", JSON.stringify(guard)).select("id");
    if (error || data?.length !== 1) throw new Error(`Could not complete Auto-Send run: ${error?.message ?? "run guard changed"}`);
  } else {
    const changes = getDb().prepare("DELETE FROM auto_send_run_log WHERE id = ? AND error = ?")
      .run(guardId(groupId), JSON.stringify(guard)).changes;
    if (changes !== 1) throw new Error("Could not complete Auto-Send run: run guard changed");
  }
}

export async function readAutoSendRunGuard(groupId: string): Promise<AutoSendRunGuard | null> {
  let raw: string | null;
  if (isSupabaseOnly()) {
    const sb = getSupabase();
    if (!sb) throw new Error("Supabase is unavailable for Auto-Send run protection");
    const { data, error } = await sb.from("auto_send_run_log").select("error").eq("id", guardId(groupId)).maybeSingle();
    if (error) throw new Error(`Could not read Auto-Send run guard: ${error.message}`);
    raw = (data?.error as string | null) ?? null;
  } else {
    raw = (getDb().prepare("SELECT error FROM auto_send_run_log WHERE id = ?").get(guardId(groupId)) as { error: string } | undefined)?.error ?? null;
  }
  if (!raw) return null;
  const value = JSON.parse(raw) as AutoSendRunGuard;
  if (!Number.isFinite(value.startedAt) || !Array.isArray(value.transactions) || !["running", "blocked"].includes(value.state)) {
    throw new Error("Auto-Send run guard is invalid");
  }
  return value;
}
