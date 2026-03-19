import { Keypair, TransactionBuilder, Operation, Asset, Horizon } from "stellar-sdk";
import type { TieredRewardConfig, TierAssignment, RunLogRow } from "./types";
import { getDb } from "@/lib/db";

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

function insertLogRows(rows: Omit<RunLogRow, "id">[]): void {
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
  return assetCode === "XLM" ? Asset.native() : new Asset(assetCode, assetIssuer!);
}

type SendOp = { holder: string; assetCode: string; assetIssuer?: string; amount: number };

async function runTier(
  server: InstanceType<typeof Server>,
  keypair: Keypair,
  networkPassphrase: string,
  assignment: TierAssignment,
  configId: string | undefined,
  ranAt: number
): Promise<void> {
  const { tier, holders } = assignment;
  if (holders.length === 0) return;

  const senderAddress = keypair.publicKey();

  const ops: SendOp[] = [];
  for (const holder of holders) {
    for (const asset of tier.assets) {
      ops.push({ holder: holder.address, assetCode: asset.assetCode, assetIssuer: asset.assetIssuer, amount: asset.amount });
    }
  }

  let aborted = false;
  let batchStart = 0;

  while (batchStart < ops.length) {
    if (aborted) break;

    const batch = ops.slice(batchStart, batchStart + BATCH_SIZE);

    try {
      const account = await server.loadAccount(senderAddress);
      const builder = new TransactionBuilder(account, { fee: "100", networkPassphrase });

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

      insertLogRows(
        batch.map((op) => ({
          configId,
          tierNumber: tier.tierNumber,
          holderAddress: op.holder,
          assetCode: op.assetCode,
          assetIssuer: op.assetIssuer,
          amountSent: op.amount,
          status: "sent" as const,
          txHash,
          ranAt,
        }))
      );
    } catch (err) {
      const message = extractError(err);
      aborted = true;

      insertLogRows(
        batch.map((op) => ({
          configId,
          tierNumber: tier.tierNumber,
          holderAddress: op.holder,
          assetCode: op.assetCode,
          assetIssuer: op.assetIssuer,
          amountSent: 0,
          status: "failed" as const,
          error: message,
          ranAt,
        }))
      );
    }

    batchStart += BATCH_SIZE;
  }

  // Log remaining ops as aborted if we broke out early
  if (aborted && batchStart < ops.length) {
    const remaining = ops.slice(batchStart);
    insertLogRows(
      remaining.map((op) => ({
        configId,
        tierNumber: tier.tierNumber,
        holderAddress: op.holder,
        assetCode: op.assetCode,
        assetIssuer: op.assetIssuer,
        amountSent: 0,
        status: "aborted" as const,
        error: "Aborted — earlier batch failed",
        ranAt,
      }))
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

export async function runConfig(
  config: TieredRewardConfig,
  assignments: TierAssignment[]
): Promise<RunResult | { error: string }> {
  const horizonUrl = HORIZON_URLS[config.network] ?? HORIZON_URLS.public;
  const networkPassphrase = NETWORK_PASSPHRASES[config.network] ?? NETWORK_PASSPHRASES.public;
  const server = new Server(horizonUrl);
  const ranAt = Date.now();

  let keypair: Keypair;
  try {
    keypair = Keypair.fromSecret(config.secretKey);
  } catch {
    return { error: "Invalid secret key" };
  }

  for (const assignment of assignments) {
    await runTier(server, keypair, networkPassphrase, assignment, config.id, ranAt);
  }

  // Update last_run_at
  try {
    const db = getDb();
    db.prepare("UPDATE tiered_reward_configs SET last_run_at = ?, last_failure_at = NULL WHERE id = ?")
      .run(ranAt, config.id);
  } catch { /* non-fatal */ }

  // Tally results
  const statusRows = (() => {
    try {
      const db = getDb();
      return db.prepare("SELECT status FROM tiered_reward_run_log WHERE config_id = ? AND ran_at = ?")
        .all(config.id, ranAt) as { status: string }[];
    } catch { return []; }
  })();

  return {
    configId: config.id,
    senderAddress: keypair.publicKey(),
    ranAt,
    tiersProcessed: assignments.length,
    totalSent: statusRows.filter((r) => r.status === "sent").length,
    totalFailed: statusRows.filter((r) => r.status === "failed" || r.status === "aborted").length,
  };
}
