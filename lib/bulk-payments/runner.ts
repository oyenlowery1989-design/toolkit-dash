import { Horizon, Keypair, Asset } from "stellar-sdk";
import { resolveNetworkPassphrase, type Network } from "@/lib/settings";
import { getErrorMessage } from "@/lib/stellar-helpers";
import { buildBatchTransaction, BATCH_SIZE } from "./builder";
export { BATCH_SIZE };
import type { BatchResult } from "./types";
import { signPaymentTransaction } from "@/lib/payments-signing";
import { submitMainnetTransaction } from "@/lib/mainnet-submit-client";

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function extractHorizonResult(err: unknown): { error: string; txHash?: string } {
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    const response = e["response"] as Record<string, unknown> | undefined;
    const txHash = (response?.["hash"] as string | undefined) ??
                   (e["hash"] as string | undefined);
    const extras = response?.["extras"] as Record<string, unknown> | undefined;
    const codes = extras?.["result_codes"] as Record<string, unknown> | undefined;
    let errorMsg = getErrorMessage(err);
    if (codes) {
      const tx = codes["transaction"];
      const ops = codes["operations"];
      const parts: string[] = [];
      if (tx) parts.push(`tx: ${tx}`);
      if (Array.isArray(ops)) parts.push(`ops: ${ops.join(", ")}`);
      if (parts.length) errorMsg = parts.join(" | ");
    }
    return { error: errorMsg, txHash };
  }
  return { error: getErrorMessage(err) };
}

/** Read-only reconciliation: an absent hash is not proof that submission failed. */
export async function reconcileBulkBatch(horizonUrl: string, result: BatchResult, ghost = false): Promise<BatchResult> {
  if (!result.txHash) return result;
  try {
    const tx = await new Horizon.Server(horizonUrl).transactions().transaction(result.txHash).call();
    if (typeof tx.successful !== "boolean") return result;
    return { ...result, status: ghost || tx.successful ? "success" : "failed", error: tx.successful || ghost ? undefined : "Transaction failed on the ledger" };
  } catch {
    return result;
  }
}

function definitelyRejected(err: unknown): boolean {
  const response = (err as { response?: { status?: number; data?: { error?: unknown; extras?: unknown } } })?.response;
  // The submit route emits this shape for auth/policy rejection before Horizon.
  // A Horizon 400 (including tx_bad_seq) may be a delayed duplicate response.
  return (response?.status === 401 || response?.status === 403) &&
    typeof response.data?.error === "string" && response.data.extras === undefined;
}

export interface RunBulkOptions {
  horizonUrl: string;
  network: Network;
  secretKey: string;
  walletId?: string;
  walletAddress?: string;
  recipients: string[];
  memo: string;
  /** Number of payment operations per transaction (1–100). Defaults to 100. */
  batchSize?: number;
  /** Fee multiplier applied to the base fee (100 stroops). Defaults to 1. */
  feeMultiplier?: number;
  /** Amount to send per recipient. Defaults to 0.0000001 (1 stroop). */
  amount?: string;
  /** Asset to send. Defaults to native XLM. */
  asset?: Asset;
  /**
   * When true, ledger-confirmed failed transactions count as recorded on-chain.
   * Native payments are disabled because a balance snapshot cannot guarantee failure.
   */
  ghost?: boolean;
  signal: AbortSignal;
  onBatchUpdate: (result: BatchResult) => void;
  /** Durable hash checkpoint. Failure stops this batch before broadcast. */
  onBeforeSubmit?: (result: BatchResult) => Promise<void>;
}

/**
 * Submit all recipient batches sequentially.
 *
 * On success the account object is reused (sequence auto-increments).
 * On failure the account is reloaded from the network so sequence stays
 * correct for subsequent batches (we don't stop on a single batch failure).
 */
export async function runBulkPayments({
  horizonUrl,
  network,
  secretKey,
  walletId,
  walletAddress,
  recipients,
  memo,
  batchSize = BATCH_SIZE,
  feeMultiplier = 1,
  amount,
  asset,
  ghost,
  signal,
  onBatchUpdate,
  onBeforeSubmit,
}: RunBulkOptions): Promise<void> {
  const server = new Horizon.Server(horizonUrl);
  const networkPassphrase = resolveNetworkPassphrase(network);
  const batches = chunkArray(recipients, batchSize);
  // A balance snapshot cannot guarantee a native payment will fail at ledger close.
  if (ghost && (!asset || asset.isNative())) {
    batches.forEach((batch, batchIndex) => onBatchUpdate({ batchIndex, count: batch.length, status: "failed", error: "Native underfunded ghost payments are disabled: the balance can increase before execution." }));
    return;
  }

  // Keypair derivation and the initial account load can both throw (bad
  // secret key, unfunded/nonexistent sender, unreachable Horizon). If either
  // fails here, none of the batches ever get a chance to run — report every
  // batch as failed via the normal onBatchUpdate channel so the caller's
  // success/failure counting, history logging, and Retry Failed affordance
  // all work exactly as they would for a per-batch failure.
  let keypair: Keypair | null = null;
  let publicKey: string;
  let account: Horizon.AccountResponse;
  try {
    if (walletId) {
      if (!walletAddress) throw new Error("Connected wallet address is missing");
      publicKey = walletAddress;
    } else {
      keypair = Keypair.fromSecret(secretKey);
      publicKey = keypair.publicKey();
    }
    account = await server.loadAccount(publicKey);
  } catch (err) {
    const { error } = extractHorizonResult(err);
    for (let i = 0; i < batches.length; i++) {
      if (signal.aborted) break;
      onBatchUpdate({ batchIndex: i, count: batches[i].length, status: "failed", error });
    }
    return;
  }

  for (let i = 0; i < batches.length; i++) {
    // Not yet started when abort fired — including every batch after one
    // that was aborted mid-submission below (loop just keeps landing here).
    if (signal.aborted) {
      onBatchUpdate({
        batchIndex: i,
        count: batches[i].length,
        status: "failed",
        error: "Aborted — not submitted",
      });
      continue;
    }

    const batch = batches[i];

    onBatchUpdate({ batchIndex: i, count: batch.length, status: "sending" });

    let precomputedHash: string | undefined;
    let submitting = false;
    let signedXdr: string | undefined;
    try {
      let tx = buildBatchTransaction(
        account,
        batch,
        memo,
        keypair,
        networkPassphrase,
        feeMultiplier,
        amount,
        asset,
      );

      if (walletId) tx = await signPaymentTransaction(tx, walletId, "");

      // Pre-compute hash before submission — Horizon's error response for op-level
      // failures does not always include the hash, so we capture it here.
      precomputedHash = Buffer.from(tx.hash()).toString("hex");
      signedXdr = tx.toXDR();

      if (signal.aborted) {
        onBatchUpdate({ batchIndex: i, count: batch.length, status: "failed", error: "Aborted — not submitted" });
        continue;
      }

      if (onBeforeSubmit) {
        try {
          await onBeforeSubmit({ batchIndex: i, count: batch.length, status: "uncertain", txHash: precomputedHash });
        } catch (err) {
          onBatchUpdate({ batchIndex: i, count: batch.length, status: "failed", error: `Recovery checkpoint failed — not submitted: ${getErrorMessage(err)}` });
          for (let j = i + 1; j < batches.length; j++) {
            onBatchUpdate({ batchIndex: j, count: batches[j].length, status: "failed", error: "Not submitted — recovery checkpoint unavailable" });
          }
          return;
        }
      }
      if (signal.aborted) {
        onBatchUpdate({ batchIndex: i, count: batch.length, status: "failed", error: "Aborted — not submitted" });
        continue;
      }
      onBatchUpdate({ batchIndex: i, count: batch.length, status: "sending", txHash: precomputedHash, signedXdr });
      submitting = true;
      const response = await submitMainnetTransaction(tx);

      onBatchUpdate({
        batchIndex: i,
        count: batch.length,
        status: "success",
        txHash: response.hash ?? precomputedHash,
        signedXdr,
      });
    } catch (err) {
      const { error } = extractHorizonResult(err);
      let result: BatchResult = { batchIndex: i, count: batch.length, status: "failed", error, txHash: precomputedHash, signedXdr };
      if (submitting) {
        result = await reconcileBulkBatch(horizonUrl, { ...result, status: "uncertain", error: `Submission unresolved — check this hash before sending again: ${error}` }, ghost);
        if (result.status === "uncertain" && definitelyRejected(err)) result = { ...result, status: "failed", error };
      }
      onBatchUpdate(result);
      if (result.status === "uncertain") {
        for (let j = i + 1; j < batches.length; j++) {
          onBatchUpdate({ batchIndex: j, count: batches[j].length, status: "failed", error: "Not submitted — earlier transaction is unresolved" });
        }
        return;
      }

      // Reload account so sequence number is correct for next batch
      try {
        account = await server.loadAccount(publicKey);
      } catch {
        break;
      }
    }
  }
}
