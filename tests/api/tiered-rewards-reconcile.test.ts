import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { Networks } from "stellar-sdk";

const mocks = vi.hoisted(() => ({
  userId: "owner", owner: true, network: "public", updateSucceeds: true, inspected: null as null | { raw: string; ready: boolean; transactions: { hash: string; successful: boolean | null }[] },
  inspect: vi.fn(), release: vi.fn(), updates: [] as Record<string, unknown>[],
}));
vi.mock("@/lib/supabase-server", () => ({
  requireAuth: async () => mocks.userId ? { ok: true, userId: mocks.userId } : { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) },
  isSupabaseOnly: () => true,
  getSupabase: () => ({ from: () => {
    let updating = false;
    const filters: Record<string, unknown> = {};
    const q = {
      select: () => q,
      eq: (key: string, value: unknown) => { filters[key] = value; return q; },
      maybeSingle: async () => ({ data: mocks.owner && filters.user_id === "owner" ? { id: filters.id, network: mocks.network } : null, error: null }),
      update: (data: Record<string, unknown>) => { updating = true; mocks.updates.push(data); return q; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: updating && mocks.owner && mocks.updateSucceeds && filters.user_id === "owner" ? [{ id: filters.id }] : [], error: null }).then(resolve),
    };
    return q;
  } }),
}));
vi.mock("@/lib/tiered-rewards/run-guard", () => ({
  inspectRewardRun: (...args: unknown[]) => mocks.inspect(...args),
  releaseRewardRun: (...args: unknown[]) => mocks.release(...args),
}));
import { GET, POST } from "@/app/api/tiered-rewards/reconcile/route";

const url = "http://localhost/api/tiered-rewards/reconcile";
const confirmation = "I reviewed the ledger and understand a future run can pay these recipients again";
function post(confirm = confirmation) {
  return new NextRequest(url, { method: "POST", body: JSON.stringify({ configId: "config", confirmation: confirm }) });
}
beforeEach(() => {
  mocks.userId = "owner"; mocks.owner = true; mocks.network = "public"; mocks.updateSucceeds = true; mocks.updates.length = 0;
  mocks.inspected = { raw: "journal", ready: true, transactions: [{ hash: "a".repeat(64), successful: true }] };
  mocks.inspect.mockReset().mockImplementation(async () => mocks.inspected);
  mocks.release.mockReset().mockResolvedValue(undefined);
});

it("does not inspect another user's config or bypass authentication", async () => {
  mocks.userId = "";
  expect((await GET(new NextRequest(`${url}?configId=config`))).status).toBe(401);
  mocks.userId = "owner"; mocks.owner = false;
  expect((await POST(post())).status).toBe(404);
  expect(mocks.inspect).not.toHaveBeenCalled();
});

it("keeps guard and schedule intact without confirmation or terminal ledger evidence", async () => {
  expect((await POST(post(""))).status).toBe(400);
  mocks.inspected!.ready = false;
  mocks.inspected!.transactions[0].successful = null;
  expect((await POST(post())).status).toBe(409);
  expect(mocks.updates).toHaveLength(0);
  expect(mocks.release).not.toHaveBeenCalled();
});

it("pauses the schedule before compare-and-swap release", async () => {
  const response = await POST(post());
  expect(response.status).toBe(200);
  expect(mocks.updates[0]).toMatchObject({ enabled: false });
  expect(mocks.release).toHaveBeenCalledWith("config", "journal");
  expect(await response.json()).toMatchObject({ blocked: false, paused: true });
});

it("keeps the guard when pausing the schedule fails", async () => {
  mocks.updateSucceeds = false;
  expect((await POST(post())).status).toBe(409);
  expect(mocks.release).not.toHaveBeenCalled();
});

it("allows explicit reconciliation of a claim with no prepared transactions", async () => {
  mocks.inspected!.transactions = [];
  expect((await POST(post())).status).toBe(200);
  expect(mocks.release).toHaveBeenCalledWith("config", "journal");
});

it("checks testnet journals against testnet Horizon and passphrase", async () => {
  mocks.network = "testnet";
  expect((await GET(new NextRequest(`${url}?configId=config`))).status).toBe(200);
  expect(mocks.inspect.mock.calls[0][2]).toBe(Networks.TESTNET);
  expect(mocks.inspect.mock.calls[0][1].serverURL.toString()).toContain("horizon-testnet.stellar.org");
});
