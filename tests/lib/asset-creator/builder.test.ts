// tests/lib/asset-creator/builder.test.ts
import { describe, it, expect, vi } from "vitest";
import { Networks, Keypair } from "stellar-sdk";
import { StandardStrategy } from "../../../lib/asset-creator/builder";
import type { AssetCreatorForm } from "../../../lib/asset-creator/types";

// Generate stable test keypairs
const issuerKp = Keypair.random();
const distribKp = Keypair.random();
const fundingKp = Keypair.random();

const baseForm: AssetCreatorForm = {
  network: "testnet",
  issuerPublicKey: issuerKp.publicKey(),
  issuerSecretKey: issuerKp.secret(),
  distributorPublicKey: distribKp.publicKey(),
  distributorSecretKey: distribKp.secret(),
  resolvedFundingSecretKey: fundingKp.secret(),
  assetCode: "myTOKEN",
  tokenName: "",
  supply: 1_000_000,
  memo: "",
  homeDomain: "",
};

function makeServer() {
  const mockAccount = (publicKey: string, seq = "1000") => ({
    id: publicKey,
    sequence: seq,
    sequenceNumber: () => seq,
    accountId: () => publicKey,
    incrementSequenceNumber: vi.fn(function(this: { sequence: string }) { this.sequence = String(parseInt(this.sequence) + 1); }),
  });

  return {
    loadAccount: vi.fn((pk: string) => Promise.resolve(mockAccount(pk))),
  } as unknown as import("stellar-sdk").Horizon.Server;
}

describe("StandardStrategy.buildTransactions", () => {
  it("builds fund-accounts tx with two create_account ops on mainnet", async () => {
    const server = makeServer();
    const signal = new AbortController().signal;
    const txns = await StandardStrategy.buildTransactions(
      { ...baseForm, network: "public", resolvedFundingSecretKey: fundingKp.secret() },
      ["fund-accounts"],
      server,
      Networks.PUBLIC,
      signal,
    );
    expect(txns).toHaveLength(1);
    expect(txns[0].stepId).toBe("fund-accounts");
    expect(txns[0].sourceAccount).toBe(fundingKp.publicKey());
    // XDR should be a non-empty string
    expect(txns[0].xdr.length).toBeGreaterThan(0);
  });

  it("builds set-home-domain tx when homeDomain is provided", async () => {
    const server = makeServer();
    const signal = new AbortController().signal;
    const txns = await StandardStrategy.buildTransactions(
      { ...baseForm, homeDomain: "example.com" },
      ["set-home-domain"],
      server,
      Networks.TESTNET,
      signal,
    );
    expect(txns).toHaveLength(1);
    expect(txns[0].stepId).toBe("set-home-domain");
    expect(txns[0].sourceAccount).toBe(issuerKp.publicKey());
  });

  it("skips set-home-domain when homeDomain is empty", async () => {
    const server = makeServer();
    const signal = new AbortController().signal;
    const txns = await StandardStrategy.buildTransactions(
      { ...baseForm, homeDomain: "" },
      ["set-home-domain"],
      server,
      Networks.TESTNET,
      signal,
    );
    expect(txns).toHaveLength(0);
  });

  it("builds trustline tx signed by distributor", async () => {
    const server = makeServer();
    const signal = new AbortController().signal;
    const txns = await StandardStrategy.buildTransactions(
      baseForm,
      ["trustline"],
      server,
      Networks.TESTNET,
      signal,
    );
    expect(txns).toHaveLength(1);
    expect(txns[0].stepId).toBe("trustline");
    expect(txns[0].sourceAccount).toBe(distribKp.publicKey());
  });

  it("builds issuance tx signed by issuer", async () => {
    const server = makeServer();
    const signal = new AbortController().signal;
    const txns = await StandardStrategy.buildTransactions(
      baseForm,
      ["issuance"],
      server,
      Networks.TESTNET,
      signal,
    );
    expect(txns).toHaveLength(1);
    expect(txns[0].stepId).toBe("issuance");
    expect(txns[0].sourceAccount).toBe(issuerKp.publicKey());
  });

  it("applies memo only to issuance tx, not trustline", async () => {
    const server = makeServer();
    const signal = new AbortController().signal;
    const { TransactionBuilder, Networks: N } = await import("stellar-sdk");

    const trustlineTxns = await StandardStrategy.buildTransactions(
      { ...baseForm, memo: "hello" },
      ["trustline"],
      server,
      Networks.TESTNET,
      signal,
    );
    const issuanceTxns = await StandardStrategy.buildTransactions(
      { ...baseForm, memo: "hello" },
      ["issuance"],
      server,
      Networks.TESTNET,
      signal,
    );

    const trustlineTx = TransactionBuilder.fromXDR(trustlineTxns[0].xdr, N.TESTNET) as import("stellar-sdk").Transaction;
    const issuanceTx = TransactionBuilder.fromXDR(issuanceTxns[0].xdr, N.TESTNET) as import("stellar-sdk").Transaction;

    expect(trustlineTx.memo.type).toBe("none");
    expect(issuanceTx.memo.type).toBe("text");
    const memoValue = issuanceTx.memo.value;
    const memoStr = Buffer.isBuffer(memoValue) ? memoValue.toString("utf8") : memoValue;
    expect(memoStr).toBe("hello");
  });

  it("preserves assetCode case in issuance tx", async () => {
    const server = makeServer();
    const signal = new AbortController().signal;
    const { TransactionBuilder, Networks: N } = await import("stellar-sdk");

    const txns = await StandardStrategy.buildTransactions(
      { ...baseForm, assetCode: "myTOKEN" },
      ["issuance"],
      server,
      Networks.TESTNET,
      signal,
    );
    expect(txns).toHaveLength(1);
    const tx = TransactionBuilder.fromXDR(txns[0].xdr, N.TESTNET) as import("stellar-sdk").Transaction;
    const op = tx.operations[0] as import("stellar-sdk").Operation.Payment;
    expect(op.asset.getCode()).toBe("myTOKEN");
    expect(op.asset.getCode()).not.toBe("MYTOKEN");
  });
});
