import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let db: Database.Database;
vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("@/lib/supabase-server", () => ({ isSupabaseOnly: () => false, getSupabase: () => null }));
import { getReservedMainnetXlm, MainnetSigningBudgetUnavailableError, reserveMainnetSignature } from "@/lib/mainnet-signing-budget";

const now = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const intent = (xlmAmount: number) => ({ destinations: [], operationCount: 1, xlmAmount });
const reserve = (hash: string, xlmAmount: number, at = now) =>
  reserveMainnetSignature("owner", hash.repeat(64), Math.floor(at / 1000) + 60, intent(xlmAmount), at);

beforeEach(() => {
  db = new Database(":memory:");
  db.exec("CREATE TABLE mainnet_signing_budget (bucket_key TEXT PRIMARY KEY, entries_json TEXT NOT NULL)");
  vi.stubEnv("MAINNET_TRANSACTIONS_ENABLED", "true");
  vi.stubEnv("MAINNET_EMERGENCY_STOP", "false");
  vi.stubEnv("MAINNET_MAX_XLM_PER_RUN", "10");
  vi.stubEnv("MAINNET_MAX_XLM_PER_DAY", "3");
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); });

describe("mainnet signing reservations", () => {
  it("counts separate signatures atomically and does not count a retry twice", async () => {
    expect(await reserve("a", 2)).toEqual([]);
    expect(await getReservedMainnetXlm(now)).toBeCloseTo(2);
    expect(await reserve("a", 2)).toEqual([]);
    expect(await reserve("b", 2)).toContain("Daily XLM limit of 3 would be exceeded");
    expect(await reserve("c", 1)).toEqual([]);
    expect(await reserve("d", 0.00001)).toContain("Daily XLM limit of 3 would be exceeded");
    const stored = db.prepare("SELECT entries_json FROM mainnet_signing_budget WHERE bucket_key = 'global'").get() as { entries_json: string };
    expect(JSON.parse(stored.entries_json)).toHaveLength(2);
  });

  it("rejects one of two simultaneous reservations that would exceed the cap", async () => {
    const results = await Promise.all([reserve("a", 2), reserve("b", 2)]);
    expect(results.filter((errors) => errors.length === 0)).toHaveLength(1);
    expect(results.filter((errors) => errors.length > 0)).toHaveLength(1);
  });

  it("upgrades an existing signature when submission discovers more XLM exposure", async () => {
    expect(await reserve("a", 1)).toEqual([]);
    expect(await reserve("a", 2)).toEqual([]);
    expect(await getReservedMainnetXlm(now)).toBe(2);
    expect(await reserve("a", 1)).toEqual([]);
    expect(await reserve("b", 1.0000001)).toContain("Daily XLM limit of 3 would be exceeded");
  });

  it("keeps a signature counted for 24 hours after its expiry", async () => {
    expect(await reserve("a", 2)).toEqual([]);
    expect(await reserve("b", 2, now + DAY + 59_000)).toContain("Daily XLM limit of 3 would be exceeded");
    expect(await reserve("b", 2, now + DAY + 60_000)).toEqual([]);
    expect(await getReservedMainnetXlm(now + DAY + 60_000)).toBeCloseTo(2);
  });

  it("fails closed if the ledger is unavailable or corrupt", async () => {
    expect(await reserve("a", 1)).toEqual([]);
    db.exec("UPDATE mainnet_signing_budget SET entries_json = 'bad-json'");
    await expect(getReservedMainnetXlm(now)).rejects.toBeInstanceOf(MainnetSigningBudgetUnavailableError);
    await expect(reserve("b", 1)).rejects.toBeInstanceOf(MainnetSigningBudgetUnavailableError);
    db.exec("DROP TABLE mainnet_signing_budget");
    await expect(reserve("c", 1)).rejects.toBeInstanceOf(MainnetSigningBudgetUnavailableError);
  });
});
