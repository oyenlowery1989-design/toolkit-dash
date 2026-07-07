import { Keypair, TransactionBuilder, Operation, Asset, Horizon, Memo } from "stellar-sdk";
import type { TieredRewardConfig, TierAssignment, RunLogRow } from "./types";
import { getDb } from "@/lib/db";
import { withAccountLock, isBadSeq } from "@/lib/stellar-submit";
import { getSupabase, isSupabaseOnly } from "@/lib/supabase-server";

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
  testnet: "https://horizon-testnet.stellar.org",
  futurenet: "https://horizon-futurenet.stellar.org",
};

const NETWORK_PASSPHRASES: Record<string, string> = {
  public: "Public Global Stellar Network ; September 2015",
  testnet: "Test SDF Network ; September 2015",
  futurenet: "Test SDF Future Network ; October 2022",
};

const BATCH_SIZE = 100;
export const FEE_BUDGET = 1.0; // must match calculator.ts

function extractError(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    const resp = e.response as Record<string, unknown> | undefined;
    const data = resp?.data as Record<string, unknown> | undefined;
    const extras = data?.extras as Record<string, unknown> | undefined;
    if (extras) {
      const rc = extras.result_codes as Record<string, unknown> | undefined;
      if (rc) {
        const tx = rc.transaction as string | undefined;
        const ops = rc.operations as string[] | undefined;
        const parts: string[] = [];
        if (tx) parts.push(tx);
        if (ops?.length) parts.push(`ops: ${ops.join(", ")}`);
        if (parts.length) return parts.join(" | ");
      }
    }
  }
  return err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200);
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
  memo: string | null = null
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
async function insertLogRows(rows: Omit<RunLogRow, "id">[], userId?: string): Promise<void> {
  if (rows.length === 0) return;

  if (isSupabaseOnly()) {
    const sb = getSupabase();
    if (!sb) return;
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
      if (error) console.error("[tiered-rewards] run-log Supabase insert failed:", error);
    } catch (err) {
      console.error("[tiered-rewards] run-log Supabase insert threw:", err);
    }
    return;
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
  } catch { /* non-fatal */ }
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
  userId?: string
): Promise<void> {
  const { tier, holders } = assignment;
  const eligible = holders.filter((h) => !excludeSet.has(h.address));
  if (eligible.length === 0) return;

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
        await insertLogRows([{ configId, tierNumber: tier.tierNumber, holderAddress: op.holder, assetCode: op.assetCode, assetIssuer: op.assetIssuer, amountSent: 0, status: "aborted" as const, error: "Aborted — earlier payment failed", ranAt }], userId);
        continue;
      }
      const result = await sendSingleOp(server, keypair, networkPassphrase, op, baseFee, memo);
      if (result.skipped) {
        await insertLogRows([{ configId, tierNumber: tier.tierNumber, holderAddress: op.holder, assetCode: op.assetCode, assetIssuer: op.assetIssuer, amountSent: 0, status: "skipped" as const, error: "No trustline for reward asset", ranAt }], userId);
      } else if (result.error) {
        aborted = true;
        await insertLogRows([{ configId, tierNumber: tier.tierNumber, holderAddress: op.holder, assetCode: op.assetCode, assetIssuer: op.assetIssuer, amountSent: 0, status: "failed" as const, error: result.error, ranAt }], userId);
      } else {
        await insertLogRows([{ configId, tierNumber: tier.tierNumber, holderAddress: op.holder, assetCode: op.assetCode, assetIssuer: op.assetIssuer, amountSent: op.amount, status: "sent" as const, txHash: result.txHash, ranAt }], userId);
      }
    }
    return;
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
      tx.sign(keypair);
      const response = await server.submitTransaction(tx);
      const txHash = (response as { hash?: string }).hash;

      await insertLogRows(
        batch.map((op) => ({
          configId, tierNumber: tier.tierNumber, holderAddress: op.holder,
          assetCode: op.assetCode, assetIssuer: op.assetIssuer,
          amountSent: op.amount, status: "sent" as const, txHash, ranAt,
        })),
        userId
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
          retryTx.sign(keypair);
          const retryResponse = await server.submitTransaction(retryTx);
          const retryTxHash = (retryResponse as { hash?: string }).hash;

          await insertLogRows(
            batch.map((op) => ({
              configId, tierNumber: tier.tierNumber, holderAddress: op.holder,
              assetCode: op.assetCode, assetIssuer: op.assetIssuer,
              amountSent: op.amount, status: "sent" as const, txHash: retryTxHash, ranAt,
            })),
            userId
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
        for (const op of batch) {
          const result = await sendSingleOp(server, keypair, networkPassphrase, op, baseFee, memo);
          if (result.skipped) {
            await insertLogRows([{ configId, tierNumber: tier.tierNumber, holderAddress: op.holder, assetCode: op.assetCode, assetIssuer: op.assetIssuer, amountSent: 0, status: "skipped" as const, error: "No trustline for reward asset", ranAt }], userId);
          } else if (result.error) {
            aborted = true;
            await insertLogRows([{ configId, tierNumber: tier.tierNumber, holderAddress: op.holder, assetCode: op.assetCode, assetIssuer: op.assetIssuer, amountSent: 0, status: "failed" as const, error: result.error, ranAt }], userId);
            break;
          } else {
            await insertLogRows([{ configId, tierNumber: tier.tierNumber, holderAddress: op.holder, assetCode: op.assetCode, assetIssuer: op.assetIssuer, amountSent: op.amount, status: "sent" as const, txHash: result.txHash, ranAt }], userId);
          }
        }
      } else {
        aborted = true;
        const message = extractError(err);
        await insertLogRows(
          batch.map((op) => ({
            configId, tierNumber: tier.tierNumber, holderAddress: op.holder,
            assetCode: op.assetCode, assetIssuer: op.assetIssuer,
            amountSent: 0, status: "failed" as const, error: message, ranAt,
          })),
          userId
        );
      }
    }

    batchStart += BATCH_SIZE;
  }

  if (aborted && batchStart < ops.length) {
    const remaining = ops.slice(batchStart);
    await insertLogRows(
      remaining.map((op) => ({
        configId, tierNumber: tier.tierNumber, holderAddress: op.holder,
        assetCode: op.assetCode, assetIssuer: op.assetIssuer,
        amountSent: 0, status: "aborted" as const, error: "Aborted — earlier batch failed", ranAt,
      })),
      userId
    );
  }
}

export interface RunResult {
  configId?: string;
  senderAddress: string;
  ranAt: number;
  tiersProcessed: number;
  totalSent: number;
  totalFailed: number;
}

/**
 * Wrapped in a per-account mutex so concurrent runs (manual + scheduler) can't race on the
 * same sender account's sequence number — but that mutex only serializes *submission order*
 * for the key, it does not stop a whole redundant second run from starting for this configId
 * (e.g. a scheduler tick racing a concurrent manual run), which would double-pay every holder.
 * The `_runningConfigs` guard below (globalized in module scope, shared with scheduler.ts)
 * closes that gap: it covers same-process races (scheduler-vs-manual, HMR reloads handing a
 * new closure a stale guard) but is NOT a cross-process/serverless distributed lock — true
 * multi-instance safety would need a DB-backed lock (schema migration), out of scope here.
 */
export async function runConfig(
  config: TieredRewardConfig,
  assignments: TierAssignment[],
  userId?: string
): Promise<RunResult | { error: string }> {
  if (_runningConfigs.has(config.id)) {
    return { error: "This config is already running — try again shortly." };
  }
  _runningConfigs.add(config.id);
  try {
    if (!config.secretKey) return await runConfigInner(config, assignments, userId);
    let keypair: Keypair;
    try {
      keypair = Keypair.fromSecret(config.secretKey);
    } catch {
      // Invalid secret key — let runConfigInner produce the same error result; no account to lock.
      return await runConfigInner(config, assignments, userId);
    }
    return await withAccountLock(keypair.publicKey(), () => runConfigInner(config, assignments, userId));
  } finally {
    _runningConfigs.delete(config.id);
  }
}

async function runConfigInner(
  config: TieredRewardConfig,
  assignments: TierAssignment[],
  userId?: string
): Promise<RunResult | { error: string }> {
  const horizonUrl = HORIZON_URLS[config.network] ?? HORIZON_URLS.public;
  const networkPassphrase = NETWORK_PASSPHRASES[config.network] ?? NETWORK_PASSPHRASES.public;
  const server = new Server(horizonUrl);
  const ranAt = Date.now();

  if (!config.secretKey) return { error: "Sender secret key required to run" };
  let keypair: Keypair;
  try {
    keypair = Keypair.fromSecret(config.secretKey);
  } catch {
    return { error: "Invalid secret key" };
  }

  const excludeSet = new Set(config.excludeAddresses ?? []);
  for (const assignment of assignments) {
    await runTier(server, keypair, networkPassphrase, assignment, config.id, ranAt, config.batchSend ?? true, config.memo ?? null, config.feeMultiplier ?? 1.0, excludeSet, userId);
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

  // Tally results — same Supabase-vs-SQLite split as above. Without it, on Vercel+Supabase
  // this always reads an empty SQLite result set, so totalSent/totalFailed are always 0 even
  // though the payments actually went out.
  let statusRows: { status: string }[] = [];
  if (isSupabaseOnly()) {
    const sb = getSupabase();
    if (sb) {
      try {
        const { data, error } = await sb
          .from("tiered_reward_run_log")
          .select("status")
          .eq("config_id", config.id)
          .eq("ran_at", ranAt);
        if (error) console.error("[tiered-rewards] tally Supabase query failed:", error);
        else statusRows = (data ?? []) as { status: string }[];
      } catch (err) {
        console.error("[tiered-rewards] tally Supabase query threw:", err);
      }
    }
  } else {
    try {
      const db = getDb();
      statusRows = db.prepare("SELECT status FROM tiered_reward_run_log WHERE config_id = ? AND ran_at = ?")
        .all(config.id, ranAt) as { status: string }[];
    } catch { /* leave empty */ }
  }

  return {
    configId: config.id,
    senderAddress: keypair.publicKey(),
    ranAt,
    tiersProcessed: assignments.length,
    totalSent: statusRows.filter((r) => r.status === "sent").length,
    totalFailed: statusRows.filter((r) => r.status === "failed" || r.status === "aborted").length,
  };
}
