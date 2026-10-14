import type { SupabaseClient } from "@supabase/supabase-js";
import { readAllChildRows, readPages, type SupabaseRows } from "@/lib/supabase-read-all";

/** Server-only safety rows have no user_id; scope them through their resource/payload. */
export async function readBackupRunGuards(sb: SupabaseClient, userId: string, configIds: string[]): Promise<SupabaseRows> {
  const guards = await readAllChildRows(sb, "tiered_reward_run_leases", "resource_id", [
    ...configIds.map(id => `reward-guard:${id}`), `payment-guard:${userId}`,
  ]);
  if (guards.error) return guards;
  const approvals = await readPages((from, to) => sb.from("tiered_reward_run_leases")
    .select("*", { count: "exact" }).like("resource_id", "reward-approval:%").order("resource_id").range(from, to));
  if (approvals.error) return approvals;
  const owned = new Set(configIds);
  for (const row of approvals.data!) {
    let approval: { userId?: string; configId?: string };
    try { approval = JSON.parse(row.lease_token as string); }
    catch { return { data: null, error: { message: "Invalid reward approval safety record; investigate before restoring." } }; }
    if (approval.userId === userId && approval.configId && owned.has(approval.configId)) guards.data!.push(row);
  }
  return guards;
}

export const LOCAL_RUN_GUARDS_SQL = "SELECT * FROM tiered_reward_run_leases WHERE resource_id LIKE 'reward-guard:%' OR resource_id LIKE 'reward-approval:%' OR resource_id = 'payment-guard:local'";

/** Only the local/current cloud identity is equivalent; all other receipt fields remain immutable. */
export function normalizeApprovalGuardToken(resourceId: string, raw: string, userId: string): string {
  if (!resourceId.startsWith("reward-approval:")) return raw;
  try {
    const approval = JSON.parse(raw);
    return approval.userId === "local" || approval.userId === userId
      ? JSON.stringify({ ...approval, userId }) : raw;
  } catch { return raw; }
}
