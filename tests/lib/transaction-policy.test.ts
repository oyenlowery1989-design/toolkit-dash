import { describe, expect, it } from "vitest";
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from "stellar-sdk";
import { transactionIntent, toStroops } from "@/lib/transaction-policy";
import { verifyEnvelopeSignatures } from "@/lib/transaction-signatures";

const source = Keypair.random(), target = Keypair.random().publicKey();
function build(ops: ReturnType<typeof Operation.payment>[]) {
  const builder = new TransactionBuilder(new Account(source.publicKey(), "1"), { fee: "100", networkPassphrase: Networks.PUBLIC });
  for (const op of ops) builder.addOperation(op);
  return builder.setTimeout(30).build();
}
describe("transaction policy", () => {
  it("accounts for native payment plus fees in exact stroops", async () => {
    const tx = build([Operation.payment({ destination: target, asset: Asset.native(), amount: "1.0000001" })]);
    expect((await transactionIntent(tx, async () => "0")).stroops).toBe(10000101n);
  });
  it("caps path-payment spend using sendMax, not the requested destination amount", async () => {
    const tx = build([Operation.pathPaymentStrictReceive({ sendAsset: Asset.native(), sendMax: "50", destination: target, destAsset: new Asset("USD", target), destAmount: "1", path: [] })]);
    expect((await transactionIntent(tx, async () => "0")).stroops).toBe(500000100n);
  });
  it("counts claimable-balance beneficiaries and native funding", async () => {
    const { Claimant } = await import("stellar-sdk");
    const tx = build([Operation.createClaimableBalance({ asset: Asset.native(), amount: "2", claimants: [new Claimant(target)] })]);
    const intent = await transactionIntent(tx, async () => "0");
    expect(intent.destinations).toEqual([target]); expect(intent.stroops).toBe(20000100n);
  });
  it("bounds account merge by balance and rejects mixed merge transactions", async () => {
    const merge = Operation.accountMerge({ destination: target });
    expect((await transactionIntent(build([merge]), async () => "42")).stroops).toBe(420000100n);
    await expect(transactionIntent(build([merge, Operation.manageData({ name: "x", value: null })]), async () => "42")).rejects.toThrow("alone");
  });
  it.each(["NaN", "-1", "1.00000001", "1e9", "Infinity"])("rejects invalid amount %s", (amount) => expect(() => toStroops(amount)).toThrow());
  it("rejects unknown spending classes instead of silently treating them as free", async () => {
    const tx = build([Operation.liquidityPoolDeposit({ liquidityPoolId: "0".repeat(64), maxAmountA: "1", maxAmountB: "1", minPrice: "1", maxPrice: "1" })]);
    await expect(transactionIntent(tx, async () => "0")).rejects.toThrow("explicit spending policy");
  });
  it("rejects unsigned and insufficient-weight envelopes before budget reservation", async () => {
    const tx = build([Operation.payment({ destination: target, asset: Asset.native(), amount: "1" })]);
    const account = { signers: [{ key: source.publicKey(), weight: 1 }], thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 2 } };
    await expect(verifyEnvelopeSignatures(tx, async () => account)).rejects.toThrow("signatures");
    tx.sign(source);
    await expect(verifyEnvelopeSignatures(tx, async () => account)).rejects.toThrow("signatures");
    await expect(verifyEnvelopeSignatures(tx, async () => ({ ...account, thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 } }))).resolves.toBeUndefined();
  });
});

it("accounts for rational buy-offer prices directly from XDR without losing precision", async () => {
  const tx = build([Operation.manageBuyOffer({ selling: Asset.native(), buying: new Asset("USD", target), buyAmount: "3", price: { n: 1, d: 3 }, offerId: "0" })]);
  expect((await transactionIntent(tx, async () => "0")).stroops).toBe(10000100n);
});
