import { Horizon, Networks, TransactionBuilder, FeeBumpTransaction, rpc, type Transaction } from "stellar-sdk";
import { SOROBAN_RPC_URLS } from "@/lib/soroban/sac";
import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly } from "@/lib/supabase-server";

export interface PaymentSubmission {
  hash: string;
  xdr: string;
  startLedger?: number;
  status: "pending" | "success" | "failed";
  response?: { status: number; body: Record<string, unknown> };
}

// Reuse server-only durable journals; regular expiring account leases never touch this prefix.
const idFor = (userId: string | null) => `payment-guard:${isSupabaseOnly() ? userId : "local"}`;

export async function readPaymentSubmission(userId: string | null): Promise<PaymentSubmission | null> {
  let raw: string | undefined;
  if (isSupabaseOnly()) {
    const { data, error } = await getSupabase()!.from("tiered_reward_run_leases")
      .select("lease_token").eq("resource_id", idFor(userId)).maybeSingle();
    if (error) throw new Error("Payment recovery is unavailable");
    raw = data?.lease_token;
  } else {
    raw = (getDb().prepare("SELECT lease_token FROM tiered_reward_run_leases WHERE resource_id = ?")
      .get(idFor(userId)) as { lease_token: string } | undefined)?.lease_token;
  }
  if (!raw) return null;
  const value = JSON.parse(raw) as PaymentSubmission;
  if (!["pending", "success", "failed"].includes(value.status) ||
      TransactionBuilder.fromXDR(value.xdr, Networks.PUBLIC).hash().toString("hex") !== value.hash) {
    throw new Error("Invalid payment recovery record; investigate before sending again");
  }
  return value;
}

export async function beginPaymentSubmission(userId: string | null, tx: Transaction | FeeBumpTransaction) {
  const existing = await readPaymentSubmission(userId);
  if (existing) return existing;
  const { sequence } = await new rpc.Server(SOROBAN_RPC_URLS.public, { timeout: 10 }).getLatestLedger();
  if (!Number.isSafeInteger(sequence) || sequence <= 0) throw new Error("Could not establish payment recovery history");
  const next: PaymentSubmission = { hash: tx.hash().toString("hex"), xdr: tx.toXDR(), startLedger: sequence, status: "pending" };
  if (isSupabaseOnly()) {
    const { error } = await getSupabase()!.from("tiered_reward_run_leases").insert({
      resource_id: idFor(userId), lease_token: JSON.stringify(next), expires_at: Number.MAX_SAFE_INTEGER,
    });
    if (error && error.code !== "23505") throw new Error("Could not protect payment before submission");
    if (!error) return next;
  } else {
    const { changes } = getDb().prepare("INSERT OR IGNORE INTO tiered_reward_run_leases (resource_id, lease_token, expires_at) VALUES (?, ?, ?)")
      .run(idFor(userId), JSON.stringify(next), Number.MAX_SAFE_INTEGER);
    if (changes) return next;
  }
  const concurrent = await readPaymentSubmission(userId);
  if (!concurrent) throw new Error("Payment recovery changed; check its status again");
  return concurrent;
}

export async function finishPaymentSubmission(userId: string | null, previous: PaymentSubmission, status: "success" | "failed", response: NonNullable<PaymentSubmission["response"]>) {
  const next: PaymentSubmission = { ...previous, status, response };
  const raw = JSON.stringify(previous);
  if (isSupabaseOnly()) {
    const { data, error } = await getSupabase()!.from("tiered_reward_run_leases")
      .update({ lease_token: JSON.stringify(next) }).eq("resource_id", idFor(userId)).eq("lease_token", raw).select("resource_id");
    if (error) throw new Error("Could not save payment outcome; check its status before retrying");
    if (data?.length) return next;
  } else {
    const { changes } = getDb().prepare("UPDATE tiered_reward_run_leases SET lease_token = ? WHERE resource_id = ? AND lease_token = ?")
      .run(JSON.stringify(next), idFor(userId), raw);
    if (changes) return next;
  }
  const current = await readPaymentSubmission(userId);
  if (current?.hash === previous.hash && current.status !== "pending") return current;
  throw new Error("Payment recovery changed; check its status before retrying");
}

/** A missing hash needs proof of expiry AND continuous retained history; absence alone is ambiguous. */
export async function reconcilePaymentSubmission(userId: string | null) {
  const current = await readPaymentSubmission(userId);
  if (!current || current.status !== "pending") return current;
  const tx = TransactionBuilder.fromXDR(current.xdr, Networks.PUBLIC);
  const inner = tx instanceof FeeBumpTransaction ? tx.innerTransaction : tx;
  const hashes = [...new Set([current.hash, inner.hash().toString("hex")])];
  const horizon = new Horizon.Server("https://horizon.stellar.org");
  const client = new rpc.Server(SOROBAN_RPC_URLS.public, { timeout: 10 });
  let definitelyExpired = true;
  for (const hash of hashes) {
    try {
      const result = await horizon.transactions().transaction(hash).call();
      if (typeof result.successful === "boolean") return finishPaymentSubmission(userId, current, result.successful ? "success" : "failed", {
        status: result.successful ? 200 : 400,
        body: { hash, successful: result.successful, ...(result.successful ? {} : { error: "Transaction failed on the ledger" }) },
      });
    } catch { /* RPC can still prove an outcome or a safely expired submission. */ }
    try {
      const result = await client.getTransaction(hash);
      if (result.status === rpc.Api.GetTransactionStatus.SUCCESS || result.status === rpc.Api.GetTransactionStatus.FAILED) {
        const success = result.status === rpc.Api.GetTransactionStatus.SUCCESS;
        return finishPaymentSubmission(userId, current, success ? "success" : "failed", {
          status: success ? 200 : 400, body: { hash, successful: success, ...(success ? {} : { error: "Transaction failed on the ledger" }) },
        });
      }
      const maxTime = Number(inner.timeBounds?.maxTime);
      const minTime = Number(inner.timeBounds?.minTime);
      // Imported fee-bump envelopes may have been broadcast before our checkpoint.
      const covered = tx instanceof FeeBumpTransaction
        ? minTime > 0 && Number(result.oldestLedgerCloseTime) < minTime
        : Number.isSafeInteger(current.startLedger) && current.startLedger! >= result.oldestLedger && result.oldestLedger > 0;
      definitelyExpired &&= result.status === rpc.Api.GetTransactionStatus.NOT_FOUND && covered && maxTime > 0 &&
        Number(result.latestLedgerCloseTime) > maxTime && result.latestLedger >= (current.startLedger ?? Infinity);
    } catch { definitelyExpired = false; }
  }
  if (!definitelyExpired) return current;
  return finishPaymentSubmission(userId, current, "failed", { status: 400,
    body: { hash: current.hash, successful: false, error: "Transaction expired without being included in the ledger. It is safe to review and start a new payment." },
  });
}

export async function acknowledgePaymentSubmission(userId: string | null, hash: string) {
  const current = await readPaymentSubmission(userId);
  if (!current) return;
  if (current.hash !== hash || current.status === "pending") throw new Error("Confirm the previous payment outcome before starting another payment");
  if (isSupabaseOnly()) {
    const { error } = await getSupabase()!.from("tiered_reward_run_leases").delete()
      .eq("resource_id", idFor(userId)).eq("lease_token", JSON.stringify(current));
    if (error) throw new Error("Could not acknowledge payment outcome");
  } else {
    getDb().prepare("DELETE FROM tiered_reward_run_leases WHERE resource_id = ? AND lease_token = ?")
      .run(idFor(userId), JSON.stringify(current));
  }
}
