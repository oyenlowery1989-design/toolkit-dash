import Database from "better-sqlite3";
import { Account, Keypair } from "stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TierAssignment, TieredRewardConfig } from "@/lib/tiered-rewards/types";

const mocks = vi.hoisted(() => ({
  db: null as Database.Database | null,
  submit: vi.fn(), loadAccount: vi.fn(), reserve: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/supabase-server", () => ({ isSupabaseOnly: () => false, getSupabase: () => null }));
vi.mock("@/lib/run-lease", () => ({ acquireRunLease: async () => "lease", releaseRunLease: async () => {} }));
vi.mock("@/lib/mainnet-signing-budget", () => ({ reserveMainnetSignature: mocks.reserve }));
vi.mock("stellar-sdk", async (original) => {
  const sdk = await original<typeof import("stellar-sdk")>();
  return { ...sdk, Horizon: { ...sdk.Horizon, Server: class {
    loadAccount = mocks.loadAccount;
    submitTransaction = mocks.submit;
  } } };
});

import { runConfig } from "@/lib/tiered-rewards/runner";

const signer = Keypair.random();
const holders = [Keypair.random().publicKey(), Keypair.random().publicKey()];
const assignment: TierAssignment = {
  tier: { id: "tier", configId: "config", tierNumber: 1, minTokens: 0, position: 0,
    assets: [{ id: "reward", tierId: "tier", assetCode: "XLM", amount: 1.5 }] },
  holders: holders.map((address) => ({ address, balance: 1 })),
};
const config: TieredRewardConfig = {
  id: "config", name: "Reward", assetCode: "XLM", assetIssuer: signer.publicKey(),
  network: "public", secretKey: signer.secret(), intervalMinutes: null, enabled: true,
  minReserve: 10, minSenderThreshold: 0, previewOnly: false, batchSend: true,
  memo: null, feeMultiplier: 1, excludeAddresses: [], createdAt: 1, tiers: [assignment.tier],
};

beforeEach(() => {
  vi.stubEnv("MAINNET_TRANSACTIONS_ENABLED", "true");
  mocks.db = new Database(":memory:");
  mocks.db.exec(`CREATE TABLE tiered_reward_run_log (
    id TEXT PRIMARY KEY, config_id TEXT, tier_number INTEGER, holder_address TEXT,
    asset_code TEXT, asset_issuer TEXT, amount_sent REAL, status TEXT, tx_hash TEXT,
    error TEXT, ran_at INTEGER
  )`);
  mocks.submit.mockReset().mockResolvedValue({ hash: "submitted" });
  mocks.reserve.mockReset().mockResolvedValue([]);
  mocks.loadAccount.mockReset().mockResolvedValue(new Account(signer.publicKey(), "1"));
});
afterEach(() => { mocks.db?.close(); mocks.db = null; vi.unstubAllEnvs(); });

describe("Tiered Rewards daily signing budget", () => {
  it("reserves exact native amounts and fees before submitting a batch", async () => {
    const result = await runConfig(config, [assignment], "owner");
    expect(result).toMatchObject({ totalSent: 2, totalFailed: 0 });
    expect(mocks.reserve).toHaveBeenCalledTimes(1);
    expect(mocks.reserve.mock.calls[0][3]).toMatchObject({
      destinations: holders, operationCount: 2, xlmAmount: 3.00002,
    });
    expect(mocks.reserve.mock.invocationCallOrder[0]).toBeLessThan(mocks.submit.mock.invocationCallOrder[0]);
  });

  it("reserves each separate transaction and fails closed when storage is unavailable", async () => {
    mocks.reserve.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("Budget unavailable"));
    const result = await runConfig({ ...config, batchSend: false }, [assignment], "owner");
    expect(result).toMatchObject({ totalSent: 1, totalFailed: 1 });
    expect(mocks.reserve).toHaveBeenCalledTimes(2);
    expect(mocks.reserve.mock.calls[0][3]).toMatchObject({ operationCount: 1, xlmAmount: 1.50001 });
    expect(mocks.submit).toHaveBeenCalledTimes(1);
  });

  it("reserves the rebuilt transaction on a bad-sequence retry", async () => {
    mocks.submit.mockRejectedValueOnce({ response: { data: { extras: { result_codes: { transaction: "tx_bad_seq" } } } } })
      .mockResolvedValueOnce({ hash: "retried" });
    const result = await runConfig(config, [assignment], "owner");
    expect(result).toMatchObject({ totalSent: 2, totalFailed: 0 });
    expect(mocks.reserve).toHaveBeenCalledTimes(2);
    expect(mocks.submit).toHaveBeenCalledTimes(2);
  });

  it("does not submit a batch rejected by the daily budget", async () => {
    mocks.reserve.mockResolvedValueOnce(["Daily XLM limit would be exceeded"]);
    const result = await runConfig(config, [assignment], "owner");
    expect(result).toMatchObject({ totalSent: 0, totalFailed: 2 });
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("reserves each fallback transaction after a no-trust batch failure", async () => {
    mocks.submit.mockRejectedValueOnce({ response: { data: { extras: { result_codes: { operations: ["op_no_trust"] } } } } })
      .mockResolvedValue({ hash: "fallback" });
    const result = await runConfig(config, [assignment], "owner");
    expect(result).toMatchObject({ totalSent: 2, totalFailed: 0 });
    expect(mocks.reserve).toHaveBeenCalledTimes(3);
    expect(mocks.reserve.mock.calls.slice(1).map((call) => call[3].operationCount)).toEqual([1, 1]);
    expect(mocks.submit).toHaveBeenCalledTimes(3);
  });
});
