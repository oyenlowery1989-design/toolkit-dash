import { createHash, randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly } from "@/lib/supabase-server";
import { createPreviewApproval, verifyPreviewApproval } from "@/lib/mainnet-safety";
import type { RunResult } from "./runner";

type Outcome = RunResult | { error: string };
type Approval = { configId: string; userId: string; digest: string; outcome?: Outcome };

export function createRewardApproval(configId: string, userId: string, digest: string) {
  const nonce = randomUUID();
  const signed = createPreviewApproval(`tiered-rewards:${configId}:${nonce}`, userId, digest);
  return signed ? `${nonce}:${signed}` : null;
}

export function verifyRewardApproval(token: unknown, configId: string, userId: string, digest: string): token is string {
  if (typeof token !== "string") return false;
  const separator = token.indexOf(":");
  if (separator < 1) return false;
  return verifyPreviewApproval(token.slice(separator + 1), `tiered-rewards:${configId}:${token.slice(0, separator)}`, userId, digest);
}

const resourceId = (token: string) => `reward-approval:${createHash("sha256").update(token).digest("hex")}`;

export async function readRewardApproval(token: unknown, configId: string, userId: string): Promise<Approval | null> {
  if (typeof token !== "string") return null;
  let raw: string | undefined;
  if (isSupabaseOnly()) {
    const sb = getSupabase();
    if (!sb) throw new Error("Reward approval protection is unavailable");
    const { data, error } = await sb.from("tiered_reward_run_leases").select("lease_token").eq("resource_id", resourceId(token)).maybeSingle();
    if (error) throw new Error(`Could not read reward approval: ${error.message}`);
    raw = data?.lease_token;
  } else {
    raw = (getDb().prepare("SELECT lease_token FROM tiered_reward_run_leases WHERE resource_id = ?").get(resourceId(token)) as { lease_token: string } | undefined)?.lease_token;
  }
  if (!raw) return null;
  const approval = JSON.parse(raw) as Approval;
  // The exact token hash already identifies a server-verified claim; expiry gates new execution, not reading its outcome.
  if (approval.configId !== configId || approval.userId !== userId || typeof approval.digest !== "string") return null;
  return approval;
}

export async function executeRewardApproval(token: string, configId: string, userId: string, digest: string, execute: () => Promise<Outcome>): Promise<Outcome> {
  const id = resourceId(token);
  const previous = JSON.stringify({ configId, userId, digest });
  // shortcut: retain approvals in the existing durable journal table; add archival
  // cleanup only when expired completed approvals need bounded storage.
  if (isSupabaseOnly()) {
    const sb = getSupabase();
    if (!sb) throw new Error("Reward approval protection is unavailable");
    const { error } = await sb.from("tiered_reward_run_leases").insert({ resource_id: id, lease_token: previous, expires_at: Number.MAX_SAFE_INTEGER });
    if (error?.code === "23505") return { error: "This approval is already executing or completed. Retry to retrieve its outcome." };
    if (error) throw new Error(`Could not claim reward approval: ${error.message}`);
  } else {
    const claimed = getDb().prepare("INSERT OR IGNORE INTO tiered_reward_run_leases (resource_id, lease_token, expires_at) VALUES (?, ?, ?)").run(id, previous, Number.MAX_SAFE_INTEGER).changes;
    if (claimed !== 1) return { error: "This approval is already executing or completed. Retry to retrieve its outcome." };
  }
  const outcome = await execute();
  const next = JSON.stringify({ configId, userId, digest, outcome });
  if (isSupabaseOnly()) {
    const { data, error } = await getSupabase()!.from("tiered_reward_run_leases").update({ lease_token: next }).eq("resource_id", id).eq("lease_token", previous).select("resource_id");
    if (error || data?.length !== 1) throw new Error("Could not record reward outcome; approval remains blocked. Inspect run history.");
  } else {
    const changed = getDb().prepare("UPDATE tiered_reward_run_leases SET lease_token = ? WHERE resource_id = ? AND lease_token = ?").run(next, id, previous).changes;
    if (changed !== 1) throw new Error("Could not record reward outcome; approval remains blocked. Inspect run history.");
  }
  return outcome;
}
