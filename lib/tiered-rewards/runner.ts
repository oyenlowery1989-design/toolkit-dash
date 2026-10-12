import { Keypair, TransactionBuilder, Operation, Asset, Horizon, Memo } from "stellar-sdk";
import type { TieredRewardConfig, TierAssignment, RunLogRow } from "./types";
import { getDb } from "@/lib/db";
import { withAccountLock, isBadSeq } from "@/lib/stellar-submit";
import { getSupabase, isSupabaseOnly } from "@/lib/supabase-server";
import { getErrorMessage } from "@/lib/stellar-helpers";
import { acquireRunLease, releaseRunLease } from "@/lib/run-lease";
import { validateMainnetRun } from "@/lib/mainnet-safety";
import { reserveMainnetSignature } from "@/lib/mainnet-signing-budget";
import { resolveRewardSigningConfig } from "./signing";

const { Server } = Horizon;

declare global {
  var _tieredRewardsRunningConfigs: Set<string> | undefined;
}

/**
 * Globalized (like scheduler.ts's `_tieredRewardsTasks`/`_tieredRewardsStarted`) so an HMR
 * module reload can't hand a fresh, empty overlap-guard to new closures while a previous
 * execution for the same config is still in flight. This module (runConfig, below) is the
 * sole place that adds/removes entries — scheduler.ts only reads this same Set for an early
 * "still running" skip + log — so a manual run (API route) and a scheduler tick for the same
 * configId can never execute concurrently, each fully double-paying every holder.
 */
if (!global._tieredRewardsRunningConfigs) global._tieredRewardsRunningConfigs = new Set<string>();
const _runningConfigs = global._tieredRewardsRunningConfigs;

const HORIZON_URLS: Record<string, string> = {
  public: "https://horizon.stellar.org",
};

const NETWORK_PASSPHRASES: Record<string, string> = {
  public: "Public Global Stellar Network ; September 2015",
};

const BATCH_SIZE = 100;

function extractError(err: unknown): string {
  const msg = getErrorMessage(err);
  return (msg === "An unexpected error occurred." ? String(err) : msg).slice(0, 200);
}

function getOpResultCodes(err: unknown): string[] | null {
  try {
    const e = err as Record<string, unknown>;
    const ops = (e.response as any)?.data?.extras?.result_codes?.operations as string[] | undefined;
    return ops ?? null;
  } catch { return null; }
}

async function sendSingleOp(
  server: InstanceType<typeof Server>,
  keypair: Keypair,
  networkPassphrase: string,
  op: SendOp,
  fee = "100",
  memo: string | null = null,
  userId?: string,
): Promise<{ txHash?: string; error?: string; skipped?: boolean }> {
  try {
    const account = await server.loadAccount(keypair.publicKey());
    let builder = new TransactionBuilder(account, { fee, networkPassphrase });
    if (memo) builder = builder.addMemo(Memo.text(memo.slice(0, 28)));
    builder.addOperation(
      Operation.payment({
        destination: op.holder,
        asset: buildStellarAsset(op.assetCode, op.assetIssuer),
        amount: op.amount.toFixed(7),
      })
    );
    const tx = builder.setTimeout(30).build();
    const budgetErrors = await reserveMainnetSignature(userId ?? null, tx.hash().toString("hex"), Number(tx.timeBounds?.maxTime), {
      destinations: [op.holder], operationCount: 1,
      xlmAmount: (op.assetCode.toUpperCase() === "XLM" ? op.amount : 0) + Number(tx.fee) / 1e7,
    });
    if (budgetErrors.length) throw new Error(budgetErrors.join("; "));
    tx.sign(keypair);
    const response = await server.submitTransaction(tx);
    return { txHash: (response as { hash?: string }).hash };
  } catch (err) {
    const codes = getOpResultCodes(err);
    if (codes?.[0] === "op_no_trust") return { skipped: true };
    return { error: extractError(err) };
  }
}

/**
 * Persists run-log rows. On Vercel+Supabase (isSupabaseOnly()), getDb() has no writable
 * SQLite to fall back on — writing there would silently no-op (caught below) and the run
 * would always report totalSent:0/totalFailed:0, risking an operator re-running (and
 * double-paying) a run they mistakenly believe failed. `userId` attributes the rows for
 * the Supabase `tiered_reward_run_log.user_id` column (NOT NULL DEFAULT '').
 */
export async function insertLogRows(rows: Omit<RunLogRow, "id">[], userId?: string): Promise<boolean> {
  if (rows.length === 0) return true;

  if (isSupabaseOnly()) {
    const sb = getSupabase();
    if (!sb) return false;
    try {
      const supaRows = rows.map((r) => ({
        id: crypto.randomUUID(),
        user_id: userId ?? "",
        config_id: r.configId ?? null,
        tier_number: r.tierNumber,
        holder_address: r.holderAddress,
        asset_code: r.assetCode,
        asset_issuer: r.assetIssuer ?? null,
        amount_sent: r.amountSent,
        status: r.status,
        tx_hash: r.txHash ?? null,
        error: r.error ?? null,
        ran_at: r.ranAt,
      }));
      const { error } = await sb.from("tiered_reward_run_log").insert(supaRows);
      if (error) {
        console.error("[tiered-rewards] run-log Supabase insert failed:", error);
        return false;
      }
      return true;
    } catch (err) {
      console.error("[tiered-rewards] run-log Supabase insert threw:", err);
      return false;
    }
  }

  try {
    const db = getDb();
    const stmt = db.prepare(
      `INSERT INTO tiered_reward_run_log
       (id, config_id, tier_number, holder_address, asset_code, asset_issuer, amount_sent, status, tx_hash, error, ran_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertMany = db.transaction((rs: typeof rows) => {
      for (const r of rs) {
        stmt.run(
          crypto.randomUUID(), r.configId ?? null, r.tierNumber,
          r.holderAddress, r.assetCode, r.assetIssuer ?? null,
          r.amountSent, r.status, r.txHash ?? null, r.error ?? null, r.ranAt
        );
      }
    });
    insertMany(rows);
    return true;
  } catch (err) {
    console.error("[tiered-rewards] run-log SQLite insert failed:", err);
    return false;
  }
}

function buildStellarAsset(assetCode: string, assetIssuer?: string): Asset {
  return assetCode.toUpperCase() === "XLM" ? Asset.native() : new Asset(assetCode, assetIssuer!);
}

type SendOp = { holder: string; assetCode: string; assetIssuer?: string; amount: number };

async function runTier(
  server: InstanceType<typeof Server>,
  keypair: Keypair,
  networkPassphrase: string,
  assignment: TierAssignment,
  configId: string | undefined,
  ranAt: number,
  batchSend: boolean,
  memo: string | null,
  feeMultiplier: number,
  excludeSet: Set<string>,
  statusRows: { status: string }[],
  userId?: string
): Promise<{ failed: boolean; logWriteFailed: boolean }> {
  const { tier, holders } = assignment;
  const eligible = holders.filter((h) => !excludeSet.has(h.address));
  if (eligible.length === 0) return { failed: false, logWriteFailed: false };

  let logWriteFailed = false;
  async function record(rows: Omit<RunLogRow, "id">[]): Promise<void> {
    statusRows.push(...rows.map((row) => ({ status: row.status })));
    if (!(await insertLogRows(rows, userId))) logWriteFailed = true;
  }

  const senderAddress = keypair.publicKey();
  const baseFee = String(Math.round(100 * Math.max(1, feeMultiplier)));

  const ops: SendOp[] = [];
  for (const holder of eligible) {
    for (const asset of tier.assets) {
      ops.push({ holder: holder.address, assetCode: asset.assetCode, assetIssuer: asset.assetIssuer, amount: asset.amount });
    }
  }

  function applyMemo(builder: TransactionBuilder): TransactionBuilder {
    if (!memo) return builder;
    const trimmed = memo.slice(0, 28);
    return builder.addMemo(Memo.text(trimmed));
  }

  // Separate mode: always send 1 op per tx
  if (!batchSend) {
    // Stop on first real failure (not op_no_trust, which sendSingleOp reports as `skipped`) —
    // same hard-stop as batch mode below. Without this, every remaining recipient would still
    // be attempted after a failure starts, each doomed transaction still charging a real fee
    // and draining the sender's XLM further.
    let aborted = false;
    for (const op of ops) {
      if (aborted) {
        await record([{ configId, tierNumber: tier.tierNumber, holderAddress: op.holder, assetCode: op.assetCode, assetIssuer: op.assetIssuer, amountSent: 0, status: "aborted" as const, error: "Aborted — earlier payment failed", ranAt }]);
        continue;
      }
      const result = await sendSingleOp(server, keypair, networkPassphrase, op, baseFee, memo, userId);
      if (result.skipped) {
        await record([{ configId, tierNumber: tier.tierNumber, holderAddress: op.holder, assetCode: op.assetCode, assetIssuer: op.assetIssuer, amountSent: 0, status: "skipped" as const, error: "No trustline for reward asset", ranAt }]);
      } else if (result.error) {
        aborted = true;
        await record([{ configId, tierNumber: tier.tierNumber, holderAddress: op.holder, assetCode: op.assetCode, assetIssuer: op.assetIssuer, amountSent: 0, status: "failed" as const, error: result.error, ranAt }]);
      } else {
        await record([{ configId, tierNumber: tier.tierNumber, holderAddress: op.holder, assetCode: op.assetCode, assetIssuer: op.assetIssuer, amountSent: op.amount, status: "sent" as const, txHash: result.txHash, ranAt }]);
      }
    }
    return { failed: aborted, logWriteFailed };
  }

  // Batch mode: up to BATCH_SIZE ops per tx
  let aborted = false;
  let batchStart = 0;

  while (batchStart < ops.length) {
    if (aborted) break;

    const batch = ops.slice(batchStart, batchStart + BATCH_SIZE);

    try {
      const account = await server.loadAccount(senderAddress);
      const builder = applyMemo(new TransactionBuilder(account, { fee: baseFee, networkPassphrase }));

      for (const op of batch) {
        builder.addOperation(
          Operation.payment({
            destination: op.holder,
            asset: buildStellarAsset(op.assetCode, op.assetIssuer),
            amount: op.amount.toFixed(7),
          })
        );
      }

      const tx = builder.setTimeout(30).build();
      const budgetErrors = await reserveMainnetSignature(userId ?? null, tx.hash().toString("hex"), Number(tx.timeBounds?.maxTime), {
        destinations: batch.map((op) => op.holder), operationCount: batch.length,
        xlmAmount: batch.reduce((sum, op) => sum + (op.assetCode.toUpperCase() === "XLM" ? op.amount : 0), 0) + Number(tx.fee) / 1e7,
      });
      if (budgetErrors.length) throw new Error(budgetErrors.join("; "));
      tx.sign(keypair);
      const response = await server.submitTransaction(tx);
      const txHash = (response as { hash?: string }).hash;

      await record(
        batch.map((op) => ({
          configId, tierNumber: tier.tierNumber, holderAddress: op.holder,
          assetCode: op.assetCode, assetIssuer: op.assetIssuer,
          amountSent: op.amount, status: "sent" as const, txHash, ranAt,
        }))
      );
    } catch (err) {
      // Retry once on tx_bad_seq — reload account, rebuild the same batch, resubmit.
      // Only fall through to the abort/no-trust handling if the retry also fails.
      if (isBadSeq(err)) {
        try {
          const retryAccount = await server.loadAccount(senderAddress);
          const retryBuilder = applyMemo(new TransactionBuilder(retryAccount, { fee: baseFee, networkPassphrase }));
          for (const op of batch) {
            retryBuilder.addOperation(
              Operation.payment({
                destination: op.holder,
                asset: buildStellarAsset(op.assetCode, op.assetIssuer),
                amount: op.amount.toFixed(7),
              })
            );
          }
          const retryTx = retryBuilder.setTimeout(30).build();
          const budgetErrors = await reserveMainnetSignature(userId ?? null, retryTx.hash().toString("hex"), Number(retryTx.timeBounds?.maxTime), {
            destinations: batch.map((op) => op.holder), operationCount: batch.length,
            xlmAmount: batch.reduce((sum, op) => sum + (op.assetCode.toUpperCase() === "XLM" ? op.amount : 0), 0) + Number(retryTx.fee) / 1e7,
          });
          if (budgetErrors.length) throw new Error(budgetErrors.join("; "));
          retryTx.sign(keypair);
          const retryResponse = await server.submitTransaction(retryTx);
          const retryTxHash = (retryResponse as { hash?: string }).hash;

          await record(
            batch.map((op) => ({
              configId, tierNumber: tier.tierNumber, holderAddress: op.holder,
              assetCode: op.assetCode, assetIssuer: op.assetIssuer,
              amountSent: op.amount, status: "sent" as const, txHash: retryTxHash, ranAt,
            }))
          );
          batchStart += BATCH_SIZE;
          continue;
        } catch (retryErr) {
          err = retryErr;
        }
      }

      const opCodes = getOpResultCodes(err);
      const hasNoTrust = opCodes?.some((c) => c === "op_no_trust");

      if (hasNoTrust) {
        // Retry each op individually — skip no_trust recipients, continue the rest
        for (let oi = 0; oi < batch.length; oi++) {
          const op = batch[oi];
          const result = await sendSingleOp(server, keypair, networkPassphrase, op, baseFee, memo, userId);
          if (result.skipped) {
            await record([{ configId, tierNumber: tier.tierNumber, holderAddress: op.holder, assetCode: op.assetCode, assetIssuer: op.assetIssuer, amountSent: 0, status: "skipped" as const, error: "No trustline for reward asset", ranAt }]);
          } else if (result.error) {
            aborted = true;
            await record([{ configId, tierNumber: tier.tierNumber, holderAddress: op.holder, assetCode: op.assetCode, assetIssuer: op.assetIssuer, amountSent: 0, status: "failed" as const, error: result.error, ranAt }]);
            // batchStart is already past this whole batch — log the unfinished tail of THIS
            // batch here, so every holder in it gets some audit row (the outer aborted-batchStart
            // reconciliation below only covers subsequent, not-yet-started batches).
            const tail = batch.slice(oi + 1);
            if (tail.length > 0) {
              await record(
                tail.map((o) => ({
                  configId, tierNumber: tier.tierNumber, holderAddress: o.holder,
                  assetCode: o.assetCode, assetIssuer: o.assetIssuer,
                  amountSent: 0, status: "aborted" as const, error: "Aborted — earlier payment failed", ranAt,
                }))
              );
            }
            break;
          } else {
            await record([{ configId, tierNumber: tier.tierNumber, holderAddress: op.holder, assetCode: op.assetCode, assetIssuer: op.assetIssuer, amountSent: op.amount, status: "sent" as const, txHash: result.txHash, ranAt }]);
          }
        }
      } else {
        aborted = true;
        const message = extractError(err);
        await record(
          batch.map((op) => ({
            configId, tierNumber: tier.tierNumber, holderAddress: op.holder,
            assetCode: op.assetCode, assetIssuer: op.assetIssuer,
            amountSent: 0, status: "failed" as const, error: message, ranAt,
          }))
        );
      }
    }

    batchStart += BATCH_SIZE;
  }

  if (aborted && batchStart < ops.length) {
    const remaining = ops.slice(batchStart);
    await record(
      remaining.map((op) => ({
        configId, tierNumber: tier.tierNumber, holderAddress: op.holder,
        assetCode: op.assetCode, assetIssuer: op.assetIssuer,
        amountSent: 0, status: "aborted" as const, error: "Aborted — earlier batch failed", ranAt,
      }))
    );
  }
  return { failed: aborted, logWriteFailed };
}

export interface RunResult {
  configId?: string;
  senderAddress: string;
  ranAt: number;
  tiersProcessed: number;
  totalSent: number;
  totalFailed: number;
  logWriteFailed?: boolean;
}

/**
 * Wrapped in a per-account mutex so concurrent runs (manual + scheduler) can't race on the
 * same sender account's sequence number — but that mutex only serializes *submission order*
 * for the key, it does not stop a whole redundant second run from starting for this configId
 * (e.g. a scheduler tick racing a concurrent manual run), which would double-pay every holder.
 * The `_runningConfigs` guard below (globalized in module scope, shared with scheduler.ts)
 * closes that local gap. The durable run lease acquired below extends the guard across
 * processes and serverless instances.
 */
export async function runConfig(
  config: TieredRewardConfig,
  assignments: TierAssignment[],
  userId?: string,
  expectedSenderAddress?: string
): Promise<RunResult | { error: string }> {
  if (_runningConfigs.has(config.id)) {
    return { error: "This config is already running — try again shortly." };
  }
  _runningConfigs.add(config.id);
  let leaseToken: string | null = null;
  try {
    leaseToken = await acquireRunLease("tiered_reward_run_leases", config.id);
    if (!leaseToken) return { error: "This config is already running — try again shortly." };
    try { config = await resolveRewardSigningConfig(config, userId); }
    catch (error) { return { error: error instanceof Error ? error.message : "Could not load sender wallet" }; }
    if (!config.secretKey) return await runConfigInner(config, assignments, userId);
    let keypair: Keypair;
    try {
      keypair = Keypair.fromSecret(config.secretKey);
    } catch {
      // Invalid secret key — let runConfigInner produce the same error result; no account to lock.
      return await runConfigInner(config, assignments, userId);
    }
    if (expectedSenderAddress && keypair.publicKey() !== expectedSenderAddress) return { error: "Sender wallet changed since preview; preview again" };
    return await withAccountLock(keypair.publicKey(), () => runConfigInner(config, assignments, userId));
  } finally {
    if (leaseToken) await releaseRunLease("tiered_reward_run_leases", config.id, leaseToken);
    _runningConfigs.delete(config.id);
  }
}

async function runConfigInner(
  config: TieredRewardConfig,
  assignments: TierAssignment[],
  userId?: string
): Promise<RunResult | { error: string }> {
  const ranAt = Date.now();

  const horizonUrl = HORIZON_URLS[config.network];
  const networkPassphrase = NETWORK_PASSPHRASES[config.network];
  if (!horizonUrl || !networkPassphrase) return { error: `Unsupported payment network: ${config.network}` };
  const server = new Server(horizonUrl);

  if (!config.secretKey) return { error: "Sender secret key required to run" };
  let keypair: Keypair;
  try {
    keypair = Keypair.fromSecret(config.secretKey);
  } catch {
    return { error: "Invalid secret key" };
  }

  const excludeSet = new Set(config.excludeAddresses ?? []);
  const intendedOps = assignments.flatMap((assignment) =>
    assignment.holders
      .filter((holder) => !excludeSet.has(holder.address))
      .flatMap((holder) => assignment.tier.assets.map((asset) => ({ holder: holder.address, asset }))),
  );
  const safetyErrors = validateMainnetRun({
    destinations: intendedOps.map((op) => op.holder),
    operationCount: intendedOps.length,
    xlmAmount: intendedOps.reduce(
      (sum, op) => sum + (op.asset.assetCode.toUpperCase() === "XLM" ? op.asset.amount : 0),
      0,
    ),
  });
  if (safetyErrors.length > 0) return { error: safetyErrors.join("; ") };
  const statusRows: { status: string }[] = [];
  let tiersProcessed = 0;
  let logWriteFailed = false;
  for (const assignment of assignments) {
    const tierResult = await runTier(server, keypair, networkPassphrase, assignment, config.id, ranAt, config.batchSend ?? true, config.memo ?? null, config.feeMultiplier ?? 1.0, excludeSet, statusRows, userId);
    tiersProcessed += 1;
    logWriteFailed ||= tierResult.logWriteFailed;
    if (tierResult.failed) break;
  }

  // Update last_run_at — leave last_failure_at for the caller to clear on full success.
  // Must be Supabase-aware: this is the only last_run_at write on the scheduler path (the
  // manual route separately does its own supabase-aware write after runConfig returns), so
  // on Vercel+Supabase this unconditional getDb() call would silently no-op and the scheduler
  // would keep re-running (and re-paying) a config it thinks never ran.
  if (isSupabaseOnly()) {
    const sb = getSupabase();
    if (sb) {
      try {
        const query = sb.from("tiered_reward_configs").update({ last_run_at: ranAt }).eq("id", config.id);
        const { error } = await (userId ? query.eq("user_id", userId) : query);
        if (error) console.error("[tiered-rewards] last_run_at Supabase update failed:", error);
      } catch (err) {
        console.error("[tiered-rewards] last_run_at Supabase update threw:", err);
      }
    }
  } else {
    try {
      const db = getDb();
      db.prepare("UPDATE tiered_reward_configs SET last_run_at = ? WHERE id = ?")
        .run(ranAt, config.id);
    } catch { /* non-fatal */ }
  }

  return {
    configId: config.id,
    senderAddress: keypair.publicKey(),
    ranAt,
    tiersProcessed,
    totalSent: statusRows.filter((r) => r.status === "sent").length,
    totalFailed: statusRows.filter((r) => r.status === "failed" || r.status === "aborted").length,
    ...(logWriteFailed ? { logWriteFailed: true } : {}),
  };
}
