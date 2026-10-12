import Database from "better-sqlite3";
import { Account, Keypair } from "stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AutoSendGroup } from "@/lib/auto-send/types";

const mocks = vi.hoisted(() => ({
  db: null as Database.Database | null,
  submit: vi.fn(),
  loadAccount: vi.fn(),
  reserve: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/supabase-server", () => ({ isSupabaseOnly: () => false, getSupabase: () => null }));
vi.mock("@/lib/run-lease", () => ({ acquireRunLease: async () => "lease", releaseRunLease: async () => {} }));
vi.mock("@/lib/stellar-submit", () => ({
  withAccountLock: async (_key: string, fn: () => Promise<unknown>) => fn(),
  isBadSeq: (error: any) => error?.response?.data?.extras?.result_codes?.transaction === "tx_bad_seq",
}));
vi.mock("@/lib/mainnet-safety", () => ({ validateMainnetRun: () => [] }));
vi.mock("@/lib/mainnet-signing-budget", () => ({ reserveMainnetSignature: mocks.reserve }));
vi.mock("stellar-sdk", async (original) => {
  const sdk = await original<typeof import("stellar-sdk")>();
  return { ...sdk, Horizon: { ...sdk.Horizon, Server: class {
    loadAccount = mocks.loadAccount;
    submitTransaction = mocks.submit;
  } } };
});

import { runGroup } from "@/lib/auto-send/runner";
import { AutoSendReconciliationRequiredError, readAutoSendRunGuard } from "@/lib/auto-send/run-guard";

const signer = Keypair.random();
const group: AutoSendGroup = {
  id: "group-1", name: "Scheduled", network: "public", secretKey: signer.secret(),
  intervalMinutes: 60, enabled: true, batchSend: false, minReserve: 10,
  minSenderThreshold: 0, previewOnly: false, createdAt: 1,
  destinations: [
    { id: "one", groupId: "group-1", destination: Keypair.random().publicKey(), percentage: 50, isRemainder: false, minThreshold: 0, maxCap: 0, paused: false, position: 0 },
    { id: "two", groupId: "group-1", destination: Keypair.random().publicKey(), percentage: 50, isRemainder: false, minThreshold: 0, maxCap: 0, paused: false, position: 1 },
  ],
};

beforeEach(() => {
  mocks.db = new Database(":memory:");
  mocks.db.exec(`CREATE TABLE auto_send_run_log (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, wallet_address TEXT NOT NULL,
    destination TEXT NOT NULL, amount_sent REAL, status TEXT NOT NULL,
    error TEXT, ran_at INTEGER NOT NULL, tx_hash TEXT
  )`);
  mocks.submit.mockReset();
  mocks.loadAccount.mockReset();
  mocks.reserve.mockReset().mockResolvedValue([]);
  mocks.loadAccount.mockImplementation(async () => Object.assign(new Account(signer.publicKey(), "1"), {
    balances: [{ asset_type: "native", balance: "100" }],
  }));
});
afterEach(() => { mocks.db?.close(); mocks.db = null; });

describe("guarded Auto-Send execution", () => {
  it("records hashes before submission and blocks a repeat after partial success", async () => {
    mocks.submit.mockImplementationOnce(async () => {
      const guard = await readAutoSendRunGuard(group.id);
      expect(guard?.transactions).toHaveLength(1);
      expect(guard?.transactions[0].status).toBe("prepared");
      return { hash: guard!.transactions[0].hash };
    }).mockRejectedValueOnce(new Error("Horizon unavailable"));

    const result = await runGroup(group);
    expect(result.results.map((row) => row.status)).toEqual(["sent", "failed"]);
    const guard = await readAutoSendRunGuard(group.id);
    expect(guard?.state).toBe("blocked");
    expect(guard?.transactions.map((tx) => tx.status)).toEqual(["sent", "prepared"]);
    await expect(runGroup(group)).rejects.toBeInstanceOf(AutoSendReconciliationRequiredError);
    expect(mocks.submit).toHaveBeenCalledTimes(2);
    expect(mocks.reserve).toHaveBeenCalledTimes(2);
    expect(mocks.reserve.mock.calls[0][3]).toMatchObject({ destinations: [group.destinations[0].destination], operationCount: 1 });
    expect(mocks.reserve.mock.calls[0][3].xlmAmount).toBeGreaterThan(0);
  });

  it("does not sign or submit when daily budget cannot be verified", async () => {
    mocks.reserve.mockRejectedValueOnce(new Error("Budget unavailable"));
    const result = await runGroup({ ...group, id: "budget-failure", destinations: [group.destinations[0]] });
    expect(result.results).toMatchObject([{ status: "failed", error: "Budget unavailable" }]);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(await readAutoSendRunGuard("budget-failure")).toBeNull();
  });

  it("reserves the full payment and fee for a batch before submitting", async () => {
    mocks.submit.mockResolvedValue({ hash: "submitted" });
    const result = await runGroup({ ...group, id: "batch-budget", batchSend: true });
    expect(result.results.map((row) => row.status)).toEqual(["sent", "sent"]);
    expect(mocks.reserve).toHaveBeenCalledTimes(1);
    expect(mocks.reserve.mock.calls[0][3]).toMatchObject({
      destinations: group.destinations.map((dest) => dest.destination),
      operationCount: 2, xlmAmount: 89.00002,
    });
    expect(mocks.reserve.mock.invocationCallOrder[0]).toBeLessThan(mocks.submit.mock.invocationCallOrder[0]);
  });

  it("rebuilds and reserves once after a definite bad-sequence rejection", async () => {
    let loads = 0;
    mocks.loadAccount.mockImplementation(async () => Object.assign(new Account(signer.publicKey(), String(++loads)), {
      balances: [{ asset_type: "native", balance: "100" }],
    }));
    mocks.submit.mockRejectedValueOnce({ response: { data: { extras: { result_codes: { transaction: "tx_bad_seq" } } } } })
      .mockImplementationOnce(async () => {
        const guard = await readAutoSendRunGuard("bad-seq");
        expect(guard?.transactions.map((tx) => tx.status)).toEqual(["rejected", "prepared"]);
        return { hash: guard!.transactions[1].hash };
      });
    const result = await runGroup({ ...group, id: "bad-seq", destinations: [group.destinations[0]] });
    expect(result.results).toMatchObject([{ status: "sent" }]);
    expect(mocks.reserve).toHaveBeenCalledTimes(2);
    expect(mocks.reserve.mock.calls[0][1]).not.toBe(mocks.reserve.mock.calls[1][1]);
    expect(mocks.submit).toHaveBeenCalledTimes(2);
    expect(await readAutoSendRunGuard("bad-seq")).toBeNull();
  });

  it("releases a rejected-only guard when the retry cannot reserve budget", async () => {
    mocks.submit.mockRejectedValueOnce({ response: { data: { extras: { result_codes: { transaction: "tx_bad_seq" } } } } });
    mocks.reserve.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("Budget unavailable"));
    const result = await runGroup({ ...group, id: "bad-seq-budget", destinations: [group.destinations[0]] });
    expect(result.results).toMatchObject([{ status: "failed", error: "Budget unavailable" }]);
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(await readAutoSendRunGuard("bad-seq-budget")).toBeNull();
  });

  it("does not leave a blocked guard after both attempts are definitively rejected", async () => {
    const badSeq = { response: { data: { extras: { result_codes: { transaction: "tx_bad_seq" } } } } };
    mocks.submit.mockRejectedValueOnce(badSeq).mockRejectedValueOnce(badSeq);
    const result = await runGroup({ ...group, id: "bad-seq-twice", destinations: [group.destinations[0]] });
    expect(result.results).toMatchObject([{ status: "failed" }]);
    expect(mocks.submit).toHaveBeenCalledTimes(2);
    expect(await readAutoSendRunGuard("bad-seq-twice")).toBeNull();
  });
});
