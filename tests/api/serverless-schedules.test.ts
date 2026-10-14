import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("@/lib/supabase-server", () => ({
  requireAuth: async () => ({ ok: true, userId: "owner" }),
  isSupabaseOnly: () => true,
  getSupabase: () => { throw new Error("Schedule rejection must happen before any write"); },
}));
vi.mock("@/lib/tiered-rewards/scheduler", () => ({ refreshTieredRewardsScheduler: vi.fn() }));
afterEach(() => vi.unstubAllEnvs());
function req(body: unknown) { return new NextRequest("http://localhost/api/db/test", { method: "POST", body: JSON.stringify(body) }); }
it("rejects creation and editing of scheduled auto-sends on Vercel", async () => {
  vi.stubEnv("VERCEL", "1");
  const { POST, PATCH } = await import("@/app/api/db/auto-send-groups/route");
  for (const route of [POST, PATCH]) {
    const result = await route(req({ type: "group", id: "group", name: "Group", intervalMinutes: 60 }));
    expect(result.status).toBe(400);
    expect((await result.json()).error).toMatch(/unavailable/);
  }
});
it("rejects stored tiered intervals on Vercel and unsupported local intervals", async () => {
  const { POST } = await import("@/app/api/db/tiered-rewards/route");
  vi.stubEnv("VERCEL", "1");
  expect((await POST(req({ type: "config", action: "update", data: { id: "config", intervalMinutes: 60 } }))).status).toBe(400);
  vi.stubEnv("VERCEL", "");
  const invalid = await POST(req({ type: "config", action: "update", data: { id: "config", intervalMinutes: 90 } }));
  expect(invalid.status).toBe(400);
  expect((await invalid.json()).error).toBe("Unsupported schedule interval");
});
