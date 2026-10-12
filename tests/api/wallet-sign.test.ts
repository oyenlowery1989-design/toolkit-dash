import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Account, Asset, Horizon, Keypair, Networks, Operation, Transaction, TransactionBuilder } from "stellar-sdk";
import { NextRequest } from "next/server";
import { validateMainnetRun } from "@/lib/mainnet-safety";
import { MainnetSigningBudgetUnavailableError } from "@/lib/mainnet-signing-budget";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), single: vi.fn(), filter: vi.fn(), reserve: vi.fn() }));
vi.mock("@/lib/mainnet-signing-budget", () => ({
  reserveMainnetSignature: mocks.reserve,
  MainnetSigningBudgetUnavailableError: class MainnetSigningBudgetUnavailableError extends Error {},
}));
vi.mock("@/lib/supabase-server", () => ({
  requireAuth: mocks.auth,
  isSupabaseOnly: () => true,
  getSupabase: () => {
    const query = {
      select() { return this; },
      eq(column: string, value: string) { mocks.filter(column, value); return this; },
      single: mocks.single,
    };
    return { from: () => query };
  },
}));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
import { POST } from "@/app/api/wallet/sign/route";

const signer = Keypair.random();
const destination = Keypair.random().publicKey();
function payment(source = signer.publicKey(), opSource?: string) {
  return new TransactionBuilder(new Account(source, "1"), { fee: "100", networkPassphrase: Networks.PUBLIC })
    .addOperation(Operation.payment({ destination, asset: Asset.native(), amount: "1", source: opSource }))
    .setTimeout(30).build();
}
function request(xdr = payment().toXDR()) {
  return new NextRequest("http://localhost/api/wallet/sign", { method: "POST", body: JSON.stringify({ walletId: "wallet-1", xdr }) });
}
beforeEach(() => {
  mocks.reserve.mockClear();
  mocks.reserve.mockImplementation(async (_userId, _hash, _expiry, intent) => validateMainnetRun(intent));
  mocks.filter.mockClear();
  vi.stubEnv("MAINNET_TRANSACTIONS_ENABLED", "true");
  vi.stubEnv("MAINNET_EMERGENCY_STOP", "false");
  vi.stubEnv("MAINNET_ALLOWED_DESTINATIONS", "");
  mocks.auth.mockResolvedValue({ ok: true, userId: "owner" });
  mocks.single.mockResolvedValue({ data: { public_key: signer.publicKey(), secret_key: signer.secret() }, error: null });
});
afterEach(() => vi.unstubAllEnvs());
describe("saved-wallet signing", () => {
  it("signs a mainnet payment without returning the stored secret", async () => {
    const unsigned = payment();
    const response = await POST(request(unsigned.toXDR()));
    expect(response.status).toBe(200);
    expect(mocks.reserve).toHaveBeenCalledWith("owner", unsigned.hash().toString("hex"),
      Number(unsigned.timeBounds?.maxTime), expect.objectContaining({ xlmAmount: expect.any(Number) }));
    expect(mocks.filter).toHaveBeenCalledWith("id", "wallet-1");
    expect(mocks.filter).toHaveBeenCalledWith("user_id", "owner");
    const body = await response.json();
    const signed = new Transaction(body.xdr, Networks.PUBLIC);
    expect(signed.signatures).toHaveLength(1);
    expect(signer.verify(signed.hash(), signed.signatures[0].signature())).toBe(true);
    expect(JSON.stringify(body)).not.toContain(signer.secret());
  });
  it("rejects a wallet not owned by this session", async () => {
    mocks.single.mockResolvedValue({ data: null, error: null });
    expect((await POST(request())).status).toBe(404);
  });
  it("rejects a watch-only wallet", async () => {
    mocks.single.mockResolvedValue({ data: { public_key: signer.publicKey(), secret_key: "" }, error: null });
    expect((await POST(request())).status).toBe(400);
  });
  it("rejects another transaction source or operation source", async () => {
    expect((await POST(request(payment(destination).toXDR()))).status).toBe(400);
    expect((await POST(request(payment(signer.publicKey(), destination).toXDR()))).status).toBe(400);
  });
  it("rejects a saved key that does not match the wallet address", async () => {
    mocks.single.mockResolvedValue({ data: { public_key: signer.publicKey(), secret_key: Keypair.random().secret() }, error: null });
    expect((await POST(request())).status).toBe(400);
  });
  it("honors the emergency stop", async () => {
    vi.stubEnv("MAINNET_EMERGENCY_STOP", "true");
    expect((await POST(request())).status).toBe(403);
  });
  it("does not release a signature when the daily ledger is unavailable", async () => {
    mocks.reserve.mockRejectedValueOnce(new MainnetSigningBudgetUnavailableError("Ledger unavailable"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Ledger unavailable" });
  });
  it("does not expose signing through an unauthenticated request", async () => {
    mocks.auth.mockResolvedValue({ ok: false, response: new Response("", { status: 401 }) });
    expect((await POST(request())).status).toBe(401);
  });
});

describe("Payments signing boundaries", () => {
  it("refuses signing while transactions are disabled", async () => {
    vi.stubEnv("MAINNET_TRANSACTIONS_ENABLED", "false");
    expect((await POST(request())).status).toBe(403);
  });
  it("signs a fee bump only for its saved fee-source wallet", async () => {
    const inner = payment(destination); inner.sign(Keypair.random());
    const bump = TransactionBuilder.buildFeeBumpTransaction(signer.publicKey(), "100", inner, Networks.PUBLIC);
    const response = await POST(request(bump.toXDR()));
    expect(response.status).toBe(200);
    const signed = TransactionBuilder.fromXDR((await response.json()).xdr, Networks.PUBLIC);
    expect(signer.verify(signed.hash(), signed.signatures[0].signature())).toBe(true);
    const wrong = TransactionBuilder.buildFeeBumpTransaction(destination, "100", inner, Networks.PUBLIC);
    expect((await POST(request(wrong.toXDR()))).status).toBe(400);
  });
  it("rejects a fee bump whose inner transaction has no expiry", async () => {
    const inner = new TransactionBuilder(new Account(destination, "1"), { fee: "100", networkPassphrase: Networks.PUBLIC })
      .addOperation(Operation.payment({ destination: signer.publicKey(), asset: Asset.native(), amount: "1" }))
      .setTimeout(0).build();
    inner.sign(Keypair.random());
    const bump = TransactionBuilder.buildFeeBumpTransaction(signer.publicKey(), "100", inner, Networks.PUBLIC);
    expect((await POST(request(bump.toXDR()))).status).toBe(400);
  });
  it("does not authorize changing account signers", async () => {
    for (const op of [Operation.setOptions({ masterWeight: 0 }), Operation.setOptions({ homeDomain: "example.com", masterWeight: 0 })]) {
      const tx = new TransactionBuilder(new Account(signer.publicKey(), "1"), { fee: "100", networkPassphrase: Networks.PUBLIC })
        .addOperation(op).setTimeout(30).build();
      expect((await POST(request(tx.toXDR()))).status).toBe(400);
    }
  });
  it("honors the destination allowlist", async () => {
    vi.stubEnv("MAINNET_ALLOWED_DESTINATIONS", signer.publicKey());
    expect((await POST(request())).status).toBe(403);
  });
  it("rejects malformed XDR and unbounded transactions", async () => {
    expect((await POST(request("bad-xdr"))).status).toBe(400);
    const tx = new TransactionBuilder(new Account(signer.publicKey(), "1"), { fee: "100", networkPassphrase: Networks.PUBLIC })
      .addOperation(Operation.payment({ destination, asset: Asset.native(), amount: "1" })).setTimeout(0).build();
    expect((await POST(request(tx.toXDR()))).status).toBe(400);
  });
  it("uses an encrypted stored key", async () => {
    const { encryptStoredSecret } = await import("@/lib/secret-storage");
    vi.stubEnv("SIGNING_KEY_ENCRYPTION_KEY", "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=");
    mocks.single.mockResolvedValue({ data: { public_key: signer.publicKey(), secret_key: encryptStoredSecret(signer.secret()) }, error: null });
    expect((await POST(request())).status).toBe(200);
  });
});

describe("saved-wallet account management", () => {
  it("signs claims, home-domain edits, and sponsorship revocations", async () => {
    const ops = [
      Operation.claimClaimableBalance({ balanceId: "00000000" + "a".repeat(64) }),
      Operation.setOptions({ homeDomain: "example.com" }),
      Operation.setOptions({ homeDomain: "" }),
      Operation.revokeAccountSponsorship({ account: destination }),
      Operation.revokeTrustlineSponsorship({ account: destination, asset: new Asset("wUSDC", signer.publicKey()) }),
      Operation.revokeSignerSponsorship({ account: destination, signer: { ed25519PublicKey: signer.publicKey() } }),
    ];
    for (const op of ops) {
      const tx = new TransactionBuilder(new Account(signer.publicKey(), "1"), { fee: "100", networkPassphrase: Networks.PUBLIC })
        .addOperation(op).setTimeout(30).build();
      expect((await POST(request(tx.toXDR()))).status).toBe(200);
    }
  });

  it("checks the live XLM balance and destination policy before signing an account merge", async () => {
    const load = vi.spyOn(Horizon.Server.prototype, "loadAccount").mockResolvedValue({ balances: [{ asset_type: "native", balance: "10" }] } as never);
    const merge = new TransactionBuilder(new Account(signer.publicKey(), "1"), { fee: "100", networkPassphrase: Networks.PUBLIC })
      .addOperation(Operation.accountMerge({ destination })).setTimeout(30).build();
    try {
      expect((await POST(request(merge.toXDR()))).status).toBe(200);
      vi.stubEnv("MAINNET_MAX_XLM_PER_RUN", "5");
      expect((await POST(request(merge.toXDR()))).status).toBe(403);
      vi.stubEnv("MAINNET_MAX_XLM_PER_RUN", "100");
      vi.stubEnv("MAINNET_ALLOWED_DESTINATIONS", signer.publicKey());
      expect((await POST(request(merge.toXDR()))).status).toBe(403);
    } finally {
      load.mockRestore();
    }
  });
  it("fails closed when the merge balance cannot be verified", async () => {
    const load = vi.spyOn(Horizon.Server.prototype, "loadAccount").mockRejectedValue(new Error("Horizon unavailable"));
    const merge = new TransactionBuilder(new Account(signer.publicKey(), "1"), { fee: "100", networkPassphrase: Networks.PUBLIC })
      .addOperation(Operation.accountMerge({ destination })).setTimeout(30).build();
    try {
      expect((await POST(request(merge.toXDR()))).status).toBe(503);
    } finally {
      load.mockRestore();
    }
  });
});

describe("supported Payments operations", () => {
  it("signs paths, claimable balances, trustline changes, offer cancellations, and account creation", async () => {
    const { Claimant } = await import("stellar-sdk");
    const custom = new Asset("wUSDC", destination);
    const ops = [
      Operation.pathPaymentStrictReceive({ sendAsset: Asset.native(), sendMax: "2", destination, destAsset: custom, destAmount: "1", path: [] }),
      Operation.pathPaymentStrictSend({ sendAsset: Asset.native(), sendAmount: "2", destination, destAsset: custom, destMin: "1", path: [] }),
      Operation.createClaimableBalance({ asset: Asset.native(), amount: "1", claimants: [new Claimant(destination)] }),
      Operation.changeTrust({ asset: custom }),
      Operation.changeTrust({ asset: custom, limit: "0" }),
      Operation.manageSellOffer({ selling: custom, buying: Asset.native(), amount: "0", price: "1", offerId: "1" }),
      Operation.createAccount({ destination, startingBalance: "2" }),
    ];
    for (const op of ops) {
      const tx = new TransactionBuilder(new Account(signer.publicKey(), "1"), { fee: "100", networkPassphrase: Networks.PUBLIC })
        .addOperation(op).setTimeout(30).build();
      const response = await POST(request(tx.toXDR()));
      expect(response.status).toBe(200);
      const signed = new Transaction((await response.json()).xdr, Networks.PUBLIC);
      expect(signed.hash().equals(tx.hash())).toBe(true);
    }
  });
  it("enforces the native amount limit before signing", async () => {
    vi.stubEnv("MAINNET_MAX_XLM_PER_RUN", "0.5");
    expect((await POST(request())).status).toBe(403);
  });
});


describe("Payments buy-offer cancellation", () => {
  it("signs cancelling a buy offer during trustline removal", async () => {
    const tx = new TransactionBuilder(new Account(signer.publicKey(), "1"), { fee: "100", networkPassphrase: Networks.PUBLIC })
      .addOperation(Operation.manageBuyOffer({ selling: Asset.native(), buying: new Asset("wUSDC", destination), buyAmount: "0", price: "1", offerId: "7" }))
      .setTimeout(30).build();
    const response = await POST(request(tx.toXDR()));
    expect(response.status).toBe(200);
    const signed = new Transaction((await response.json()).xdr, Networks.PUBLIC);
    expect(signer.verify(signed.hash(), signed.signatures[0].signature())).toBe(true);
  });
  it("continues to reject creating or updating a buy offer with a positive amount", async () => {
    const tx = new TransactionBuilder(new Account(signer.publicKey(), "1"), { fee: "100", networkPassphrase: Networks.PUBLIC })
      .addOperation(Operation.manageBuyOffer({ selling: Asset.native(), buying: new Asset("wUSDC", destination), buyAmount: "1", price: "1", offerId: "7" }))
      .setTimeout(30).build();
    expect((await POST(request(tx.toXDR()))).status).toBe(400);
  });
});
