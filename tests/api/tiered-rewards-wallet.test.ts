import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "stellar-sdk";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ load: vi.fn(), mutations: [] as Record<string, unknown>[], rows: [] as Record<string, unknown>[] }));
vi.mock("@/lib/supabase-server", () => ({
  requireAuth: async () => ({ ok: true, userId: "owner" }), isSupabaseOnly: () => true,
  checkSupabaseRowOwnership: async () => ({ ok: true }),
  getSupabase: () => ({ from: (table: string) => {
    const query = { select() { return this; }, eq() { return this; }, order() { return this; },
      insert(data: Record<string, unknown>) { mocks.mutations.push(data); return this; },
      update(data: Record<string, unknown>) { mocks.mutations.push(data); return this; },
      then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: table === "tiered_reward_configs" ? mocks.rows : [], error: null }).then(resolve); },
    }; return query;
  } }),
}));
vi.mock("@/lib/saved-wallet-server", () => ({ loadSavedWalletSigner: mocks.load }));
vi.mock("@/lib/tiered-rewards/scheduler", () => ({ refreshTieredRewardsScheduler: vi.fn() }));
import { GET, POST } from "@/app/api/db/tiered-rewards/route";
import { rewardSigningFields } from "@/lib/tiered-rewards/signing";
const signer = Keypair.random();
function request(action: string, data: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/db/tiered-rewards", { method: "POST", body: JSON.stringify({ type: "config", action, data: { id: "config", ...data } }) });
}
beforeEach(() => { vi.stubEnv("SIGNING_KEY_ENCRYPTION_KEY", "01".repeat(32)); vi.stubEnv("VERCEL", ""); mocks.mutations.length = 0; mocks.rows.length = 0; mocks.load.mockResolvedValue(signer); mocks.load.mockClear(); });
afterEach(() => vi.unstubAllEnvs());
describe("Tiered Rewards wallet CRUD", () => {
  it("creates a wallet reference without browser key input and redacts GET", async () => {
    expect((await POST(request("create", { walletId: "saved", secretKey: null, name: "Rewards", assetCode: "wUSDC", assetIssuer: signer.publicKey() }))).status).toBe(200);
    const stored = mocks.mutations[0].secret_key;
    expect(rewardSigningFields(stored)).toMatchObject({ walletId: "saved", secretKey: null });
    expect(mocks.load).toHaveBeenCalledWith("saved", "owner");
    mocks.rows.push({ id: "config", secret_key: stored });
    const response = await GET(new NextRequest("http://localhost/api/db/tiered-rewards"));
    const body = await response.json();
    expect(body[0]).toMatchObject({ walletId: "saved", secretKey: null, hasKey: true });
    expect(JSON.stringify(body)).not.toContain(signer.secret());
  });
  it("preserves unrelated edits and supports explicit replacement and clearing", async () => {
    expect((await POST(request("update", { name: "New name" }))).status).toBe(200);
    expect(mocks.mutations.at(-1)).not.toHaveProperty("secret_key");
    expect((await POST(request("update", { walletId: "replacement", secretKey: null }))).status).toBe(200);
    expect(rewardSigningFields(mocks.mutations.at(-1)!.secret_key).walletId).toBe("replacement");
    expect((await POST(request("update", { walletId: null, secretKey: null }))).status).toBe(200);
    expect(mocks.mutations.at(-1)).toHaveProperty("secret_key", "");
  });
  it("rejects missing and watch-only wallets without mutating the config", async () => {
    mocks.load.mockResolvedValue(null);
    expect((await POST(request("update", { walletId: "missing" }))).status).toBe(400);
    mocks.load.mockRejectedValue(new Error("This wallet is watch-only"));
    expect((await POST(request("create", { walletId: "watch" }))).status).toBe(400);
    expect(mocks.mutations).toHaveLength(0);
  });
});
