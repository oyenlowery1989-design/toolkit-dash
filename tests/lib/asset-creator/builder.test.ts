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

  // By default all accounts exist. Pass notFound=[...publicKeys] to simulate missing accounts.
  return {
    loadAccount: vi.fn((pk: string) => Promise.resolve(mockAccount(pk))),
  } as unknown as import("stellar-sdk").Horizon.Server;
}

function makeServerWithMissing(missingKeys: string[]) {
  const mockAccount = (publicKey: string, seq = "1000") => ({
    id: publicKey,
    sequence: seq,
    sequenceNumber: () => seq,
    accountId: () => publicKey,
    incrementSequenceNumber: vi.fn(function(this: { sequence: string }) { this.sequence = String(parseInt(this.sequence) + 1); }),
  });
  return {
    loadAccount: vi.fn((pk: string) => {
      if (missingKeys.includes(pk)) return Promise.reject({ response: { status: 404 } });
      return Promise.resolve(mockAccount(pk));
    }),
  } as unknown as import("stellar-sdk").Horizon.Server;
}

describe("StandardStrategy.buildTransactions", () => {
  it("builds fund-accounts tx when both accounts are missing", async () => {
    const server = makeServerWithMissing([issuerKp.publicKey(), distribKp.publicKey()]);
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
    expect(txns[0].xdr.length).toBeGreaterThan(0);
  });

  it("skips fund-accounts when both accounts already exist", async () => {
    const server = makeServer(); // all accounts exist
    const signal = new AbortController().signal;
    const txns = await StandardStrategy.buildTransactions(
      { ...baseForm, network: "public", resolvedFundingSecretKey: fundingKp.secret() },
      ["fund-accounts"],
      server,
      Networks.PUBLIC,
      signal,
    );
    expect(txns).toHaveLength(0);
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

describe("saved wallet role signing", () => {
  it("routes each role to its own wallet ID with no browser key", async () => {
    const { TransactionBuilder, Transaction } = await import("stellar-sdk");
    const requests: { walletId: string; stepId: string; network: string; xdr: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      requests.push(body);
      const tx = TransactionBuilder.fromXDR(body.xdr, Networks.PUBLIC) as InstanceType<typeof Transaction>;
      const kp = body.walletId === "issuer" ? issuerKp : body.walletId === "distributor" ? distribKp : fundingKp;
      tx.sign(kp);
      return new Response(JSON.stringify({ xdr: tx.toXDR() }), { status: 200 });
    }));
    try {
      const form = { ...baseForm, network: "public" as const, issuerSecretKey: "", distributorSecretKey: "", resolvedFundingSecretKey: "", issuerWalletId: "issuer", distributorWalletId: "distributor", fundingWalletId: "funder", fundingPublicKey: fundingKp.publicKey(), homeDomain: "example.com" };
      await StandardStrategy.buildTransactions(form, ["fund-accounts"], makeServerWithMissing([issuerKp.publicKey(), distribKp.publicKey()]), Networks.PUBLIC, new AbortController().signal);
      await StandardStrategy.buildTransactions(form, ["set-home-domain", "trustline", "issuance"], makeServer(), Networks.PUBLIC, new AbortController().signal);
      expect(requests.map(({ walletId, stepId }) => [walletId, stepId])).toEqual([["funder", "fund-accounts"], ["issuer", "set-home-domain"], ["distributor", "trustline"], ["issuer", "issuance"]]);
      expect(requests.map(({ network }) => network)).toEqual(["public", "public", "public", "public"]);
      for (const { xdr } of requests) expect(new Transaction(xdr, Networks.PUBLIC).signatures).toHaveLength(0);
    } finally { vi.unstubAllGlobals(); }
  });

  it("sends testnet network for a saved issuer wallet", async () => {
    const { TransactionBuilder, Transaction } = await import("stellar-sdk");
    const requests: { network: string; xdr: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      requests.push(body);
      const tx = TransactionBuilder.fromXDR(body.xdr, Networks.TESTNET) as InstanceType<typeof Transaction>;
      tx.sign(issuerKp);
      return new Response(JSON.stringify({ xdr: tx.toXDR() }), { status: 200 });
    }));
    try {
      const txns = await StandardStrategy.buildTransactions(
        { ...baseForm, issuerSecretKey: "", issuerWalletId: "issuer" },
        ["issuance"], makeServer(), Networks.TESTNET, new AbortController().signal,
      );
      expect(requests).toEqual([expect.objectContaining({ network: "testnet" })]);
      const signed = new Transaction(txns[0].xdr, Networks.TESTNET);
      expect(issuerKp.verify(signed.hash(), signed.signatures[0].signature())).toBe(true);
    } finally { vi.unstubAllGlobals(); }
  });

  it("does not sign or remint supply already held by distributor", async () => {
    const server = makeServer();
    vi.mocked(server.loadAccount).mockResolvedValue({ balances: [{ asset_type: "credit_alphanum12", asset_code: baseForm.assetCode, asset_issuer: baseForm.issuerPublicKey, balance: String(baseForm.supply) }] } as never);
    const fetchSpy = vi.fn(); vi.stubGlobal("fetch", fetchSpy);
    try {
      const txns = await StandardStrategy.buildTransactions({ ...baseForm, issuerSecretKey: "", issuerWalletId: "issuer" }, ["issuance"], server, Networks.PUBLIC, new AbortController().signal);
      expect(txns).toHaveLength(0);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});
