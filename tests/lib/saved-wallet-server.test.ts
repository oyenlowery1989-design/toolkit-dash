import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "stellar-sdk";

const mocks = vi.hoisted(() => ({ single: vi.fn(), get: vi.fn(), eq: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({
  isSupabaseOnly: () => true,
  getSupabase: () => ({ from: () => ({ select: () => ({ eq: mocks.eq }) }) }),
}));
vi.mock("@/lib/db", () => ({ getDb: () => ({ prepare: () => ({ get: mocks.get }) }) }));
vi.mock("@/lib/secret-storage", () => ({ decryptStoredSecret: (key: string) => key }));
import { loadSavedWalletSigner } from "@/lib/saved-wallet-server";

const signer = Keypair.random();
beforeEach(() => {
  mocks.eq.mockReset();
  mocks.single.mockReset();
  mocks.eq.mockReturnValueOnce({ eq: mocks.eq }).mockReturnValueOnce({ single: mocks.single });
  mocks.single.mockResolvedValue({ data: { public_key: signer.publicKey(), secret_key: signer.secret() }, error: null });
});

describe("saved wallet signer resolution", () => {
  it("loads only the selected wallet belonging to the authenticated user", async () => {
    expect((await loadSavedWalletSigner("wallet", "owner"))?.publicKey()).toBe(signer.publicKey());
    expect(mocks.eq).toHaveBeenNthCalledWith(1, "id", "wallet");
    expect(mocks.eq).toHaveBeenNthCalledWith(2, "user_id", "owner");
  });

  it("rejects watch-only and mismatched stored secrets", async () => {
    mocks.single.mockResolvedValueOnce({ data: { public_key: signer.publicKey(), secret_key: "" }, error: null });
    await expect(loadSavedWalletSigner("watch", "owner")).rejects.toThrow("watch-only");
    mocks.eq.mockReset().mockReturnValueOnce({ eq: mocks.eq }).mockReturnValueOnce({ single: mocks.single });
    mocks.single.mockResolvedValueOnce({ data: { public_key: Keypair.random().publicKey(), secret_key: signer.secret() }, error: null });
    await expect(loadSavedWalletSigner("mismatch", "owner")).rejects.toThrow("does not match");
  });
});
