import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { Keypair } from "stellar-sdk";
import type { BulkPaymentJournal } from "@/lib/bulk-payments/types";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), getDb: vi.fn(), lookup: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("stellar-sdk", async (original) => {
  const sdk = await original<typeof import("stellar-sdk")>();
  return { ...sdk, Horizon: { ...sdk.Horizon, Server: class {
    transactions = () => ({ transaction: () => ({ call: mocks.lookup }) });
  } } };
});
vi.mock("@/lib/supabase-server", () => ({
  requireAuth: mocks.auth, isSupabaseOnly: () => false, getSupabase: () => null, resolveLocalSyncUserId: () => null,
}));
import { GET, POST, DELETE } from "@/app/api/db/bulk-payment-journal/route";

const sender = Keypair.random().publicKey();
const recipient = Keypair.random().publicKey();
let db: Database.Database;
function req(method: "GET" | "POST" | "DELETE", body?: unknown) {
  return new NextRequest("http://localhost/api/db/bulk-payment-journal", {
    method, ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function post(j: unknown, expectedVersion: number | null) {
  return POST(req("POST", { journal: j, expectedVersion }));
}
function journal(): BulkPaymentJournal {
  return {
    runId: "123e4567-e89b-12d3-a456-426614174000", version: 0,
    network: "public", sender, memo: "", amount: "0.1", assetCode: null,
    assetIssuer: null, feeMultiplier: 1, batches: [[recipient]],
    results: [{ batchIndex: 0, count: 1, status: "pending" }], status: "sending",
  };
}

beforeEach(() => {
  db = new Database(":memory:");
  db.exec("CREATE TABLE bulk_payment_journal (user_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, version INTEGER NOT NULL, payload_json TEXT NOT NULL, updated_at INTEGER NOT NULL)");
  mocks.getDb.mockReturnValue(db);
  mocks.auth.mockResolvedValue({ ok: true, userId: "owner" });
  mocks.lookup.mockReset().mockResolvedValue({ successful: true });
});
afterEach(() => db.close());

describe("bulk payment recovery journal", () => {
  it("requires auth and stores no signing secret or signed envelope", async () => {
    mocks.auth.mockResolvedValueOnce({ ok: false, response: new Response("", { status: 401 }) });
    expect((await GET(req("GET"))).status).toBe(401);
    const start = await post({ ...journal(), secretKey: "SSECRET" }, null);
    expect(start.status).toBe(200);
    expect((await GET(req("GET"))).status).toBe(200);
    expect(JSON.stringify(await (await GET(req("GET"))).json())).not.toContain("secretKey");
    expect((await post(journal(), null)).status).toBe(409);
  });

  it("keeps a pre-broadcast hash across reload and blocks clearing until resolved", async () => {
    expect((await post(journal(), null)).status).toBe(200);
    const hash = "a".repeat(64);
    const checkpoint = { ...journal(), version: 1, results: [{ batchIndex: 0, count: 1, status: "uncertain" as const, txHash: hash }] };
    expect((await post(checkpoint, 0)).status).toBe(200);
    await expect((await GET(req("GET"))).json()).resolves.toMatchObject({ results: [{ status: "uncertain", txHash: hash }] });
    expect((await DELETE(req("DELETE"))).status).toBe(409);
    expect((await post({ ...checkpoint, version: 2, status: "done", results: [{ batchIndex: 0, count: 1, status: "success", txHash: hash }] }, 1)).status).toBe(200);
    expect((await DELETE(req("DELETE"))).status).toBe(200);
    expect(await (await GET(req("GET"))).json()).toBeNull();
  });

  it("rejects stale tab updates and invalid journals", async () => {
    expect((await post(journal(), null)).status).toBe(200);
    expect((await post({ ...journal(), version: 2 }, 1)).status).toBe(409);
    expect((await post({ ...journal(), results: [{ batchIndex: 0, count: 1, status: "uncertain", signedXdr: "secret" }] }, 0)).status).toBe(400);
  });

  it("does not let a client erase or falsely fail an unresolved hash", async () => {
    expect((await post(journal(), null)).status).toBe(200);
    const hash = "b".repeat(64);
    const checkpoint = { ...journal(), version: 1, results: [{ batchIndex: 0, count: 1, status: "uncertain" as const, txHash: hash }] };
    expect((await post(checkpoint, 0)).status).toBe(200);
    expect((await post({ ...checkpoint, version: 2, results: [{ batchIndex: 0, count: 1, status: "failed" }] }, 1)).status).toBe(409);
    mocks.lookup.mockRejectedValueOnce(new Error("Not found"));
    expect((await post({ ...checkpoint, version: 2, results: [{ batchIndex: 0, count: 1, status: "failed", txHash: hash }] }, 1)).status).toBe(409);
    expect((await DELETE(req("DELETE"))).status).toBe(409);
    expect((await GET(req("GET"))).json()).resolves.toMatchObject({ results: [{ status: "uncertain", txHash: hash }] });
  });

  it("retains a hash when Horizon indexing lags, then permits later confirmation", async () => {
    expect((await post(journal(), null)).status).toBe(200);
    const hash = "c".repeat(64);
    const checkpoint = { ...journal(), version: 1, results: [{ batchIndex: 0, count: 1, status: "uncertain" as const, txHash: hash }] };
    expect((await post(checkpoint, 0)).status).toBe(200);
    const confirmed = { ...checkpoint, version: 2, status: "done" as const,
      results: [{ batchIndex: 0, count: 1, status: "success" as const, txHash: hash }] };
    mocks.lookup.mockRejectedValueOnce(new Error("Not indexed yet"));
    expect((await post(confirmed, 1)).status).toBe(409);
    expect((await DELETE(req("DELETE"))).status).toBe(409);
    expect((await post(confirmed, 1)).status).toBe(200);
  });
});
