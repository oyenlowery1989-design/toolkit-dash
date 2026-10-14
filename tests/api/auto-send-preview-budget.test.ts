import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ preview: vi.fn(), reserved: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({
  requireAuth: async () => ({ ok: true, userId: "owner" }),
  isSupabaseOnly: () => false,
  getSupabase: () => null,
}));
vi.mock("@/lib/db", () => ({ getDb: () => ({ prepare: () => ({
  get: () => ({ id: "group-1", name: "Scheduled", network: "public", secret_key: "saved", enabled: 1, batch_send: 0, created_at: 1 }),
  all: () => [],
}) }) }));
vi.mock("@/lib/auto-send/runner", () => ({
  AutoSendApprovalChangedError: class extends Error {}, AutoSendRunInProgressError: class extends Error {}, runGroup: vi.fn(), previewGroup: mocks.preview,
}));
vi.mock("@/lib/auto-send/scheduler", () => ({ refreshScheduler: vi.fn() }));
vi.mock("@/lib/mainnet-signing-budget", () => ({
  getReservedMainnetXlm: mocks.reserved,
  MainnetSigningBudgetUnavailableError: class MainnetSigningBudgetUnavailableError extends Error {},
}));
import { MainnetSigningBudgetUnavailableError } from "@/lib/mainnet-signing-budget";
import { POST } from "@/app/api/auto-send/run/route";

const request = () => new NextRequest("http://localhost/api/auto-send/run", {
  method: "POST", body: JSON.stringify({ groupId: "group-1", dryRun: true }),
});
beforeEach(() => {
  vi.stubEnv("MAINNET_TRANSACTIONS_ENABLED", "true");
  vi.stubEnv("MAINNET_MAX_XLM_PER_DAY", "3");
  mocks.preview.mockResolvedValue({
    groupId: "group-1", walletAddress: "GTEST", xlmBalance: 10, spendable: 5, batchSend: false, estimatedFees: 0,
    items: [{ destination: "GDEST", amountXlm: 2, wouldSkip: false }],
  });
  mocks.reserved.mockResolvedValue(2);
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });

it("shows the shared reservation in the Auto-Send preview", async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(mocks.reserved).toHaveBeenCalledOnce();
  expect((await response.json()).safetyWarnings).toContain("Daily XLM limit of 3 would be exceeded");
});

it("fails preview closed when the shared reservation cannot be read", async () => {
  mocks.reserved.mockRejectedValueOnce(new MainnetSigningBudgetUnavailableError("Budget unavailable"));
  expect((await POST(request())).status).toBe(503);
});
