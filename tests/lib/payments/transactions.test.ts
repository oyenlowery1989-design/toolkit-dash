import { describe, expect, it } from "vitest";
import { Account, Networks, TransactionBuilder } from "stellar-sdk";
import fixtures from "@/tests/fixtures/payments-transactions.json";
import { addSendOperations, addPathOperation, addClaimableBalanceOperation, addPaymentMemo, buildCreateAccountTransaction, buildTrustlineTransaction } from "@/lib/payments/transactions";
import type { PathMode } from "@/lib/payments/types";

describe("Payments operation builders preserve pre-refactor transactions", () => {
  for (const fixture of fixtures) {
    it(fixture.name, () => {
      const input = fixture.input;
      const builder = new TransactionBuilder(new Account(input.publicKey, "1"), { fee: "200", networkPassphrase: Networks.PUBLIC });
      let cancelCounts: number[] = [];
      if (input.activeTab === "send") cancelCounts = addSendOperations(builder, input.legs, input.offers);
      else if (input.activeTab === "path") addPathOperation(builder, {
        ...input, pathMode: input.pathMode as PathMode, selectedPath: input.paths[input.selectedPathIndex],
      });
      else addClaimableBalanceOperation(builder, input.claimAssetKey, input.claimAmount, input.claimants);
      addPaymentMemo(builder, input.memoValue);
      expect(builder.setTimebounds(0, 2000000000).build().toXDR()).toBe(fixture.expected.xdr);
      expect(cancelCounts).toEqual(fixture.expected.cancelCounts);
    });
  }
});


describe("Payments recovery builders", () => {
  it("preserves account-creation destination, amount, and memo", () => {
    const input = fixtures[0].input;
    const tx = buildCreateAccountTransaction(new Account(input.publicKey, "1"), "100", Networks.PUBLIC, ` ${input.legs[0].destination} `, "2", " recovery ");
    expect(tx.operations).toEqual([{ type: "createAccount", destination: input.legs[0].destination, startingBalance: "2.0000000" }]);
    expect(tx.memo.value).toBe("recovery");
    expect(tx.source).toBe(input.publicKey);
  });
  it("adds a trustline on the recovery account preserving the custom asset code", () => {
    const input = fixtures[1].input;
    const tx = buildTrustlineTransaction(new Account(input.publicKey, "1"), "100", Networks.PUBLIC, input.legs[0].assetKey);
    const op = tx.operations[0];
    expect(op.type).toBe("changeTrust");
    if (op.type !== "changeTrust") throw new Error("Expected changeTrust");
    if (!("code" in op.line)) throw new Error("Expected classic asset trustline");
    expect(op.line.code).toBe("wUSDC");
    expect(op.line.issuer).toBe(input.destAssetIssuer);
  });
});

it("cancels each offer only once when multiple legs remove trustlines", () => {
  const input = fixtures[1].input;
  const leg = { ...input.legs[0], removeTrustline: true };
  const offer = { id: "1", price: "1", selling: { asset_type: "credit_alphanum4", asset_code: leg.assetKey.split(":")[0], asset_issuer: leg.assetKey.split(":")[1] }, buying: { asset_type: "native" } };
  const builder = new TransactionBuilder(new Account(input.publicKey, "1"), { fee: "100", networkPassphrase: Networks.PUBLIC });
  expect(addSendOperations(builder, [leg, leg], [offer])).toEqual([1, 0]);
  const tx = builder.setTimeout(30).build();
  expect(tx.operations.filter((op) => op.type === "manageSellOffer")).toHaveLength(1);
});
