import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Account, Asset, Keypair, Networks, Operation, Transaction, TransactionBuilder } from "stellar-sdk";
import { NextRequest } from "next/server";
import { validateMainnetRun } from "@/lib/mainnet-safety";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn(), reserve: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ requireAuth: mocks.auth }));
vi.mock("@/lib/saved-wallet-server", () => ({ loadSavedWalletSigner: mocks.load }));
vi.mock("@/lib/mainnet-signing-budget", () => ({
  reserveMainnetSignature: mocks.reserve,
  MainnetSigningBudgetUnavailableError: class MainnetSigningBudgetUnavailableError extends Error {},
}));
import { POST } from "@/app/api/asset-manager/sign/route";
const signer = Keypair.random();
const other = Keypair.random().publicKey();
const asset = new Asset("wUSDC", signer.publicKey());
function transaction(op: ReturnType<typeof Operation.setOptions>, source = signer.publicKey()) {
  return new TransactionBuilder(new Account(source, "1"), { fee: "100", networkPassphrase: Networks.PUBLIC }).addOperation(op).setTimeout(30).build();
}
function request(tx: Transaction, immutableConfirmed = false) {
  return new NextRequest("http://localhost/api/asset-manager/sign", { method: "POST", body: JSON.stringify({ walletId: "saved", xdr: tx.toXDR(), networkPassphrase: Networks.PUBLIC, immutableConfirmed }) });
}
beforeEach(() => {
  mocks.reserve.mockClear();
  mocks.reserve.mockImplementation(async (_userId, _hash, _expiry, intent) => validateMainnetRun(intent));
  mocks.auth.mockResolvedValue({ ok: true, userId: "owner" });
  mocks.load.mockResolvedValue(signer);
  vi.stubEnv("MAINNET_TRANSACTIONS_ENABLED", "true");
  vi.stubEnv("MAINNET_EMERGENCY_STOP", "false");
  vi.stubEnv("MAINNET_ALLOWED_DESTINATIONS", "");
});
afterEach(() => vi.unstubAllEnvs());
describe("Asset Manager saved signing", () => {
  it("signs flag, holder and create/cancel offer operations with the saved key", async () => {
    const ops = [
      Operation.setOptions({ setFlags: 1 }),
      Operation.setTrustLineFlags({ trustor: other, asset, flags: { authorized: true, authorizedToMaintainLiabilities: false } }),
      Operation.setTrustLineFlags({ trustor: other, asset, flags: { authorized: false, authorizedToMaintainLiabilities: false } }),
      Operation.setTrustLineFlags({ trustor: other, asset, flags: { authorized: false, authorizedToMaintainLiabilities: true } }),
      Operation.manageSellOffer({ selling: asset, buying: Asset.native(), amount: "2", price: "0.5", offerId: "0" }),
      Operation.manageBuyOffer({ selling: Asset.native(), buying: asset, buyAmount: "2", price: "0.5", offerId: "0" }),
      Operation.manageSellOffer({ selling: asset, buying: Asset.native(), amount: "0", price: "0.5", offerId: "9007199254740993" }),
      Operation.manageBuyOffer({ selling: Asset.native(), buying: asset, buyAmount: "0", price: "0.5", offerId: "9" }),
    ];
    for (const op of ops) {
      const tx = transaction(op);
      const response = await POST(request(tx));
      expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
      const body = await response.json();
      const signed = new Transaction(body.xdr, Networks.PUBLIC);
      expect(signed.hash().equals(tx.hash())).toBe(true);
      expect(signer.verify(signed.hash(), signed.signatures[0].signature())).toBe(true);
      expect(JSON.stringify(body)).not.toContain(signer.secret());
    }
    expect(mocks.load).toHaveBeenCalledWith("saved", "owner");
  });
  it("requires confirmation for irreversible flags", async () => {
    const tx = transaction(Operation.setOptions({ setFlags: 4 }));
    expect((await POST(request(tx))).status).toBe(400);
    expect((await POST(request(tx, true))).status).toBe(200);
  });
  it("rejects wrong wallet, issuer, arbitrary settings and unrelated operations", async () => {
    const invalid = [
      transaction(Operation.setOptions({ setFlags: 1 }), other),
      transaction(Operation.setOptions({ setFlags: 1, source: other })),
      transaction(Operation.setOptions({ setFlags: 3 as never })),
      transaction(Operation.setOptions({ setFlags: 1, masterWeight: 0 })),
      transaction(Operation.payment({ destination: other, asset: Asset.native(), amount: "1" })),
      transaction(Operation.setTrustLineFlags({ trustor: other, asset: new Asset("wUSDC", other), flags: { authorized: true, authorizedToMaintainLiabilities: false } })),
      transaction(Operation.setTrustLineFlags({ trustor: other, asset, flags: { clawbackEnabled: false } })),
      transaction(Operation.manageBuyOffer({ selling: Asset.native(), buying: asset, buyAmount: "2", price: "1", offerId: "9" })),
    ];
    for (const tx of invalid) expect((await POST(request(tx))).status).toBe(400);
  });
  it("enforces buy offer XLM exposure, emergency stop and holder allowlist", async () => {
    vi.stubEnv("MAINNET_MAX_XLM_PER_RUN", "1");
    const tx = transaction(Operation.manageBuyOffer({ selling: Asset.native(), buying: asset, buyAmount: "2", price: "1", offerId: "0" }));
    expect((await POST(request(tx))).status).toBe(403);
    vi.stubEnv("MAINNET_EMERGENCY_STOP", "true");
    expect((await POST(request(transaction(Operation.setOptions({ setFlags: 1 }))))).status).toBe(403);
    vi.stubEnv("MAINNET_EMERGENCY_STOP", "false");
    vi.stubEnv("MAINNET_ALLOWED_DESTINATIONS", signer.publicKey());
    expect((await POST(request(transaction(Operation.setTrustLineFlags({ trustor: other, asset, flags: { authorized: false, authorizedToMaintainLiabilities: false } }))))).status).toBe(403);
  });
  it("fails closed for new DEX offers under a destination allowlist but permits cancellation", async () => {
    vi.stubEnv("MAINNET_ALLOWED_DESTINATIONS", signer.publicKey());
    const create = transaction(Operation.manageSellOffer({ selling: asset, buying: Asset.native(), amount: "1", price: "1", offerId: "0" }));
    const cancel = transaction(Operation.manageSellOffer({ selling: asset, buying: Asset.native(), amount: "0", price: "1", offerId: "9" }));
    expect((await POST(request(create))).status).toBe(403);
    expect((await POST(request(cancel))).status).toBe(200);
  });
  it("rejects unbounded and multi-operation transactions", async () => {
    const builder = () => new TransactionBuilder(new Account(signer.publicKey(), "1"), { fee: "100", networkPassphrase: Networks.PUBLIC });
    const unbounded = builder().addOperation(Operation.setOptions({ setFlags: 1 })).setTimeout(0).build();
    const multi = builder().addOperation(Operation.setOptions({ setFlags: 1 })).addOperation(Operation.setOptions({ clearFlags: 2 })).setTimeout(30).build();
    expect((await POST(request(unbounded))).status).toBe(400);
    expect((await POST(request(multi))).status).toBe(400);
  });
  it("rejects unauthenticated and missing wallets", async () => {
    mocks.auth.mockResolvedValue({ ok: false, response: new Response("", { status: 401 }) });
    expect((await POST(request(transaction(Operation.setOptions({ setFlags: 1 }))))).status).toBe(401);
    mocks.auth.mockResolvedValue({ ok: true, userId: "other-owner" });
    mocks.load.mockResolvedValue(null);
    expect((await POST(request(transaction(Operation.setOptions({ setFlags: 1 }))))).status).toBe(404);
  });
});
