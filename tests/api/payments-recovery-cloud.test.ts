import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Account, Asset, Horizon, Keypair, Networks, Operation, TransactionBuilder, rpc } from "stellar-sdk";
import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: null as SupabaseClient | null, userId: "owner", authenticated: true, reserve: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => { throw new Error("Cloud recovery must not access SQLite"); } }));
vi.mock("@/lib/supabase-server", () => ({
  isSupabaseOnly: () => true, getSupabase: () => mocks.client,
  requireAuth: async () => mocks.authenticated ? { ok: true, userId: mocks.userId } : { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) },
}));
vi.mock("@/lib/mainnet-signing-budget", () => ({ reserveMainnetSignature: mocks.reserve, MainnetSigningBudgetUnavailableError: class extends Error {} }));
import { POST } from "@/app/api/transactions/submit/route";
import { GET, DELETE } from "@/app/api/payments/submission/route";
import { beginPaymentSubmission, finishPaymentSubmission, readPaymentSubmission } from "@/lib/payments/submission-journal";

type Row = { resource_id: string; lease_token: string; expires_at: number };
let rows: Map<string, Row>;
let failInsert = false;
let calls: { method: string; url: URL; body: unknown }[];
function connect() {
  mocks.client = createClient("https://recovery.test.supabase.co", "test-service-key", {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/rest/v1/tiered_reward_run_leases");
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url, body });
      const matches = [...rows.values()].filter(row => [...url.searchParams.entries()].every(([key, value]) =>
        key === "select" || value === `eq.${row[key as keyof Row]}`));
      const respond = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
      if (method === "POST") {
        if (failInsert) return respond({ code: "XX000", message: "storage unavailable" }, 400);
        if (rows.has(body.resource_id)) return respond({ code: "23505", message: "duplicate resource_id" }, 409);
        rows.set(body.resource_id, body); return new Response(null, { status: 201 });
      }
      if (method === "PATCH") {
        for (const row of matches) rows.set(row.resource_id, { ...row, ...body });
        return respond(matches.map(row => ({ resource_id: row.resource_id })));
      }
      if (method === "DELETE") {
        for (const row of matches) rows.delete(row.resource_id);
        return new Response(null, { status: 204 });
      }
      expect(method).toBe("GET");
      return respond(matches.map(row => ({ lease_token: row.lease_token })));
    } },
  });
}
const sender = Keypair.random();
const destination = Keypair.random().publicKey();
function payment(sequence = "1") {
  const tx = new TransactionBuilder(new Account(sender.publicKey(), sequence), { fee: "100", networkPassphrase: Networks.PUBLIC })
    .addOperation(Operation.payment({ destination, asset: Asset.native(), amount: "5" })).setTimeout(30).build();
  tx.sign(sender); return tx;
}
const submitRequest = (tx = payment()) => new NextRequest("http://localhost/api/transactions/submit", { method: "POST", body: JSON.stringify({ xdr: tx.toXDR(), trackPayment: true }) });
const getRequest = () => new NextRequest("http://localhost/api/payments/submission");
const deleteRequest = (hash: string) => new NextRequest("http://localhost/api/payments/submission", { method: "DELETE", body: JSON.stringify({ hash }) });
beforeEach(() => {
  rows = new Map(); calls = []; failInsert = false; mocks.userId = "owner"; mocks.authenticated = true;
  connect(); mocks.reserve.mockReset().mockResolvedValue([]);
  vi.spyOn(rpc.Server.prototype, "getLatestLedger").mockResolvedValue({ sequence: 100 } as never);
  vi.spyOn(rpc.Server.prototype, "getTransaction").mockRejectedValue(new Error("RPC unavailable"));
  vi.spyOn(Horizon.Server.prototype, "transactions").mockReturnValue({ transaction: () => ({ call: async () => { throw new Error("not indexed"); } }) } as never);
  vi.spyOn(Horizon.Server.prototype, "submitTransaction").mockImplementation(async tx => ({ hash: tx.hash().toString("hex"), successful: true }) as never);
});
afterEach(() => vi.restoreAllMocks());

it("scopes cloud GET and DELETE to the authenticated owner, including a copied foreign hash", async () => {
  const tx = payment(); const hash = tx.hash().toString("hex");
  expect((await POST(submitRequest(tx))).status).toBe(200);
  mocks.userId = "other";
  expect(await (await GET(getRequest())).json()).toBeNull();
  expect((await DELETE(deleteRequest(hash))).status).toBe(200);
  expect(rows.has("payment-guard:owner")).toBe(true);
  expect(calls.at(-1)!.url.searchParams.get("resource_id")).toBe("eq.payment-guard:other");
  mocks.userId = "owner";
  expect(await (await GET(getRequest())).json()).toMatchObject({ status: "success", hash });
  expect((await DELETE(deleteRequest(hash))).status).toBe(200);
  expect(rows.size).toBe(0);
  const deletion = calls.find(call => call.method === "DELETE")!;
  expect(deletion.url.searchParams.get("resource_id")).toBe("eq.payment-guard:owner");
  expect(deletion.url.searchParams.get("lease_token")).toContain(`"hash":"${hash}"`);
});

it("rejects unauthenticated recovery before any cloud request", async () => {
  mocks.authenticated = false;
  expect((await GET(getRequest())).status).toBe(401);
  expect((await DELETE(deleteRequest("a".repeat(64)))).status).toBe(401);
  expect(calls).toHaveLength(0);
});

it("does not broadcast when cloud insertion cannot protect the envelope", async () => {
  failInsert = true;
  const response = await POST(submitRequest());
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: "Could not protect payment before submission" });
  expect(Horizon.Server.prototype.submitTransaction).not.toHaveBeenCalled();
  expect(rows.size).toBe(0); expect(calls.some(call => call.method === "POST")).toBe(true);
});

it("returns a completed cloud outcome on identical retry without broadcasting again", async () => {
  const tx = payment();
  const first = await POST(submitRequest(tx)); expect(first.status).toBe(200);
  const outcome = await first.json();
  const retry = await POST(submitRequest(tx)); expect(retry.status).toBe(200);
  expect(await retry.json()).toEqual(outcome);
  expect(Horizon.Server.prototype.submitTransaction).toHaveBeenCalledOnce();
  expect(JSON.parse(rows.get("payment-guard:owner")!.lease_token)).toMatchObject({ status: "success", response: { status: 200, body: outcome } });
});

it("retains a pending cloud journal after client and journal-module reinitialization", async () => {
  const tx = payment(); const hash = tx.hash().toString("hex");
  vi.mocked(Horizon.Server.prototype.submitTransaction).mockRejectedValue(new Error("response lost"));
  const response = await POST(submitRequest(tx)); expect(response.status).toBe(502);
  expect(await response.json()).toMatchObject({ hash, unresolved: true });
  connect(); vi.resetModules();
  const reloaded = await import("@/lib/payments/submission-journal");
  expect(await reloaded.readPaymentSubmission("owner")).toMatchObject({ hash, xdr: tx.toXDR(), status: "pending", startLedger: 100 });
  expect((await DELETE(deleteRequest(hash))).status).toBe(409);
  expect(rows.has("payment-guard:owner")).toBe(true);
  expect((await POST(submitRequest(payment("2")))).status).toBe(409);
  expect(Horizon.Server.prototype.submitTransaction).toHaveBeenCalledOnce();
});

it("lets only one simultaneous different envelope claim the cloud journal and broadcast", async () => {
  let ledgerReads = 0; let releaseLedger!: () => void;
  const ledgerBarrier = new Promise<void>(resolve => { releaseLedger = resolve; });
  vi.mocked(rpc.Server.prototype.getLatestLedger).mockImplementation(async () => {
    if (++ledgerReads === 2) releaseLedger(); await ledgerBarrier; return { sequence: 100 } as never;
  });
  const responses = await Promise.all([POST(submitRequest(payment("1"))), POST(submitRequest(payment("2")))]);
  expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
  expect(calls.filter(call => call.method === "POST")).toHaveLength(2);
  expect(Horizon.Server.prototype.submitTransaction).toHaveBeenCalledOnce();
  expect(rows.size).toBe(1);
});

it("uses cloud CAS so a delayed old outcome cannot overwrite a newly acknowledged payment", async () => {
  const old = await beginPaymentSubmission("owner", payment("1"));
  await finishPaymentSubmission("owner", old, "success", { status: 200, body: { hash: old.hash, successful: true } });
  expect((await DELETE(deleteRequest(old.hash))).status).toBe(200);
  const next = await beginPaymentSubmission("owner", payment("2"));
  await expect(finishPaymentSubmission("owner", old, "failed", { status: 400, body: { error: "late stale outcome" } })).rejects.toThrow("changed");
  expect(await readPaymentSubmission("owner")).toEqual(next);
  const patch = calls.filter(call => call.method === "PATCH").at(-1)!;
  expect(patch.url.searchParams.get("resource_id")).toBe("eq.payment-guard:owner");
  expect(patch.url.searchParams.get("lease_token")).toBe(`eq.${JSON.stringify(old)}`);
});
