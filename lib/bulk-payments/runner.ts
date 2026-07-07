import { Horizon, Keypair, Asset } from "stellar-sdk";
import { resolveNetworkPassphrase, type Network } from "@/lib/settings";
import { getErrorMessage } from "@/lib/stellar-helpers";
import { buildBatchTransaction, BATCH_SIZE } from "./builder";
export { BATCH_SIZE };
import type { BatchResult } from "./types";

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

export interface RunBulkOptions {
  horizonUrl: string;
  network: Network;
  secretKey: string;
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
   * When true, treats operation-level failures (e.g. op_no_trust) as "recorded on-chain".
   * The tx hash is pre-computed before submission so it's always captured even on failure.
   */
  ghost?: boolean;
  signal: AbortSignal;
  onBatchUpdate: (result: BatchResult) => void;
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
  recipients,
  memo,
  batchSize = BATCH_SIZE,
  feeMultiplier = 1,
  amount,
  asset,
  ghost,
  signal,
  onBatchUpdate,
}: RunBulkOptions): Promise<void> {
  const server = new Horizon.Server(horizonUrl);
  const networkPassphrase = resolveNetworkPassphrase(network);
  const batches = chunkArray(recipients, batchSize);

  // Keypair derivation and the initial account load can both throw (bad
  // secret key, unfunded/nonexistent sender, unreachable Horizon). If either
  // fails here, none of the batches ever get a chance to run — report every
  // batch as failed via the normal onBatchUpdate channel so the caller's
  // success/failure counting, history logging, and Retry Failed affordance
  // all work exactly as they would for a per-batch failure.
  let keypair: Keypair;
  let account: Horizon.AccountResponse;
  try {
    keypair = Keypair.fromSecret(secretKey);
    account = await server.loadAccount(keypair.publicKey());
  } catch (err) {
    const { error } = extractHorizonResult(err);
    for (let i = 0; i < batches.length; i++) {
      if (signal.aborted) break;
      onBatchUpdate({ batchIndex: i, count: batches[i].length, status: "failed", error });
    }
    return;
  }

  for (let i = 0; i < batches.length; i++) {
    if (signal.aborted) break;

    const batch = batches[i];

    onBatchUpdate({ batchIndex: i, count: batch.length, status: "sending" });

    let precomputedHash: string | undefined;
    try {
      const tx = buildBatchTransaction(
        account,
        batch,
        memo,
        keypair,
        networkPassphrase,
        feeMultiplier,
        amount,
        asset,
      );

      // Pre-compute hash before submission — Horizon's error response for op-level
      // failures does not always include the hash, so we capture it here.
      precomputedHash = Buffer.from(tx.hash()).toString("hex");

      if (signal.aborted) break;

      const response = await server.submitTransaction(tx);

      onBatchUpdate({
        batchIndex: i,
        count: batch.length,
        status: "success",
        txHash: response.hash,
      });
    } catch (err) {
      if (signal.aborted) break;

      const { error } = extractHorizonResult(err);

      // Ghost mode: op-level failures (op_no_trust, etc.) ARE on-chain — use
      // the pre-computed hash to mark the batch as recorded.
      if (ghost && precomputedHash) {
        onBatchUpdate({
          batchIndex: i,
          count: batch.length,
          status: "success",
          txHash: precomputedHash,
        });
      } else {
        onBatchUpdate({
          batchIndex: i,
          count: batch.length,
          status: "failed",
          error,
        });
      }

      // Reload account so sequence number is correct for next batch
      try {
        account = await server.loadAccount(keypair.publicKey());
      } catch {
        break;
      }
    }
  }
}
