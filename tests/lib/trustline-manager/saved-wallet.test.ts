import { afterEach, describe, expect, it, vi } from "vitest";
import { Account, Horizon, Keypair } from "stellar-sdk";

const { signing, submit } = vi.hoisted(() => ({ signing: vi.fn(), submit: vi.fn() }));
vi.mock("@/lib/payments-signing", () => ({ signPaymentTransaction: signing }));
vi.mock("@/lib/mainnet-submit-client", () => ({ submitMainnetTransaction: submit }));
import { addTrustline, drainAndRemoveTrustline } from "@/lib/trustline-manager";

const wallet = Keypair.random();
const issuer = Keypair.random().publicKey();

afterEach(() => {
  vi.restoreAllMocks();
  signing.mockReset();
  submit.mockReset();
});

describe("single trustline with a saved wallet", () => {
  it("signs and submits without exposing the secret to the browser", async () => {
    const load = vi.spyOn(Horizon.Server.prototype, "loadAccount").mockResolvedValue(new Account(wallet.publicKey(), "1") as never);
    submit.mockResolvedValue({ hash: "submitted" });
    signing.mockImplementation(async (tx, id, secret) => {
      expect(id).toBe("wallet-1");
      expect(secret).toBe("");
      tx.sign(wallet);
      return tx;
    });
    const result = await addTrustline({ assetCode: "wUSDC", issuer, signingSecret: "", savedSigner: {
      id: "wallet-1", publicKey: wallet.publicKey(), assertCurrent: () => {},
    }, horizonUrl: "https://horizon.stellar.org", network: "public" });
    expect(result.txHash).toBe("submitted");
    expect(load).toHaveBeenCalledWith(wallet.publicKey());
    expect(submit).toHaveBeenCalledOnce();
  });

  it("stops before submission when the selected wallet changes while signing", async () => {
    vi.spyOn(Horizon.Server.prototype, "loadAccount").mockResolvedValue(new Account(wallet.publicKey(), "1") as never);
    submit.mockResolvedValue({ hash: "submitted" });
    let current = true;
    signing.mockImplementation(async (tx) => { current = false; return tx; });
    await expect(addTrustline({ assetCode: "wUSDC", issuer, signingSecret: "", savedSigner: {
      id: "wallet-1", publicKey: wallet.publicKey(), assertCurrent: () => { if (!current) throw new Error("wallet changed"); },
    }, horizonUrl: "https://horizon.stellar.org", network: "public" })).rejects.toThrow("wallet changed");
    expect(submit).not.toHaveBeenCalled();
  });

  it("never routes an account merge through trustline removal", async () => {
    await expect(drainAndRemoveTrustline({ assetCode: "XLM", destination: issuer, signingSecret: "", savedSigner: {
      id: "wallet-1", publicKey: wallet.publicKey(), assertCurrent: () => {},
    }, horizonUrl: "https://horizon.stellar.org", network: "public" })).rejects.toThrow("Account merge requires");
  });
});
