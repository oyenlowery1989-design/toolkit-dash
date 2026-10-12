import {
  Keypair,
  TransactionBuilder,
  Operation,
  Asset,
  Memo,
  Horizon,
} from "stellar-sdk";
import type { AutoSendGroup, DestinationRunResult, GroupRunResult, GroupPreview } from "./types";
import { getDb } from "@/lib/db";
import { withAccountLock, isBadSeq } from "@/lib/stellar-submit";
import { getErrorMessage } from "@/lib/stellar-helpers";
import { acquireRunLease, releaseRunLease } from "@/lib/run-lease";
import { validateMainnetRun } from "@/lib/mainnet-safety";
import { reserveMainnetSignature } from "@/lib/mainnet-signing-budget";
import { blockAutoSendRun, claimAutoSendRun, completeAutoSendRun, markAutoSendTransactionRejected, markAutoSendTransactionSent, recordAutoSendTransaction, type AutoSendRunGuard } from "./run-guard";
const { Server } = Horizon;

declare global {
  var _autoSendExecutingGroups: Set<string> | undefined;
}

if (!global._autoSendExecutingGroups) global._autoSendExecutingGroups = new Set<string>();
const executingGroups = global._autoSendExecutingGroups;

export class AutoSendRunInProgressError extends Error {
  readonly code = "AUTO_SEND_RUN_IN_PROGRESS";

  constructor() {
    super("This auto-send group is already running. Try again after the current run finishes.");
    this.name = "AutoSendRunInProgressError";
  }
}

const HORIZON_URLS: Record<string, string> = {
  public: "https://horizon.stellar.org",
};

const NETWORK_PASSPHRASES: Record<string, string> = {
  public: "Public Global Stellar Network ; September 2015",
};

const DEFAULT_MIN_RESERVE = 10.0;
const FEE_BUDGET = 1.0; // flat 1 XLM safety buffer for fees

export function extractError(err: unknown): string {
  const msg = getErrorMessage(err);
  return (msg === "An unexpected error occurred." ? String(err) : msg).slice(0, 200);
}

async function loadNativeBalance(server: InstanceType<typeof Server>, address: string): Promise<number> {
  const account = await server.loadAccount(address);
  return parseFloat(
    account.balances.find(
      (b: { asset_type: string; balance: string }) => b.asset_type === "native"
    )?.balance ?? "0"
  );
}

export function calcAmount(spendable: number, percentage: number): number {
  return Math.floor(spendable * (percentage / 100) * 1e7) / 1e7;
}

export function skipReason(spendable: number, amount: number, minThreshold: number, paused?: boolean): string | undefined {
  if (paused) return "Paused";
  if (amount <= 0) return `Spendable ${spendable.toFixed(7)} XLM — too low`;
  if (minThreshold > 0 && amount < minThreshold) return `Below minimum threshold (${minThreshold} XLM)`;
  return undefined;
}

function logResult(groupId: string, walletAddress: string, result: DestinationRunResult, ranAt: number): void {
  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO auto_send_run_log (id, group_id, wallet_address, destination, amount_sent, status, error, ran_at, tx_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      crypto.randomUUID(), groupId, walletAddress, result.destination,
      result.amountSent ?? null, result.status, result.error ?? null, ranAt, result.txHash ?? null
    );
  } catch { /* non-fatal */ }
}

/** Compute how much each destination receives, handling remainder destinations and max caps. */
export function calcAmounts(spendable: number, destinations: AutoSendGroup["destinations"]): Map<string, number> {
  const amounts = new Map<string, number>();
  const available = Math.max(0, spendable);
  // First pass: fixed-% destinations
  let fixedTotal = 0;
  for (const dest of destinations) {
    const key = dest.id ?? dest.destination;
    if (!dest.isRemainder && !dest.paused) {
      const uncapped = calcAmount(available, Math.max(0, dest.percentage));
      let amt = uncapped;
      if (dest.maxCap > 0) {
        amt = Math.min(amt, dest.maxCap);
      }
      amounts.set(key, amt);
      fixedTotal += amt;
    }
  }
  // Defend against invalid/stale configurations whose fixed percentages exceed
  // 100%. Scale proportionally instead of constructing an underfunded payment.
  if (fixedTotal > available && fixedTotal > 0) {
    const scale = available / fixedTotal;
    fixedTotal = 0;
    for (const dest of destinations) {
      if (dest.isRemainder || dest.paused) continue;
      const key = dest.id ?? dest.destination;
      const scaled = Math.floor(((amounts.get(key) ?? 0) * scale) * 1e7) / 1e7;
      amounts.set(key, scaled);
      fixedTotal += scaled;
    }
  }
  // Second pass: remainder destinations (split remaining equally if multiple)
  // fixedTotal contains the capped amounts, so spendable - fixedTotal already
  // includes any amount released by caps. Adding that surplus again would
  // create money and could build an underfunded transaction.
  const remainderDests = destinations.filter((d) => d.isRemainder && !d.paused);
  if (remainderDests.length > 0) {
    const leftover = Math.max(0, available - fixedTotal);
    const share = Math.floor((leftover / remainderDests.length) * 1e7) / 1e7;
    for (const dest of remainderDests) {
      let amt = share;
      if (dest.maxCap > 0) amt = Math.min(amt, dest.maxCap);
      amounts.set(dest.id ?? dest.destination, amt);
    }
  }
  return amounts;
}

/** Calculate what would be sent without submitting any transactions. */
export async function previewGroup(group: AutoSendGroup): Promise<GroupPreview | { error: string }> {
  const horizonUrl = HORIZON_URLS[group.network];
  if (!horizonUrl) return { error: `Unsupported payment network: ${group.network}` };
  const server = new Server(horizonUrl);

  let keypair: Keypair;
  try {
    keypair = Keypair.fromSecret(group.secretKey);
  } catch {
    return { error: "Invalid secret key" };
  }

  const walletAddress = keypair.publicKey();

  let xlmBalance: number;
  try {
    xlmBalance = await loadNativeBalance(server, walletAddress);
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const isNotFound = raw.includes("Not Found") || raw.includes("404");
    return {
      error: isNotFound
        ? "Account not found on mainnet — send XLM to activate it"
        : raw.slice(0, 150),
    };
  }

  // Check min sender threshold — skip entire group if balance too low
  if (group.minSenderThreshold > 0 && xlmBalance < group.minSenderThreshold) {
    const reason = `Balance ${xlmBalance.toFixed(2)} XLM below sender threshold (${group.minSenderThreshold} XLM)`;
    const items = group.destinations.map((dest) => ({
      destination: dest.destination,
      label: dest.label,
      memo: dest.memo,
      percentage: dest.percentage,
      isRemainder: dest.isRemainder,
      amountXlm: 0,
      wouldSkip: true,
      skipReason: reason,
    }));
    return { groupId: group.id, walletAddress, xlmBalance, spendable: 0, batchSend: group.batchSend, estimatedFees: 0, items };
  }

  const spendable = xlmBalance - (group.minReserve ?? DEFAULT_MIN_RESERVE) - FEE_BUDGET;
  const amounts = calcAmounts(spendable, group.destinations);

  const items = group.destinations.map((dest) => {
    const amountXlm = amounts.get(dest.id ?? dest.destination) ?? 0;
    const reason = skipReason(spendable, amountXlm, dest.minThreshold, dest.paused);
    return {
      destination: dest.destination,
      label: dest.label,
      memo: dest.memo,
      percentage: dest.percentage,
      isRemainder: dest.isRemainder,
      amountXlm,
      wouldSkip: !!reason,
      skipReason: reason,
    };
  });

  const sendCount = items.filter((i) => !i.wouldSkip).length;
  // 100 stroops per operation; batch mode is 1 tx with N payment ops (fee = baseFee * opCount),
  // separate mode is 1 tx per destination — both cost 100 stroops per destination sent.
  const feeStroops = sendCount * 100;
  const estimatedFees = feeStroops / 1e7;

  return { groupId: group.id, walletAddress, xlmBalance, spendable, batchSend: group.batchSend, estimatedFees, items };
}

/** Execute the group run. Separate mode sends one tx per destination with its own memo.
 *  Batch mode sends all destinations in a single transaction with optional group-level memo.
 *  Wrapped below in a per-account mutex so concurrent runs (manual + scheduler) can't race
 *  on the same account's sequence number. */
export async function runGroup(group: AutoSendGroup): Promise<GroupRunResult> {
  if (executingGroups.has(group.id)) throw new AutoSendRunInProgressError();
  executingGroups.add(group.id);
  let leaseToken: string | null = null;
  try {
    leaseToken = await acquireRunLease("auto_send_run_leases", group.id);
    if (!leaseToken) throw new AutoSendRunInProgressError();
    let keypair: Keypair;
    try {
      keypair = Keypair.fromSecret(group.secretKey);
    } catch {
      // Invalid secret key — let runGroupInner produce the same error result; no account to lock.
      return await runGroupInner(group);
    }
    return await withAccountLock(keypair.publicKey(), () => runGroupInner(group));
  } finally {
    if (leaseToken) await releaseRunLease("auto_send_run_leases", group.id, leaseToken);
    executingGroups.delete(group.id);
  }
}

async function runGroupInner(group: AutoSendGroup): Promise<GroupRunResult> {
  const ranAt = Date.now();
  const results: DestinationRunResult[] = [];

  const horizonUrl = HORIZON_URLS[group.network];
  const networkPassphrase = NETWORK_PASSPHRASES[group.network];
  if (!horizonUrl || !networkPassphrase) {
    return {
      groupId: group.id,
      walletAddress: "unsupported-network",
      ranAt,
      results: group.destinations.map((d) => ({
        destination: d.destination,
        label: d.label,
        status: "failed" as const,
        error: `Unsupported payment network: ${group.network}`,
      })),
    };
  }
  const server = new Server(horizonUrl);

  let keypair: Keypair;
  try {
    keypair = Keypair.fromSecret(group.secretKey);
  } catch {
    return {
      groupId: group.id,
      walletAddress: "invalid-key",
      ranAt,
      results: group.destinations.map((d) => {
        const r: DestinationRunResult = { destination: d.destination, label: d.label, status: "failed", error: "Invalid secret key" };
        logResult(group.id, "invalid-key", r, ranAt);
        return r;
      }),
    };
  }

  const walletAddress = keypair.publicKey();

  if (group.destinations.length === 0) {
    return { groupId: group.id, walletAddress, ranAt, results: [] };
  }

  let xlmBalance: number;
  try {
    xlmBalance = await loadNativeBalance(server, walletAddress);
  } catch (err) {
    const raw = extractError(err);
    const isNotFound = raw.includes("Not Found") || raw.includes("404");
    const message = isNotFound
      ? "Account not found on mainnet — send XLM to activate it"
      : raw;
    return {
      groupId: group.id,
      walletAddress,
      ranAt,
      results: group.destinations.map((d) => ({
        destination: d.destination,
        label: d.label,
        status: "failed" as const,
        error: message,
      })),
    };
  }

  // Check min sender threshold — skip entire group if balance too low
  if (group.minSenderThreshold > 0 && xlmBalance < group.minSenderThreshold) {
    const reason = `Balance ${xlmBalance.toFixed(2)} XLM below sender threshold (${group.minSenderThreshold} XLM)`;
    return {
      groupId: group.id,
      walletAddress,
      ranAt,
      results: group.destinations.map((d) => {
        const r: DestinationRunResult = { destination: d.destination, label: d.label, status: "skipped", error: reason };
        logResult(group.id, walletAddress, r, ranAt);
        return r;
      }),
    };
  }

  // Flat 1 XLM fee budget for all modes
  const spendable = xlmBalance - (group.minReserve ?? DEFAULT_MIN_RESERVE) - FEE_BUDGET;
  let amounts = calcAmounts(spendable, group.destinations);

  // Test mode: override all amounts to 1 stroop
  if (group.testMode) {
    for (const [key] of amounts) {
      amounts.set(key, 0.0000001);
    }
  }

  const intended = group.destinations
    .map((dest) => ({ dest, amount: amounts.get(dest.id ?? dest.destination) ?? 0 }))
    .filter(({ dest, amount }) => !skipReason(spendable, amount, group.testMode ? 0 : dest.minThreshold, dest.paused));
  const safetyErrors = validateMainnetRun({
    destinations: intended.map(({ dest }) => dest.destination),
    operationCount: intended.length,
    xlmAmount: intended.reduce((sum, { amount }) => sum + amount, 0),
  });
  if (safetyErrors.length > 0) {
    const error = safetyErrors.join("; ");
    return {
      groupId: group.id,
      walletAddress,
      ranAt,
      results: group.destinations.map((dest) => {
        const result: DestinationRunResult = { destination: dest.destination, label: dest.label, status: "failed", error };
        logResult(group.id, walletAddress, result, ranAt);
        return result;
      }),
    };
  }

  // Claim a durable guard before building/submitting any payment. An interrupted
  // or uncertain run stays blocked until the operator reconciles its hashes.
  let runGuard: AutoSendRunGuard | null = intended.length > 0
    ? await claimAutoSendRun(group.id, walletAddress)
    : null;

  if (group.batchSend) {
    // ── Batch mode: one transaction, N payment ops ──────────────────────────
    const sendable = group.destinations.map((dest) => {
      const amount = amounts.get(dest.id ?? dest.destination) ?? 0;
      // Test mode sends a dust amount by design — don't let the real minThreshold mark it "skipped".
      const minThreshold = group.testMode ? 0 : dest.minThreshold;
      return { dest, amount, skip: skipReason(spendable, amount, minThreshold, dest.paused) };
    });

    const toSend = sendable.filter((s) => !s.skip);
    const skipped = sendable.filter((s) => s.skip);

    for (const { dest, skip } of skipped) {
      const r: DestinationRunResult = { destination: dest.destination, label: dest.label, status: "skipped", error: skip };
      results.push(r);
      logResult(group.id, walletAddress, r, ranAt);
    }

    if (toSend.length > 0) {
      try {
        const account = await server.loadAccount(walletAddress);
        const builder = new TransactionBuilder(account, { fee: "100", networkPassphrase });
        for (const { dest, amount } of toSend) {
          builder.addOperation(
            Operation.payment({ destination: dest.destination, asset: Asset.native(), amount: amount.toFixed(7) })
          );
        }
        if (group.batchMemo?.trim()) {
          builder.addMemo(Memo.text(group.batchMemo.trim().slice(0, 28)));
        }
        const tx = builder.setTimeout(30).build();
        const budgetErrors = await reserveMainnetSignature(null, tx.hash().toString("hex"), Number(tx.timeBounds?.maxTime), {
          destinations: toSend.map(({ dest }) => dest.destination),
          operationCount: toSend.length,
          xlmAmount: toSend.reduce((sum, item) => sum + item.amount, 0) + Number(tx.fee) / 1e7,
        });
        if (budgetErrors.length) throw new Error(budgetErrors.join("; "));
        tx.sign(keypair);
        const hash = tx.hash().toString("hex");
        runGuard = await recordAutoSendTransaction(group.id, runGuard!, {
          hash, destination: toSend.map(({ dest }) => dest.destination).join(", "),
          amount: toSend.reduce((sum, item) => sum + item.amount, 0), status: "prepared",
        });
        const batchResponse = await server.submitTransaction(tx);
        const txHash = (batchResponse as { hash?: string }).hash ?? hash;
        runGuard = await markAutoSendTransactionSent(group.id, runGuard, hash);

        for (const { dest, amount } of toSend) {
          const r: DestinationRunResult = { destination: dest.destination, label: dest.label, status: "sent", amountSent: amount, txHash };
          results.push(r);
          logResult(group.id, walletAddress, r, ranAt);
        }
      } catch (err) {
        const message = extractError(err);
        for (const { dest } of toSend) {
          const r: DestinationRunResult = { destination: dest.destination, label: dest.label, status: "failed", error: message };
          results.push(r);
          logResult(group.id, walletAddress, r, ranAt);
        }
      }
    }
  } else {
    // ── Separate mode: one transaction per destination, with memo ────────────
    // Stop on first failure — partial sends corrupt the distribution; the same
    // imbalance would repeat every run until fixed.
    let aborted = false;
    for (const dest of group.destinations) {
      const amountSent = amounts.get(dest.id ?? dest.destination) ?? 0;
      // Test mode sends a dust amount by design — don't let the real minThreshold mark it "skipped".
      const minThreshold = group.testMode ? 0 : dest.minThreshold;
      const reason = skipReason(spendable, amountSent, minThreshold, dest.paused);
      let result: DestinationRunResult;

      if (aborted) {
        result = { destination: dest.destination, label: dest.label, status: "skipped", error: "Aborted — earlier payment failed" };
      } else if (reason) {
        result = { destination: dest.destination, label: dest.label, status: "skipped", error: reason };
      } else {
        try {
          let txHash: string | undefined;
          for (let attempt = 0; attempt < 2; attempt++) {
            if (attempt > 0) await new Promise<void>((resolve) => setTimeout(resolve, 1500));
            const account = await server.loadAccount(walletAddress);
            const builder = new TransactionBuilder(account, { fee: "100", networkPassphrase })
              .addOperation(
                Operation.payment({ destination: dest.destination, asset: Asset.native(), amount: amountSent.toFixed(7) })
              );
            if (dest.memo?.trim()) {
              builder.addMemo(Memo.text(dest.memo.trim().slice(0, 28)));
            }
            const tx = builder.setTimeout(30).build();
            const hash = tx.hash().toString("hex");
            const budgetErrors = await reserveMainnetSignature(null, hash, Number(tx.timeBounds?.maxTime), {
              destinations: [dest.destination], operationCount: 1,
              xlmAmount: amountSent + Number(tx.fee) / 1e7,
            });
            if (budgetErrors.length) throw new Error(budgetErrors.join("; "));
            tx.sign(keypair);
            runGuard = await recordAutoSendTransaction(group.id, runGuard!, {
              hash, destination: dest.destination, amount: amountSent, status: "prepared",
            });
            try {
              const sepResponse = await server.submitTransaction(tx);
              txHash = (sepResponse as { hash?: string }).hash ?? hash;
              runGuard = await markAutoSendTransactionSent(group.id, runGuard, hash);
              break;
            } catch (submitErr) {
              if (isBadSeq(submitErr)) {
                runGuard = await markAutoSendTransactionRejected(group.id, runGuard, hash);
                if (attempt === 0) continue;
              }
              throw submitErr;
            }
          }
          result = { destination: dest.destination, label: dest.label, status: "sent", amountSent, txHash };
        } catch (err) {
          aborted = true;
          result = { destination: dest.destination, label: dest.label, status: "failed", error: extractError(err) };
        }
      }

      results.push(result);
      logResult(group.id, walletAddress, result, ranAt);
    }
  }

  if (runGuard) {
    if (runGuard.transactions.some((tx) => tx.status !== "rejected") && results.some((result) => result.status === "failed")) await blockAutoSendRun(group.id, runGuard);
    else await completeAutoSendRun(group.id, runGuard);
  }

  return { groupId: group.id, walletAddress, ranAt, results };
}
