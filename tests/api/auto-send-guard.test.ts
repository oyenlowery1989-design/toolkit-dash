import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  guard: vi.fn(), clear: vi.fn(), lease: null as { expires_at: number } | null,
}));
vi.mock("@/lib/supabase-server", () => ({
  requireAuth: async () => ({ ok: true, userId: "owner" }),
  isSupabaseOnly: () => false,
  getSupabase: () => null,
}));
vi.mock("@/lib/db", () => ({ getDb: () => ({ prepare: (sql: string) => ({
  get: () => sql.includes("auto_send_run_leases") ? mocks.lease : {
    id: "group-1", name: "Scheduled", network: "public", secret_key: "", enabled: 1, batch_send: 0, created_at: 1,
  },
  all: () => [],
}) }) }));
vi.mock("@/lib/auto-send/runner", () => ({
  AutoSendRunInProgressError: class extends Error {}, runGroup: vi.fn(), previewGroup: vi.fn(),
}));
vi.mock("@/lib/auto-send/scheduler", () => ({ refreshScheduler: vi.fn() }));
vi.mock("@/lib/auto-send/run-guard", () => ({
  AutoSendReconciliationRequiredError: class extends Error {},
  readAutoSendRunGuard: mocks.guard,
  deleteAutoSendRunGuard: mocks.clear,
}));

import { POST } from "@/app/api/auto-send/run/route";

function resolveRequest(confirmation = "I checked every transaction hash and the wallet balance") {
  return new NextRequest("http://localhost/api/auto-send/run", { method: "POST", body: JSON.stringify({
    action: "resolve-guard", groupId: "group-1", confirmation,
  }) });
}

beforeEach(() => {
  mocks.guard.mockReset().mockResolvedValue({ startedAt: 1, walletAddress: "GABC", state: "blocked", transactions: [] });
  mocks.clear.mockReset().mockResolvedValue(undefined);
  mocks.lease = null;
});
afterEach(() => vi.restoreAllMocks());

describe("Auto-Send reconciliation", () => {
  it("requires explicit ledger confirmation and refuses to clear an active run", async () => {
    expect((await POST(resolveRequest(""))).status).toBe(400);
    mocks.lease = { expires_at: Date.now() + 60_000 };
    expect((await POST(resolveRequest())).status).toBe(409);
    expect(mocks.clear).not.toHaveBeenCalled();
  });

  it("clears a blocked run after the lease ended", async () => {
    expect((await POST(resolveRequest())).status).toBe(200);
    expect(mocks.clear).toHaveBeenCalledWith("group-1", expect.objectContaining({ state: "blocked" }));
  });

  it("keeps an interrupted run blocked for 24 hours", async () => {
    mocks.guard.mockResolvedValue({ startedAt: Date.now(), walletAddress: "GABC", state: "running", transactions: [] });
    expect((await POST(resolveRequest())).status).toBe(409);
    expect(mocks.clear).not.toHaveBeenCalled();
  });
});
