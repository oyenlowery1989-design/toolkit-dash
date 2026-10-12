import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getUser = vi.hoisted(() => vi.fn());
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { getUser } }),
}));

import { requireAuth } from "@/lib/supabase-server";

const request = new NextRequest("http://localhost/api/db/wallets-v2", {
  headers: { authorization: "Bearer test-token" },
});

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("DB_PROVIDER", "sqlite");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("ALLOW_UNAUTHENTICATED_LOCAL", "false");
  vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");
  vi.stubEnv("SUPABASE_SYNC_USER_ID", "owner");
  getUser.mockReset().mockResolvedValue({ data: { user: { id: "owner" } }, error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("authenticated SQLite owner", () => {
  it("allows only the configured owner of the shared SQLite database", async () => {
    expect(await requireAuth(request)).toEqual({ ok: true, userId: "owner" });
    getUser.mockResolvedValueOnce({ data: { user: { id: "other" } }, error: null });
    const denied = await requireAuth(request);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.response.status).toBe(403);
  });

  it("fails closed when no SQLite owner is configured", async () => {
    vi.stubEnv("SUPABASE_SYNC_USER_ID", "");
    const denied = await requireAuth(request);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.response.status).toBe(503);
  });
});
