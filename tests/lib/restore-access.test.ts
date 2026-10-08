import { NextRequest, NextResponse } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ authorized: true, db: vi.fn(), supabase: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: state.db }));
vi.mock("@/lib/supabase-server", () => ({
  requireAuth: async () => state.authorized
    ? { ok: true, userId: "tenant" }
    : { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) },
  isSupabaseOnly: () => true,
  isSupabaseConfigured: () => true,
  getSupabase: state.supabase,
}));
import { POST } from "@/app/api/db/restore/route";

beforeEach(() => { state.authorized = true; state.db.mockClear(); state.supabase.mockClear(); });
it.each(["local", "supabase"])("prevents shared tenants from accessing SQLite recovery (%s)", async (source) => {
  const response = await POST(new NextRequest("https://example.com/api/db/restore", {
    method: "POST", body: JSON.stringify({ source }),
  }));
  expect(response.status).toBe(403);
  expect(state.db).not.toHaveBeenCalled();
  expect(state.supabase).not.toHaveBeenCalled();
});
it("requires authentication before reporting recovery availability", async () => {
  state.authorized = false;
  expect((await POST(new NextRequest("https://example.com/api/db/restore", { method: "POST" }))).status).toBe(401);
});
