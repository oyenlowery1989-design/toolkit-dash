import { expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/secret-storage", () => ({ decryptStoredSecret: vi.fn(), encryptStoredSecret: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({
  requireAuth: vi.fn(async () => ({ ok: true, userId: "user" })),
  isSupabaseOnly: vi.fn(() => true),
  getSupabase: vi.fn(() => ({ from: () => ({
    select: () => ({ eq: () => ({ order: async () => ({ data: null, error: { message: "down" } }) }) }),
  }) })),
  checkSupabaseRowOwnership: vi.fn(),
  syncToSupabase: vi.fn(),
}));

import { GET as getWallets } from "@/app/api/db/wallets-v2/route";
import { GET as getFolders } from "@/app/api/db/wallet-folders/route";

it.each([getWallets, getFolders])("returns an error when Supabase cannot load wallet data", async (get) => {
  const response = await get(new NextRequest("http://localhost/api/db/wallets-v2"));
  expect(response.status).toBe(502);
  expect(await response.json()).toHaveProperty("error");
});
