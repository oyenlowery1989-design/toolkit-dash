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
import { withAccountLock } from "@/lib/stellar-submit";
const { Server } = Horizon;

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

const DEFAULT_MIN_RESERVE = 10.0;
const FEE_BUDGET = 1.0; // flat 1 XLM safety buffer for fees

function extractError(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    // Stellar SDK 400 error — result_codes live in response.data.extras
    const extras = (e.response as Record<string, unknown> | undefined)?.data as Record<string, unknown> | undefined;
    if (extras?.extras) {
      const rc = (extras.extras as Record<string, unknown>).result_codes as Record<string, unknown> | undefined;
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

async function loadNativeBalance(server: InstanceType<typeof Server>, address: string): Promise<number> {
  const account = await server.loadAccount(address);
  return parseFloat(
    account.balances.find(
      (b: { asset_type: string; balance: string }) => b.asset_type === "native"
    )?.balance ?? "0"
  );
}

function calcAmount(spendable: number, percentage: number): number {
  return Math.floor(spendable * (percentage / 100) * 1e7) / 1e7;
}

function skipReason(spendable: number, amount: number, minThreshold: number, paused?: boolean): string | undefined {
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
function calcAmounts(spendable: number, destinations: AutoSendGroup["destinations"]): Map<string, number> {
  const amounts = new Map<string, number>();
  // First pass: fixed-% destinations
  let fixedTotal = 0;
  let surplus = 0;
  for (const dest of destinations) {
    const key = dest.id ?? dest.destination;
    if (!dest.isRemainder && !dest.paused) {
      const uncapped = calcAmount(spendable, dest.percentage);
      let amt = uncapped;
      if (dest.maxCap > 0) {
        amt = Math.min(amt, dest.maxCap);
        if (amt < uncapped) surplus += uncapped - amt;
      }
      amounts.set(key, amt);
      fixedTotal += amt;
    }
  }
  // Second pass: remainder destinations (split remaining equally if multiple)
  // Surplus from capped fixed destinations flows into the remainder pool
  const remainderDests = destinations.filter((d) => d.isRemainder && !d.paused);
  if (remainderDests.length > 0) {
    const leftover = Math.max(0, spendable - fixedTotal) + surplus;
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
  const horizonUrl = HORIZON_URLS[group.network] ?? HORIZON_URLS.public;
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
        ? `Account not found on ${group.network} — fund it with Friendbot (testnet) or send XLM to activate it`
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
  // 100 stroops per tx; batch = 1 tx, separate = 1 tx per destination
  const feeStroops = group.batchSend ? 100 : sendCount * 100;
  const estimatedFees = feeStroops / 1e7;

  return { groupId: group.id, walletAddress, xlmBalance, spendable, batchSend: group.batchSend, estimatedFees, items };
}

/** Execute the group run. Separate mode sends one tx per destination with its own memo.
 *  Batch mode sends all destinations in a single transaction with optional group-level memo.
 *  Wrapped below in a per-account mutex so concurrent runs (manual + scheduler) can't race
 *  on the same account's sequence number. */
export async function runGroup(group: AutoSendGroup): Promise<GroupRunResult> {
  let keypair: Keypair;
  try {
    keypair = Keypair.fromSecret(group.secretKey);
  } catch {
    // Invalid secret key — let runGroupInner produce the same error result; no account to lock.
    return runGroupInner(group);
  }
  return withAccountLock(keypair.publicKey(), () => runGroupInner(group));
}

async function runGroupInner(group: AutoSendGroup): Promise<GroupRunResult> {
  const horizonUrl = HORIZON_URLS[group.network] ?? HORIZON_URLS.public;
  const networkPassphrase = NETWORK_PASSPHRASES[group.network] ?? NETWORK_PASSPHRASES.public;
  const server = new Server(horizonUrl);
  const ranAt = Date.now();
  const results: DestinationRunResult[] = [];

  let keypair: Keypair;
  try {
    keypair = Keypair.fromSecret(group.secretKey);
  } catch {
    return { groupId: group.id, walletAddress: "invalid-key", ranAt, results: [] };
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
      ? `Account not found on ${group.network} — fund it with Friendbot (testnet) or send XLM to activate it`
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

  if (group.batchSend) {
    // ── Batch mode: one transaction, N payment ops ──────────────────────────
    const sendable = group.destinations.map((dest) => {
      const amount = amounts.get(dest.id ?? dest.destination) ?? 0;
      return { dest, amount, skip: skipReason(spendable, amount, dest.minThreshold, dest.paused) };
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
        tx.sign(keypair);
        const batchResponse = await server.submitTransaction(tx);
        const txHash = (batchResponse as { hash?: string }).hash;

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
      const reason = skipReason(spendable, amountSent, dest.minThreshold, dest.paused);
      let result: DestinationRunResult;

      if (aborted) {
        result = { destination: dest.destination, label: dest.label, status: "skipped", error: "Aborted — earlier payment failed" };
      } else if (reason) {
        result = { destination: dest.destination, label: dest.label, status: "skipped", error: reason };
      } else {
        try {
          // Retry once on tx_bad_seq — Horizon's short propagation delay can serve a stale
          // sequence number immediately after the previous submission.
          let txHash: string | undefined;
          for (let attempt = 0; attempt < 2; attempt++) {
            if (attempt > 0) await new Promise<void>((r) => setTimeout(r, 1500));
            const account = await server.loadAccount(walletAddress);
            const builder = new TransactionBuilder(account, { fee: "100", networkPassphrase })
              .addOperation(
                Operation.payment({ destination: dest.destination, asset: Asset.native(), amount: amountSent.toFixed(7) })
              );
            if (dest.memo?.trim()) {
              builder.addMemo(Memo.text(dest.memo.trim().slice(0, 28)));
            }
            const tx = builder.setTimeout(30).build();
            tx.sign(keypair);
            try {
              const sepResponse = await server.submitTransaction(tx);
              txHash = (sepResponse as { hash?: string }).hash;
              break;
            } catch (submitErr) {
              if (attempt === 0 && extractError(submitErr).includes("tx_bad_seq")) continue;
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

  return { groupId: group.id, walletAddress, ranAt, results };
}
