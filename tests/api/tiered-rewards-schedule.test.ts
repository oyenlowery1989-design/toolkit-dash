import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase-server", () => ({
  requireAuth: async () => ({ ok: true, userId: "owner" }),
  isSupabaseOnly: () => true,
}));
vi.mock("@/lib/tiered-rewards/scheduler", () => ({ refreshTieredRewardsScheduler: vi.fn() }));

import { POST } from "@/app/api/db/tiered-rewards/route";

afterEach(() => vi.unstubAllEnvs());

describe("Tiered Rewards scheduling", () => {
  it("rejects activation on Vercel before writing data", async () => {
    vi.stubEnv("VERCEL", "1");
    const request = new NextRequest("http://localhost/api/db/tiered-rewards", {
      method: "POST",
      body: JSON.stringify({ type: "config", action: "update", data: { id: "config-1", enabled: true } }),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/unavailable/);
  });
});
