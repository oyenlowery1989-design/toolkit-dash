import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({
  isSupabaseOnly: () => true,
  getSupabase: () => ({
    from: (table: string) => ({
      select: () => ({ eq: () => ({
        not: () => ({ order: mocks.read }),
        order: () => table === "tiered_reward_tiers" ? Promise.resolve({ data: [], error: null }) : mocks.read(),
      }) }),
    }),
  }),
}));

import { refreshTieredRewardsScheduler, startTieredRewardsScheduler } from "@/lib/tiered-rewards/scheduler";

const config = {
  id: "c1", name: "Scheduled", enabled: true, interval_minutes: 60,
  asset_code: "XLM", asset_issuer: "", secret_key: "", created_at: 1,
};

beforeEach(() => {
  delete process.env.VERCEL;
  global._tieredRewardsStarted = false;
  global._tieredRewardsTasks = undefined;
  mocks.read.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  for (const task of global._tieredRewardsTasks?.values() ?? []) task.stop();
  global._tieredRewardsTasks?.clear();
  global._tieredRewardsStarted = false;
  vi.restoreAllMocks();
});

describe("Tiered Rewards scheduler refresh", () => {
  it("keeps an existing schedule when a later database read fails", async () => {
    mocks.read.mockResolvedValueOnce({ data: [config], error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "offline" } });
    startTieredRewardsScheduler();
    await vi.waitFor(() => expect(global._tieredRewardsTasks?.has("c1")).toBe(true));
    const task = global._tieredRewardsTasks!.get("c1");
    refreshTieredRewardsScheduler();
    await vi.waitFor(() => expect(console.error).toHaveBeenCalled());
    expect(global._tieredRewardsTasks!.get("c1")).toBe(task);
  });
});
