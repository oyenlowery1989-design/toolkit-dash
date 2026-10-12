import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "stellar-sdk";
import { NextRequest } from "next/server";
import { validateMainnetRun } from "@/lib/mainnet-safety";
import { MainnetSigningBudgetUnavailableError } from "@/lib/mainnet-signing-budget";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), loadSigner: vi.fn(), check: vi.fn(), deploy: vi.fn(), reserve: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ requireAuth: mocks.auth }));
vi.mock("@/lib/saved-wallet-server", () => ({ loadSavedWalletSigner: mocks.loadSigner }));
vi.mock("@/lib/mainnet-signing-budget", () => ({
  reserveMainnetSignature: mocks.reserve,
  MainnetSigningBudgetUnavailableError: class MainnetSigningBudgetUnavailableError extends Error {},
}));
vi.mock("@/lib/soroban/sac", () => ({
  computeSacAddress: () => "contract-id",
  checkSacDeployed: mocks.check,
  deploySac: mocks.deploy,
}));
import { POST } from "@/app/api/soroban/deploy/route";

const signer = Keypair.random();
function request(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/soroban/deploy", { method: "POST", body: JSON.stringify(body) });
}

beforeEach(() => {
  mocks.auth.mockResolvedValue({ ok: true, userId: "owner" });
  mocks.loadSigner.mockResolvedValue(signer);
  mocks.check.mockResolvedValue(false);
  mocks.deploy.mockResolvedValue({ contractId: "contract-id", txHash: "tx-hash" });
  mocks.reserve.mockImplementation(async (_userId, _hash, _expiry, intent) => validateMainnetRun(intent));
  vi.stubEnv("MAINNET_TRANSACTIONS_ENABLED", "true");
  vi.stubEnv("MAINNET_EMERGENCY_STOP", "false");
  vi.stubEnv("MAINNET_ALLOWED_DESTINATIONS", "");
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });

describe("Soroban saved-wallet deployment", () => {
  it("uses the authenticated saved signer without accepting a browser secret", async () => {
    const response = await POST(request({ assetCode: "wUSDC", issuer: signer.publicKey(), walletId: "saved", network: "public" }));
    expect(response.status).toBe(200);
    expect(mocks.loadSigner).toHaveBeenCalledWith("saved", "owner");
    expect(mocks.deploy).toHaveBeenCalledWith(expect.objectContaining({ secretKey: signer.secret(), assetCode: "wUSDC" }));
    expect(JSON.stringify(await response.json())).not.toContain(signer.secret());
  });
  it("rejects watch-only and missing wallets", async () => {
    mocks.loadSigner.mockResolvedValueOnce(null);
    expect((await POST(request({ assetCode: "XLM", walletId: "missing", network: "public" }))).status).toBe(404);
    mocks.loadSigner.mockRejectedValueOnce(new Error("This wallet is watch-only; no signing key is saved"));
    expect((await POST(request({ assetCode: "XLM", walletId: "watch", network: "public" }))).status).toBe(400);
  });
  it("keeps the mainnet execution switch and forbids mixing a wallet ID with a secret", async () => {
    vi.stubEnv("MAINNET_TRANSACTIONS_ENABLED", "false");
    expect((await POST(request({ assetCode: "XLM", walletId: "saved", network: "public" }))).status).toBe(403);
    vi.stubEnv("MAINNET_TRANSACTIONS_ENABLED", "true");
    expect((await POST(request({ assetCode: "XLM", walletId: "saved", secretKey: signer.secret(), network: "public" }))).status).toBe(400);
  });
  it("checks the assembled deployment fee before submission", async () => {
    vi.stubEnv("MAINNET_MAX_XLM_PER_RUN", "0.5");
    mocks.deploy.mockImplementationOnce(async ({ validateFee }: { validateFee: (feeXlm: number, hash: string, expiry: number) => Promise<void> }) => {
      await validateFee(1, "a".repeat(64), Math.floor(Date.now() / 1000) + 60);
      return { contractId: "contract-id", txHash: "tx-hash" };
    });
    const response = await POST(request({ assetCode: "XLM", walletId: "saved", network: "public" }));
    expect(response.status).toBe(403);
    expect(mocks.reserve).toHaveBeenCalledWith("owner", "a".repeat(64), expect.any(Number),
      { destinations: [], operationCount: 1, xlmAmount: 1 });
  });
  it("allows an assembled fee below a small per-run cap", async () => {
    vi.stubEnv("MAINNET_MAX_XLM_PER_RUN", "0.05");
    mocks.deploy.mockImplementationOnce(async ({ validateFee }: { validateFee: (feeXlm: number, hash: string, expiry: number) => Promise<void> }) => {
      await validateFee(0.01, "a".repeat(64), Math.floor(Date.now() / 1000) + 60);
      return { contractId: "contract-id", txHash: "tx-hash" };
    });
    expect((await POST(request({ assetCode: "XLM", walletId: "saved", network: "public" }))).status).toBe(200);
  });
  it("stops deployment when the shared signing budget is unavailable", async () => {
    mocks.reserve.mockRejectedValueOnce(new MainnetSigningBudgetUnavailableError("Budget unavailable"));
    mocks.deploy.mockImplementationOnce(async ({ validateFee }: { validateFee: (feeXlm: number, hash: string, expiry: number) => Promise<void> }) => {
      await validateFee(0.01, "a".repeat(64), Math.floor(Date.now() / 1000) + 60);
      return { contractId: "contract-id", txHash: "tx-hash" };
    });
    expect((await POST(request({ assetCode: "XLM", walletId: "saved", network: "public" }))).status).toBe(503);
  });
});
