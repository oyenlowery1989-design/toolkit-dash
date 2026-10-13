import { TransactionBuilder, type Horizon, type Transaction } from "stellar-sdk";
import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly } from "@/lib/supabase-server";

export class UncertainRewardSubmission extends Error {
  constructor(readonly txHash: string) {
    super(`Submission unresolved (${txHash}); reconcile this run before sending again`);
  }
}

type Journal = { token: string; transactions: { hash: string; xdr: string; status: "prepared" | "sent" | "rejected" }[] };

// shortcut: permanent namespaced rows reuse the existing server-only lease table;
// move to a dedicated table if journal retention or audit queries are needed.
const guardId = (configId: string) => `reward-guard:${configId}`;

export async function inspectRewardRun(configId: string, server: Horizon.Server, networkPassphrase: string) {
  const id = guardId(configId);
  let raw: string | undefined;
  if (isSupabaseOnly()) {
    const sb = getSupabase();
    if (!sb) throw new Error("Reward run protection is unavailable");
    const { data, error } = await sb.from("tiered_reward_run_leases").select("lease_token").eq("resource_id", id).maybeSingle();
    if (error) throw new Error(`Could not read reward run protection: ${error.message}`);
    raw = data?.lease_token;
  } else {
    raw = (getDb().prepare("SELECT lease_token FROM tiered_reward_run_leases WHERE resource_id = ?").get(id) as { lease_token?: string } | undefined)?.lease_token;
  }
  if (!raw) return null;
  let journal: Journal;
  try { journal = JSON.parse(raw) as Journal; } catch { throw new Error("Reward run journal is invalid; manual investigation required"); }
  if (typeof journal.token !== "string" || !Array.isArray(journal.transactions) ||
    journal.transactions.some((tx) => {
      if (!/^[0-9a-f]{64}$/.test(tx.hash) || typeof tx.xdr !== "string") return true;
      try { return TransactionBuilder.fromXDR(tx.xdr, networkPassphrase).hash().toString("hex") !== tx.hash; }
      catch { return true; }
    })) {
    throw new Error("Reward run journal is incomplete; manual investigation required");
  }
  const transactions = await Promise.all(journal.transactions.map(async (tx) => {
    let successful: boolean | undefined;
    try {
      const result = await server.transactions().transaction(tx.hash).call();
      if (typeof result.successful === "boolean") successful = result.successful;
    } catch { /* A missing or unavailable Horizon record is never proof of rejection. */ }
    return { hash: tx.hash, successful: successful ?? null };
  }));
  return { raw, transactions, ready: transactions.every((tx) => tx.successful !== null) };
}

export async function releaseRewardRun(configId: string, expectedRaw: string) {
  const id = guardId(configId);
  if (isSupabaseOnly()) {
    const sb = getSupabase();
    if (!sb) throw new Error("Reward run protection is unavailable");
    const { data, error } = await sb.from("tiered_reward_run_leases").delete()
      .eq("resource_id", id).eq("lease_token", expectedRaw).select("resource_id");
    if (error || data?.length !== 1) throw new Error("Reward run changed during reconciliation; inspect it again");
  } else {
    const changes = getDb().prepare("DELETE FROM tiered_reward_run_leases WHERE resource_id = ? AND lease_token = ?").run(id, expectedRaw).changes;
    if (changes !== 1) throw new Error("Reward run changed during reconciliation; inspect it again");
  }
}

export async function claimRewardRun(configId: string) {
  const id = guardId(configId);
  let journal: Journal = { token: crypto.randomUUID(), transactions: [] };
  const duplicate = () => new Error("A previous reward run requires reconciliation before sending again");
  if (isSupabaseOnly()) {
    const sb = getSupabase();
    if (!sb) throw new Error("Reward run protection is unavailable");
    const { error } = await sb.from("tiered_reward_run_leases").insert({ resource_id: id, lease_token: JSON.stringify(journal), expires_at: Number.MAX_SAFE_INTEGER });
    if (error?.code === "23505") throw duplicate();
    if (error) throw new Error(`Could not protect reward run: ${error.message}`);
  } else {
    const changes = getDb().prepare("INSERT OR IGNORE INTO tiered_reward_run_leases (resource_id, lease_token, expires_at) VALUES (?, ?, ?)")
      .run(id, JSON.stringify(journal), Number.MAX_SAFE_INTEGER).changes;
    if (changes !== 1) throw duplicate();
  }

  async function save(next: Journal | null) {
    const previous = JSON.stringify(journal);
    if (isSupabaseOnly()) {
      const sb = getSupabase();
      if (!sb) throw new Error("Reward run protection is unavailable");
      const query = next
        ? sb.from("tiered_reward_run_leases").update({ lease_token: JSON.stringify(next) })
        : sb.from("tiered_reward_run_leases").delete();
      const { data, error } = await query.eq("resource_id", id).eq("lease_token", previous).select("resource_id");
      if (error || data?.length !== 1) throw new Error("Could not update reward run protection; reconciliation required");
    } else {
      const changes = next
        ? getDb().prepare("UPDATE tiered_reward_run_leases SET lease_token = ? WHERE resource_id = ? AND lease_token = ?").run(JSON.stringify(next), id, previous).changes
        : getDb().prepare("DELETE FROM tiered_reward_run_leases WHERE resource_id = ? AND lease_token = ?").run(id, previous).changes;
      if (changes !== 1) throw new Error("Could not update reward run protection; reconciliation required");
    }
    if (next) journal = next;
  }

  async function mark(hash: string, status: "sent" | "rejected") {
    await save({ ...journal, transactions: journal.transactions.map((tx) => tx.hash === hash ? { ...tx, status } : tx) });
  }

  return {
    async submit(server: Horizon.Server, tx: Transaction): Promise<{ hash: string }> {
      const hash = tx.hash().toString("hex");
      await save({ ...journal, transactions: [...journal.transactions, { hash, xdr: tx.toXDR(), status: "prepared" }] });
      try {
        await server.submitTransaction(tx);
      } catch (error) {
        let successful: boolean | undefined;
        try { successful = (await server.transactions().transaction(hash).call()).successful; } catch { /* absence is not rejection */ }
        if (successful === true) {
          try { await mark(hash, "sent"); } catch { throw new UncertainRewardSubmission(hash); }
          return { hash };
        }
        const codes = (error as { response?: { data?: { extras?: { result_codes?: { transaction?: string; operations?: string[] } } } } })?.response?.data?.extras?.result_codes;
        // tx_bad_seq may be a duplicate response after the original reached the ledger.
        const rejected = successful === false || (codes?.transaction !== "tx_bad_seq" && Boolean(codes?.transaction || codes?.operations?.length));
        if (rejected) {
          await mark(hash, "rejected");
          throw error;
        }
        throw new UncertainRewardSubmission(hash);
      }
      try { await mark(hash, "sent"); } catch { throw new UncertainRewardSubmission(hash); }
      return { hash };
    },
    async complete(failed: boolean): Promise<boolean> {
      const blocked = journal.transactions.some((tx) => tx.status === "prepared") ||
        (failed && journal.transactions.some((tx) => tx.status === "sent"));
      if (!blocked) await save(null);
      return blocked;
    },
  };
}
export type RewardRunGuard = Awaited<ReturnType<typeof claimRewardRun>>;
