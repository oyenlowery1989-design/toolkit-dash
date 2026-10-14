import Database from "better-sqlite3";
import { Keypair, type Transaction } from "stellar-sdk";
import { NextRequest } from "next/server";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ db: null as Database.Database | null, balance: "21", loads: 0, deposited: false, executionBalance: "31", sequence: 1, submit: vi.fn(), preview: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/supabase-server", () => ({ isSupabaseOnly: () => false, getSupabase: () => null, requireAuth: async () => ({ ok: true, userId: "owner" }) }));
vi.mock("@/lib/mainnet-signing-budget", () => ({ reserveMainnetSignature: async () => [], getReservedMainnetXlm: async () => 0, MainnetSigningBudgetUnavailableError: class extends Error {} }));
vi.mock("@/lib/auto-send/db-map", () => ({ rowToGroup: () => group }));
vi.mock("@/lib/auto-send/scheduler", () => ({ refreshScheduler: vi.fn() }));
vi.mock("@/lib/tiered-rewards/scheduler", () => ({ refreshTieredRewardsScheduler: vi.fn() }));
vi.mock("@/lib/tiered-rewards/db", () => ({ loadConfig: () => config }));
vi.mock("@/lib/tiered-rewards/calculator", () => ({ calculatePreview: mocks.preview }));
vi.mock("@/lib/tiered-rewards/signing", () => ({ resolveRewardSigningConfig: async (c: unknown) => c, rewardSigningFields: () => ({}) }));
vi.mock("stellar-sdk", async (original) => {
  const sdk = await original<typeof import("stellar-sdk")>();
  return { ...sdk, Horizon: { ...sdk.Horizon, Server: class {
    async loadAccount() {
      const balance = mocks.deposited && ++mocks.loads > 1 ? mocks.executionBalance : mocks.balance;
      return Object.assign(new sdk.Account(signer.publicKey(), String(mocks.sequence)), { balances: [{ asset_type: "native", balance }] });
    }
    submitTransaction = mocks.submit;
    transactions() { return { transaction: () => ({ call: async () => { throw new Error("Unknown ledger outcome"); } }) }; }
  } } };
});
import { POST as autoPost } from "@/app/api/auto-send/run/route";
import { POST as rewardsPost } from "@/app/api/tiered-rewards/run/route";
const signer = Keypair.random();
const destination = Keypair.random().publicKey();
const group = { id: "g", name: "g", network: "public", secretKey: signer.secret(), minReserve: 10, minSenderThreshold: 0, batchSend: true, destinations: [{ id: "d", destination, percentage: 100, minThreshold: 0, maxCap: 0, paused: false, isRemainder: false }] };
const config = { id: "c", name: "c", network: "public", secretKey: signer.secret(), batchSend: true, feeMultiplier: 1, excludeAddresses: [], tiers: [] };
const preview = { configId: "c", senderAddress: signer.publicKey(), assignments: [{ tier: { id: "t", tierNumber: 1, assets: [{ assetCode: "XLM", amount: 1 }] }, holders: [{ address: destination, balance: 1 }] }], blocked: false, blockReasons: [] };
const request = (body: unknown) => new NextRequest("http://localhost/api/run", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => {
  vi.stubEnv("MAINNET_TRANSACTIONS_ENABLED", "true"); vi.stubEnv("PREVIEW_APPROVAL_SECRET", "test-key");
  mocks.db = new Database(":memory:");
  mocks.db.exec(`CREATE TABLE auto_send_groups(id TEXT PRIMARY KEY); INSERT INTO auto_send_groups VALUES('g');
    CREATE TABLE auto_send_destinations(group_id TEXT, position INTEGER);
    CREATE TABLE auto_send_run_leases(resource_id TEXT PRIMARY KEY,lease_token TEXT,expires_at INTEGER);
    CREATE TABLE auto_send_run_log(id TEXT PRIMARY KEY,group_id TEXT,wallet_address TEXT,destination TEXT,amount_sent REAL,status TEXT,error TEXT,ran_at INTEGER,tx_hash TEXT);
    CREATE TABLE tiered_reward_run_leases(resource_id TEXT PRIMARY KEY,lease_token TEXT,expires_at INTEGER);
    CREATE TABLE tiered_reward_run_log(id TEXT PRIMARY KEY,config_id TEXT,tier_number INTEGER,holder_address TEXT,asset_code TEXT,asset_issuer TEXT,amount_sent REAL,status TEXT,tx_hash TEXT,error TEXT,ran_at INTEGER);
    CREATE TABLE tiered_reward_configs(id TEXT PRIMARY KEY,last_run_at INTEGER); INSERT INTO tiered_reward_configs VALUES('c',0);`);
  config.batchSend = true;
  mocks.balance = "21"; mocks.loads = 0; mocks.deposited = false; mocks.executionBalance = "31"; mocks.sequence = 1;
  mocks.preview.mockReset().mockResolvedValue(preview);
  mocks.submit.mockReset().mockImplementation(async (tx: Transaction) => { mocks.sequence++; return { hash: tx.hash().toString("hex") }; });
});
afterEach(() => { mocks.db?.close(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
async function rewardToken() { return (await (await rewardsPost(request({ configId: "c", mode: "preview" }))).json()).previewToken; }
it("returns the completed reward outcome after a lost HTTP response and changed holder state", async () => {
  const token = await rewardToken();
  const run = () => rewardsPost(request({ configId: "c", mode: "run", previewToken: token }));
  const first = await run(); const outcome = await first.json();
  expect(first.status).toBe(200); expect(outcome.totalSent).toBe(1);
  expect(await (await run()).json()).toEqual(outcome);
  mocks.preview.mockResolvedValue({ ...preview, assignments: [] });
  const retry = await run(); expect(retry.status).toBe(200); expect(await retry.json()).toEqual(outcome);
  expect(mocks.submit).toHaveBeenCalledTimes(1);
});
it("claims the same approval atomically during concurrent requests", async () => {
  const token = await rewardToken();
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let entered!: () => void; const submitted = new Promise<void>((resolve) => { entered = resolve; });
  mocks.submit.mockImplementation(async (tx: Transaction) => { entered(); await blocked; return { hash: tx.hash().toString("hex") }; });
  const first = rewardsPost(request({ configId: "c", mode: "run", previewToken: token }));
  await submitted;
  try { expect((await rewardsPost(request({ configId: "c", mode: "run", previewToken: token }))).status).toBe(409); }
  finally { release(); }
  expect((await first).status).toBe(200); expect(mocks.submit).toHaveBeenCalledTimes(1);
});
it("requires a fresh approval for another deliberate distribution", async () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.now());
  const first = await rewardToken();
  await rewardsPost(request({ configId: "c", mode: "run", previewToken: first }));
  const second = await rewardToken(); expect(second).not.toBe(first);
  expect((await rewardsPost(request({ configId: "c", mode: "run", previewToken: second }))).status).toBe(200);
  expect(mocks.submit).toHaveBeenCalledTimes(2);
});
it("does not rebroadcast an uncertain reward approval even after a retry", async () => {
  const token = await rewardToken(); mocks.submit.mockRejectedValue(new Error("response lost"));
  const run = () => rewardsPost(request({ configId: "c", mode: "run", previewToken: token }));
  const outcome = await (await run()).json(); expect(outcome.reconciliationRequired).toBe(true);
  expect(await (await run()).json()).toEqual(outcome); expect(mocks.submit).toHaveBeenCalledTimes(1);
});
for (const batchSend of [true, false]) it(`executes the approved Auto-Send amount after an incoming deposit (batch=${batchSend})`, async () => {
  group.batchSend = batchSend;
  const dry = await (await autoPost(request({ groupId: "g", dryRun: true }))).json();
  expect(dry.items[0].amountXlm).toBe(10); mocks.deposited = true;
  const response = await autoPost(request({ groupId: "g", previewToken: dry.previewToken }));
  expect(response.status).toBe(200); expect((await response.json()).results[0].amountSent).toBe(10);
  expect(mocks.submit.mock.calls[0][0].operations[0].amount).toBe("10.0000000");
});

it("rejects an approved plan if the balance falls below its payment and reserve", async () => {
  const dry = await (await autoPost(request({ groupId: "g", dryRun: true }))).json();
  mocks.deposited = true; mocks.executionBalance = "15";
  const response = await autoPost(request({ groupId: "g", previewToken: dry.previewToken }));
  expect(response.status).toBe(428); expect((await response.json()).error).toContain("reserve"); expect(mocks.submit).not.toHaveBeenCalled();
});

it("retains a partial reward outcome without repeating confirmed recipients", async () => {
  config.batchSend = false;
  mocks.preview.mockResolvedValue({ ...preview, assignments: [{ ...preview.assignments[0], holders: [
    { address: destination, balance: 1 }, { address: Keypair.random().publicKey(), balance: 1 },
  ] }] });
  const token = await rewardToken();
  mocks.submit.mockImplementationOnce(async (tx: Transaction) => { mocks.sequence++; return { hash: tx.hash().toString("hex") }; }).mockRejectedValueOnce(new Error("response lost"));
  const run = () => rewardsPost(request({ configId: "c", mode: "run", previewToken: token }));
  const outcome = await (await run()).json();
  expect(outcome).toMatchObject({ totalSent: 1, totalFailed: 1, reconciliationRequired: true });
  expect(await (await run()).json()).toEqual(outcome); expect(mocks.submit).toHaveBeenCalledTimes(2);
});

it("returns a recorded reward outcome even after the approval expires", async () => {
  const now = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(now);
  const token = await rewardToken();
  const run = () => rewardsPost(request({ configId: "c", mode: "run", previewToken: token }));
  const outcome = await (await run()).json();
  clock.mockReturnValue(now + 6 * 60_000);
  const retry = await run();
  expect(retry.status).toBe(200);
  expect(await retry.json()).toEqual(outcome);
  expect(mocks.submit).toHaveBeenCalledOnce();
});
