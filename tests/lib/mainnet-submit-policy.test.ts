import { Account, Asset, Horizon, Keypair, Networks, Operation, TransactionBuilder } from "stellar-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mainnetSubmissionIntent } from "@/lib/mainnet-submit-policy";

const source = Keypair.random();
const destination = Keypair.random().publicKey();
function transaction(...operations: ReturnType<typeof Operation.payment>[]) {
  const builder = new TransactionBuilder(new Account(source.publicKey(), "1"), { fee: "100", networkPassphrase: Networks.PUBLIC });
  for (const op of operations) builder.addOperation(op);
  return builder.setTimeout(30).build();
}

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("mainnet submission exposure", () => {
  it("counts native payments and fees from the signed transaction", async () => {
    const tx = transaction(Operation.payment({ destination, asset: Asset.native(), amount: "2.5" }));
    expect(await mainnetSubmissionIntent(tx)).toEqual({ destinations: [destination], operationCount: 1, xlmAmount: 2.50001 });
  });

  it("counts fee-bump inner payments in addition to the outer fee", async () => {
    const inner = transaction(Operation.payment({ destination, asset: Asset.native(), amount: "2.5" }));
    inner.sign(source);
    const sponsor = Keypair.random();
    const bumped = TransactionBuilder.buildFeeBumpTransaction(sponsor.publicKey(), "200", inner, Networks.PUBLIC);
    expect(await mainnetSubmissionIntent(bumped)).toEqual({ destinations: [destination], operationCount: 2, xlmAmount: 2.5 + Number(bumped.fee) / 1e7 });
  });

  it("includes the locked reserve of a sponsored child", async () => {
    const child = Keypair.random().publicKey();
    const tx = new TransactionBuilder(new Account(source.publicKey(), "1"), { fee: "100", networkPassphrase: Networks.PUBLIC })
      .addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId: child }))
      .addOperation(Operation.createAccount({ destination: child, startingBalance: "0.0000001" }))
      .addOperation(Operation.endSponsoringFutureReserves({ source: child }))
      .setTimeout(30).build();
    expect(await mainnetSubmissionIntent(tx)).toEqual({ destinations: [child, child], operationCount: 3, xlmAmount: 1.0000301 });
  });

  it("blocks DEX exposure when destination allowlisting is enabled", async () => {
    vi.stubEnv("MAINNET_ALLOWED_DESTINATIONS", destination);
    const tx = new TransactionBuilder(new Account(source.publicKey(), "1"), { fee: "100", networkPassphrase: Networks.PUBLIC })
      .addOperation(Operation.manageBuyOffer({ selling: Asset.native(), buying: new Asset("USDC", destination), buyAmount: "2", price: "3", offerId: "0" }))
      .setTimeout(30).build();
    await expect(mainnetSubmissionIntent(tx)).rejects.toThrow("DEX counterparties");
  });

  it("counts native XLM committed to a DEX buy offer", async () => {
    const tx = new TransactionBuilder(new Account(source.publicKey(), "1"), { fee: "100", networkPassphrase: Networks.PUBLIC })
      .addOperation(Operation.manageBuyOffer({ selling: Asset.native(), buying: new Asset("USDC", destination), buyAmount: "2", price: "3", offerId: "0" }))
      .setTimeout(30).build();
    expect((await mainnetSubmissionIntent(tx)).xlmAmount).toBe(6.00001);
  });

  it("counts the full verified balance of an account merge", async () => {
    vi.spyOn(Horizon.Server.prototype, "loadAccount").mockResolvedValue({ balances: [{ asset_type: "native", balance: "7.25" }] } as never);
    const tx = new TransactionBuilder(new Account(source.publicKey(), "1"), { fee: "100", networkPassphrase: Networks.PUBLIC })
      .addOperation(Operation.accountMerge({ destination }))
      .setTimeout(30).build();
    expect(await mainnetSubmissionIntent(tx)).toEqual({ destinations: [destination], operationCount: 1, xlmAmount: 7.25001 });
  });
});
