import { afterEach, describe, expect, it, vi } from "vitest";
import { Account, Asset, Horizon, Keypair, Networks, Operation, Transaction, TransactionBuilder } from "stellar-sdk";
const submit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db-client", () => ({ authHeaders: () => ({}), waitForAuth: async () => {} }));
vi.mock("@/lib/mainnet-submit-client", () => ({ submitMainnetTransaction: submit }));
import { signAssetManagerTransaction } from "@/lib/asset-manager/signing";
import { createBatchOffers, createSellOffer, deleteOffer, setIssuerFlag, setTrustlineAuthorization } from "@/lib/asset-manager";
const signer = Keypair.random();
const issuer = Keypair.random().publicKey();
const savedSigner = { id: "saved", publicKey: signer.publicKey() };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("Asset Manager signing client", () => {
  it("uses the saved wallet for every write flow without parsing its masked key", async () => {
    vi.spyOn(Horizon.Server.prototype, "loadAccount").mockImplementation(async publicKey => new Account(publicKey, "1") as never);
    vi.spyOn(Horizon.Server.prototype, "fetchBaseFee").mockResolvedValue(100);
    submit.mockResolvedValue({ hash: "hash" });
    const requests: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      const tx = new Transaction(body.xdr, Networks.PUBLIC);
      tx.sign(signer);
      return Response.json({ xdr: tx.toXDR() });
    }));
    const parse = vi.spyOn(Keypair, "fromSecret");
    await setIssuerFlag("https://horizon.stellar.org", "MASKED", 1, true, "public", undefined, savedSigner);
    await setTrustlineAuthorization("https://horizon.stellar.org", "MASKED", issuer, "wUSDC", signer.publicKey(), "freeze", "public", undefined, savedSigner);
    await createSellOffer("https://horizon.stellar.org", "MASKED", "wUSDC", issuer, "1", "0.5", "public", savedSigner);
    await createBatchOffers({ horizonUrl: "https://horizon.stellar.org", secretKey: "MASKED", savedSigner, assetCode: "wUSDC", issuerAddress: issuer, side: "buy", mode: "repeat", count: 2, amount: "1", priceFrom: "0.5", network: "public" });
    await deleteOffer("https://horizon.stellar.org", "MASKED", "wUSDC", issuer, "9007199254740993", "0.5", "sell", "public", savedSigner);
    expect(parse).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalledTimes(6);
    expect(requests.every(body => body.walletId === "saved" && !JSON.stringify(body).includes("MASKED"))).toBe(true);
    const cancelled = new Transaction(requests.at(-1)!.xdr as string, Networks.PUBLIC);
    expect(cancelled.operations[0]).toMatchObject({ offerId: "9007199254740993" });
  });
  it("preserves manual signing and rejects altered server responses", async () => {
    const tx = () => new TransactionBuilder(new Account(signer.publicKey(), "1"), { fee: "100", networkPassphrase: Networks.PUBLIC }).addOperation(Operation.manageSellOffer({ selling: new Asset("wUSDC", issuer), buying: Asset.native(), amount: "1", price: "1", offerId: "0" })).setTimeout(30).build();
    const manual = await signAssetManagerTransaction(tx(), signer.secret());
    expect(signer.verify(manual.hash(), manual.signatures[0].signature())).toBe(true);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ xdr: manual.toXDR() })));
    const changed = new TransactionBuilder(new Account(signer.publicKey(), "2"), { fee: "100", networkPassphrase: Networks.PUBLIC }).addOperation(Operation.setOptions({ setFlags: 1 })).setTimeout(30).build();
    await expect(signAssetManagerTransaction(changed, "MASKED", savedSigner)).rejects.toThrow("Invalid saved-wallet");
  });
});
