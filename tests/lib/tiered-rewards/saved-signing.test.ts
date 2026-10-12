import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "stellar-sdk";
const mocks = vi.hoisted(() => ({ load: vi.fn(), lease: vi.fn(), release: vi.fn() }));
vi.mock("@/lib/saved-wallet-server", () => ({ loadSavedWalletSigner: mocks.load }));
vi.mock("@/lib/run-lease", () => ({ acquireRunLease: mocks.lease, releaseRunLease: mocks.release }));
import { rewardSigningFields, rewardSigningUpdate, resolveRewardSigningConfig } from "@/lib/tiered-rewards/signing";
import { encryptImportedStoredSecret, encryptStoredSecret } from "@/lib/secret-storage";
import { runConfig } from "@/lib/tiered-rewards/runner";
import { calculatePreview } from "@/lib/tiered-rewards/calculator";
import { loadAllConfigs, loadConfig } from "@/lib/tiered-rewards/db";
import type { TieredRewardConfig } from "@/lib/tiered-rewards/types";
const signer = Keypair.random();
const config: TieredRewardConfig = { id: "config", name: "Reward", assetCode: "wUSDC", assetIssuer: signer.publicKey(), network: "public", walletId: "saved", secretKey: null, intervalMinutes: 15, enabled: true, minReserve: 10, minSenderThreshold: 0, previewOnly: false, batchSend: true, memo: null, feeMultiplier: 1, excludeAddresses: [], createdAt: 1, tiers: [] };
beforeEach(() => {
  vi.stubEnv("SIGNING_KEY_ENCRYPTION_KEY", "01".repeat(32));
  mocks.load.mockResolvedValue(signer);
  mocks.lease.mockResolvedValue("lease");
  mocks.release.mockResolvedValue(undefined);
  mocks.load.mockClear(); mocks.release.mockClear();
});
afterEach(() => vi.unstubAllEnvs());
describe("Tiered Rewards saved wallet storage", () => {
  it("stores a reference and never exposes wallet or legacy keys in client fields", async () => {
    const stored = await rewardSigningUpdate({ walletId: "saved", secretKey: null }, "owner");
    expect(mocks.load).toHaveBeenCalledWith("saved", "owner");
    expect(stored).not.toContain(signer.secret());
    expect(rewardSigningFields(stored)).toEqual({ walletId: "saved", secretKey: null, hasKey: true });
    expect(rewardSigningFields(encryptImportedStoredSecret(stored))).toEqual({ walletId: "saved", secretKey: null, hasKey: true });
    const legacy = encryptStoredSecret(signer.secret());
    expect(rewardSigningFields(legacy).secretKey).toBeNull();
    expect(rewardSigningFields(legacy, true).secretKey).toBe(signer.secret());
    expect(rewardSigningFields(stored, true).secretKey).toBeNull();
  });
  it("maps references through SQLite GET and server-only loaders", async () => {
    const stored = await rewardSigningUpdate({ walletId: "saved" }, "owner");
    const row = { id: "config", secret_key: stored, exclude_addresses: "[]" };
    const db = { prepare: (sql: string) => ({ all: () => sql.includes("tiered_reward_configs") ? [row] : [], get: () => row }) };
    expect(loadAllConfigs(db)[0]).toMatchObject({ walletId: "saved", secretKey: null, hasKey: true });
    expect(loadConfig(db, "config")).toMatchObject({ walletId: "saved", secretKey: null });
  });
  it("preserves absent/empty updates, clears explicitly and supports replacing a wallet with a manual key", async () => {
    expect(await rewardSigningUpdate({ name: "new" }, "owner")).toBeUndefined();
    expect(await rewardSigningUpdate({ secretKey: "" }, "owner")).toBeUndefined();
    expect(await rewardSigningUpdate({ walletId: null, secretKey: null }, "owner")).toBe("");
    const manual = await rewardSigningUpdate({ walletId: null, secretKey: signer.secret() }, "owner");
    expect(rewardSigningFields(manual, true)).toMatchObject({ walletId: undefined, secretKey: signer.secret() });
    await expect(rewardSigningUpdate({ walletId: "saved", secretKey: signer.secret() }, "owner")).rejects.toThrow("either");
    await expect(rewardSigningUpdate({ secretKey: "MASKED" }, "owner")).rejects.toThrow();
  });
  it("rejects missing/cross-owner and watch-only wallets before saving", async () => {
    mocks.load.mockResolvedValue(null);
    await expect(rewardSigningUpdate({ walletId: "another-owner" }, "owner")).rejects.toThrow("not found");
    expect(mocks.load).toHaveBeenCalledWith("another-owner", "owner");
    mocks.load.mockRejectedValue(new Error("This wallet is watch-only; no signing key is saved"));
    await expect(rewardSigningUpdate({ walletId: "watch" }, "owner")).rejects.toThrow("watch-only");
  });
  it("resolves the current wallet at execution time; deletion and watch-only replacement fail closed", async () => {
    expect((await resolveRewardSigningConfig(config, "owner")).secretKey).toBe(signer.secret());
    mocks.load.mockResolvedValue(null);
    expect(await calculatePreview(config, undefined, "owner")).toMatchObject({ error: expect.stringContaining("not found") });
    expect(await runConfig(config, [], "owner")).toMatchObject({ error: expect.stringContaining("not found") });
    expect(mocks.release).toHaveBeenCalledWith("tiered_reward_run_leases", "config", "lease");
    mocks.load.mockRejectedValue(new Error("watch-only"));
    expect(await runConfig(config, [], "owner")).toEqual({ error: "watch-only" });
  });
  it("rejects a replacement sender after preview and preserves mainnet disable policy", async () => {
    expect(await runConfig(config, [], "owner", Keypair.random().publicKey())).toMatchObject({ error: expect.stringContaining("changed since preview") });
    vi.stubEnv("MAINNET_TRANSACTIONS_ENABLED", "false");
    expect(await runConfig(config, [], "owner", signer.publicKey())).toMatchObject({ error: expect.stringContaining("disabled") });
  });
});
