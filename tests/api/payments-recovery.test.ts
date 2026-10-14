import Database from "better-sqlite3";
import { Account, Asset, Horizon, Keypair, Networks, Operation, TransactionBuilder, rpc } from "stellar-sdk";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ db: null as unknown, auth: vi.fn(), reserve: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/supabase-server", () => ({ requireAuth: mocks.auth, isSupabaseOnly: () => false }));
vi.mock("@/lib/mainnet-signing-budget", () => ({
  reserveMainnetSignature: mocks.reserve,
  MainnetSigningBudgetUnavailableError: class extends Error {},
}));
import { POST } from "@/app/api/transactions/submit/route";
import { GET, DELETE } from "@/app/api/payments/submission/route";
const sender = Keypair.random();
const destination = Keypair.random().publicKey();
function payment(sequence = "1") {
  const tx = new TransactionBuilder(new Account(sender.publicKey(), sequence), { fee: "100", networkPassphrase: Networks.PUBLIC })
    .addOperation(Operation.payment({ destination, asset: Asset.native(), amount: "5" })).setTimeout(30).build();
  tx.sign(sender);
  return tx;
}
function req(tx = payment()) {
  return new NextRequest("http://localhost/api/transactions/submit", { method: "POST", body: JSON.stringify({ xdr: tx.toXDR(), trackPayment: true }) });
}
beforeEach(() => {
  mocks.db = new Database(":memory:");
  (mocks.db as Database.Database).exec("CREATE TABLE tiered_reward_run_leases (resource_id TEXT PRIMARY KEY, lease_token TEXT NOT NULL, expires_at INTEGER NOT NULL)");
  mocks.auth.mockResolvedValue({ ok: true, userId: "owner" });
  mocks.reserve.mockResolvedValue([]);
  vi.spyOn(rpc.Server.prototype, "getLatestLedger").mockResolvedValue({ sequence: 100 } as never);
  vi.spyOn(rpc.Server.prototype, "getTransaction").mockRejectedValue(new Error("RPC unavailable"));
  vi.spyOn(Horizon.Server.prototype, "transactions").mockReturnValue({ transaction: () => ({ call: async () => { throw new Error("not indexed yet"); } }) } as never);
});
afterEach(() => { (mocks.db as Database.Database).close(); vi.restoreAllMocks(); vi.clearAllMocks(); });

it("keeps a durable hash on response loss and rejects a rebuilt payment", async () => {
  const tx = payment();
  const submit = vi.spyOn(Horizon.Server.prototype, "submitTransaction").mockRejectedValue(new Error("response lost after commit"));
  const first = await POST(req(tx));
  expect(first.status).toBe(502);
  expect(await first.json()).toMatchObject({ hash: tx.hash().toString("hex"), unresolved: true });
  const stored = (mocks.db as Database.Database).prepare("SELECT lease_token FROM tiered_reward_run_leases").get() as { lease_token: string };
  expect(JSON.parse(stored.lease_token)).toMatchObject({ hash: tx.hash().toString("hex"), status: "pending" });
  expect((await POST(req(payment("2")))).status).toBe(409);
  expect(submit).toHaveBeenCalledTimes(1);
});

it("returns the completed result when an identical POST is retried", async () => {
  const tx = payment();
  const hash = tx.hash().toString("hex");
  const submit = vi.spyOn(Horizon.Server.prototype, "submitTransaction").mockResolvedValue({ hash, successful: true } as never);
  expect((await POST(req(tx))).status).toBe(200);
  const retry = await POST(req(tx));
  expect(retry.status).toBe(200);
  expect(await retry.json()).toMatchObject({ hash, successful: true });
  expect(submit).toHaveBeenCalledOnce();
});


it("reconciles a pending payment on reload and only acknowledges a confirmed outcome", async () => {
  const tx = payment();
  const hash = tx.hash().toString("hex");
  vi.spyOn(Horizon.Server.prototype, "submitTransaction").mockRejectedValue(new Error("connection lost"));
  await POST(req(tx));
  const check = () => GET(new NextRequest("http://localhost/api/payments/submission"));
  const clear = () => DELETE(new NextRequest("http://localhost/api/payments/submission", { method: "DELETE", body: JSON.stringify({ hash }) }));
  expect((await (await check()).json()).status).toBe("pending");
  expect((await clear()).status).toBe(409);
  vi.mocked(Horizon.Server.prototype.transactions).mockReturnValue({ transaction: () => ({ call: async () => ({ successful: true, hash }) }) } as never);
  expect(await (await check()).json()).toMatchObject({ status: "success", hash });
  expect((await clear()).status).toBe(200);
  expect(await (await check()).json()).toBeNull();
});

it("keeps an explicit failed transaction recoverable and permits a new confirmed attempt after acknowledgement", async () => {
  const tx = payment();
  const submit = vi.spyOn(Horizon.Server.prototype, "submitTransaction").mockRejectedValue({ response: { status: 400,
    data: { extras: { result_codes: { transaction: "tx_failed", operations: ["op_no_destination"] } } } } });
  expect((await POST(req(tx))).status).toBe(400);
  expect((await POST(req(payment("2")))).status).toBe(409);
  expect((await DELETE(new NextRequest("http://localhost/api/payments/submission", { method: "DELETE", body: JSON.stringify({ hash: tx.hash().toString("hex") }) }))).status).toBe(200);
  submit.mockResolvedValue({ hash: payment("2").hash().toString("hex"), successful: true } as never);
  expect((await POST(req(payment("2")))).status).toBe(200);
});

it("does not broadcast when durable storage is unavailable", async () => {
  (mocks.db as Database.Database).exec("DROP TABLE tiered_reward_run_leases");
  const submit = vi.spyOn(Horizon.Server.prototype, "submitTransaction");
  expect((await POST(req())).status).not.toBe(200);
  expect(submit).not.toHaveBeenCalled();
});

it("only one of two different simultaneous approvals can broadcast", async () => {
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const submit = vi.spyOn(Horizon.Server.prototype, "submitTransaction").mockImplementation(async tx => {
    await barrier;
    return { hash: tx.hash().toString("hex"), successful: true } as never;
  });
  const one = POST(req(payment()));
  const two = POST(req(payment("2")));
  await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  release();
  expect((await Promise.all([one,two])).map(r=>r.status).sort()).toEqual([200,409]);
});


it("releases a never-included expired transaction only with complete RPC history coverage", async () => {
  const tx = payment();
  vi.spyOn(Horizon.Server.prototype, "submitTransaction").mockRejectedValue(new Error("never reached network"));
  await POST(req(tx));
  vi.mocked(rpc.Server.prototype.getTransaction).mockResolvedValue({ status: rpc.Api.GetTransactionStatus.NOT_FOUND,
    oldestLedger: 90, latestLedger: 120, latestLedgerCloseTime: Number(tx.timeBounds!.maxTime) + 1 } as never);
  const response = await GET(new NextRequest("http://localhost/api/payments/submission"));
  expect(await response.json()).toMatchObject({ status: "failed", hash: tx.hash().toString("hex") });
});

it.each(["lag", "pruned"])("keeps a missing payment unresolved when RPC history is %s", async reason => {
  const tx = payment();
  vi.spyOn(Horizon.Server.prototype, "submitTransaction").mockRejectedValue(new Error("response lost"));
  await POST(req(tx));
  vi.mocked(rpc.Server.prototype.getTransaction).mockResolvedValue({ status: rpc.Api.GetTransactionStatus.NOT_FOUND,
    oldestLedger: reason === "pruned" ? 101 : 90, latestLedger: 120,
    latestLedgerCloseTime: Number(tx.timeBounds!.maxTime) + (reason === "lag" ? -1 : 1) } as never);
  expect(await (await GET(new NextRequest("http://localhost/api/payments/submission"))).json()).toMatchObject({ status: "pending" });
});

it("keeps an imported fee-bump unresolved when its earlier validity window is not retained", async () => {
  const inner = payment();
  const tx = TransactionBuilder.buildFeeBumpTransaction(sender, "200", inner, Networks.PUBLIC);
  tx.sign(sender);
  vi.spyOn(Horizon.Server.prototype, "submitTransaction").mockRejectedValue(new Error("response lost"));
  await POST(new NextRequest("http://localhost/api/transactions/submit", { method: "POST", body: JSON.stringify({ xdr: tx.toXDR(), trackPayment: true }) }));
  vi.mocked(rpc.Server.prototype.getTransaction).mockResolvedValue({ status: rpc.Api.GetTransactionStatus.NOT_FOUND,
    oldestLedger: 90, latestLedger: 120, oldestLedgerCloseTime: 1, latestLedgerCloseTime: Number(inner.timeBounds!.maxTime) + 1 } as never);
  expect(await (await GET(new NextRequest("http://localhost/api/payments/submission"))).json()).toMatchObject({ status: "pending" });
  vi.mocked(rpc.Server.prototype.getTransaction).mockImplementation(async hash => {
    if (hash === inner.hash().toString("hex")) return { status: rpc.Api.GetTransactionStatus.SUCCESS } as never;
    throw new Error("Unknown outer transaction");
  });
  expect(await (await GET(new NextRequest("http://localhost/api/payments/submission"))).json()).toMatchObject({ status: "success" });
});
