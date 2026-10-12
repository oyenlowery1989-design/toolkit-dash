import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ db: null as Database.Database | null }));
vi.mock("@/lib/db", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/supabase-server", () => ({ isSupabaseOnly: () => false, getSupabase: () => null }));

import {
  AutoSendReconciliationRequiredError, blockAutoSendRun, claimAutoSendRun,
  completeAutoSendRun, deleteAutoSendRunGuard, markAutoSendTransactionSent,
  readAutoSendRunGuard, recordAutoSendTransaction,
} from "@/lib/auto-send/run-guard";

beforeEach(() => {
  mocks.db = new Database(":memory:");
  mocks.db.exec(`CREATE TABLE auto_send_run_log (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, wallet_address TEXT NOT NULL,
    destination TEXT NOT NULL, amount_sent REAL, status TEXT NOT NULL,
    error TEXT, ran_at INTEGER NOT NULL, tx_hash TEXT
  )`);
});
afterEach(() => { mocks.db?.close(); mocks.db = null; });

describe("durable Auto-Send run guard", () => {
  it("records the hash before submission and blocks another run until reconciliation", async () => {
    let guard = await claimAutoSendRun("g1", "GABC");
    await expect(claimAutoSendRun("g1", "GABC")).rejects.toBeInstanceOf(AutoSendReconciliationRequiredError);
    guard = await recordAutoSendTransaction("g1", guard, { hash: "hash-1", destination: "GDEST", amount: 5, status: "prepared" });
    expect((await readAutoSendRunGuard("g1"))?.transactions).toEqual(guard.transactions);
    await blockAutoSendRun("g1", guard);
    expect((await readAutoSendRunGuard("g1"))?.state).toBe("blocked");
    await expect(claimAutoSendRun("g1", "GABC")).rejects.toBeInstanceOf(AutoSendReconciliationRequiredError);
    await deleteAutoSendRunGuard("g1", (await readAutoSendRunGuard("g1"))!);
    expect(await readAutoSendRunGuard("g1")).toBeNull();
  });

  it("clears the guard only after every prepared transaction was confirmed", async () => {
    let guard = await claimAutoSendRun("g1", "GABC");
    guard = await recordAutoSendTransaction("g1", guard, { hash: "hash-1", destination: "GDEST", amount: 5, status: "prepared" });
    await expect(completeAutoSendRun("g1", guard)).rejects.toBeInstanceOf(AutoSendReconciliationRequiredError);
    guard = await markAutoSendTransactionSent("g1", guard, "hash-1");
    await completeAutoSendRun("g1", guard);
    expect(await readAutoSendRunGuard("g1")).toBeNull();
  });

  it("fails closed if the guard disappears before recording a hash", async () => {
    const guard = await claimAutoSendRun("g1", "GABC");
    await deleteAutoSendRunGuard("g1", guard);
    await expect(recordAutoSendTransaction("g1", guard, { hash: "hash-1", destination: "GDEST", amount: 5, status: "prepared" }))
      .rejects.toThrow(/guard changed/);
  });
});
