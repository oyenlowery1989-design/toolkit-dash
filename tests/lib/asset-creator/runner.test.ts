import { expect, it, vi } from "vitest";
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from "stellar-sdk";
const submitTransaction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/mainnet-submit-client", () => ({ submitMainnetTransaction: submitTransaction }));
import { runAssetCreation } from "@/lib/asset-creator/runner";
import type { AssetCreatorForm, CreationStrategy } from "@/lib/asset-creator/types";

it("does not submit if a saved-wallet signature finishes after cancellation", async () => {
  const issuer = Keypair.random();
  const distributor = Keypair.random();
  const controller = new AbortController();
  const tx = new TransactionBuilder(new Account(issuer.publicKey(), "1"), { fee: "100", networkPassphrase: Networks.PUBLIC })
    .addOperation(Operation.setOptions({ homeDomain: "example.com" })).setTimeout(180).build();
  tx.sign(issuer);
  const strategy: CreationStrategy = {
    id: "test", label: "test",
    async buildTransactions() {
      controller.abort();
      return [{ stepId: "set-home-domain", label: "test", sourceAccount: issuer.publicKey(), xdr: tx.toXDR() }];
    },
  };
  submitTransaction.mockReset();
  const form: AssetCreatorForm = {
    network: "public", issuerPublicKey: issuer.publicKey(), issuerSecretKey: "", issuerWalletId: "saved",
    distributorPublicKey: distributor.publicKey(), distributorSecretKey: distributor.secret(),
    resolvedFundingSecretKey: "", assetCode: "myTOKEN", tokenName: "", supply: 100, memo: "", homeDomain: "example.com",
  };
  await runAssetCreation(form, new Set(["fund-accounts"]), {
    strategy, server: { submitTransaction } as never, networkPassphrase: Networks.PUBLIC,
    signal: controller.signal, onLog: vi.fn(), onStep: vi.fn(),
  });
  expect(submitTransaction).not.toHaveBeenCalled();
});

it("marks issuance successful without resubmitting when its original hash is on Horizon", async () => {
  const issuer = Keypair.random();
  const distributor = Keypair.random();
  const tx = new TransactionBuilder(new Account(issuer.publicKey(), "1"), { fee: "100", networkPassphrase: Networks.PUBLIC })
    .addOperation(Operation.payment({ destination: distributor.publicKey(), asset: new Asset("myTOKEN", issuer.publicKey()), amount: "100" }))
    .setTimeout(180).build();
  tx.sign(issuer);
  const hash = tx.hash().toString("hex");
  submitTransaction.mockReset();
  const call = vi.fn().mockResolvedValue({ successful: true });
  const onStep = vi.fn();
  const form: AssetCreatorForm = {
    network: "public", issuerPublicKey: issuer.publicKey(), issuerSecretKey: "", issuerWalletId: "saved",
    distributorPublicKey: distributor.publicKey(), distributorSecretKey: "", resolvedFundingSecretKey: "",
    assetCode: "myTOKEN", tokenName: "", supply: 100, memo: "", homeDomain: "",
  };
  const strategy: CreationStrategy = { id: "test", label: "test", async buildTransactions() {
    return [{ stepId: "issuance", label: "issue", sourceAccount: issuer.publicKey(), xdr: tx.toXDR() }];
  } };
  const server = {
    serverURL: new URL("https://horizon.example"), submitTransaction,
    transactions: () => ({ transaction: (requestedHash: string) => {
      expect(requestedHash).toBe(hash);
      return { call };
    } }),
  } as unknown as import("stellar-sdk").Horizon.Server;
  const result = await runAssetCreation(form, new Set(["fund-accounts", "set-home-domain", "trustline"]), {
    strategy, server, networkPassphrase: Networks.PUBLIC, signal: new AbortController().signal,
    onLog: vi.fn(), onStep,
  });
  expect(submitTransaction).not.toHaveBeenCalled();
  expect(result).toEqual([{ stepId: "issuance", status: "success", txHash: hash }]);
  expect(onStep).toHaveBeenCalledWith(result[0]);
});

it("reconciles a failed issuance submit by checking its original hash again", async () => {
  const issuer = Keypair.random();
  const distributor = Keypair.random();
  const tx = new TransactionBuilder(new Account(issuer.publicKey(), "1"), { fee: "100", networkPassphrase: Networks.PUBLIC })
    .addOperation(Operation.payment({ destination: distributor.publicKey(), asset: new Asset("myTOKEN", issuer.publicKey()), amount: "100" }))
    .setTimeout(180).build();
  tx.sign(issuer);
  const notFound = Object.assign(new Error("not found"), { response: { status: 404 } });
  const call = vi.fn().mockRejectedValueOnce(notFound).mockResolvedValueOnce({ successful: true });
  submitTransaction.mockReset().mockRejectedValue(new Error("tx_bad_seq"));
  const form: AssetCreatorForm = {
    network: "public", issuerPublicKey: issuer.publicKey(), issuerSecretKey: "", issuerWalletId: "saved",
    distributorPublicKey: distributor.publicKey(), distributorSecretKey: "", resolvedFundingSecretKey: "",
    assetCode: "myTOKEN", tokenName: "", supply: 100, memo: "", homeDomain: "",
  };
  const strategy: CreationStrategy = { id: "test", label: "test", async buildTransactions() {
    return [{ stepId: "issuance", label: "issue", sourceAccount: issuer.publicKey(), xdr: tx.toXDR() }];
  } };
  const server = {
    serverURL: new URL("https://horizon.example"), submitTransaction,
    transactions: () => ({ transaction: () => ({ call }) }),
  } as unknown as import("stellar-sdk").Horizon.Server;
  const result = await runAssetCreation(form, new Set(["fund-accounts", "set-home-domain", "trustline"]), {
    strategy, server, networkPassphrase: Networks.PUBLIC, signal: new AbortController().signal,
    onLog: vi.fn(), onStep: vi.fn(),
  });
  expect(submitTransaction).toHaveBeenCalledOnce();
  expect(call).toHaveBeenCalledTimes(2);
  expect(result).toEqual([{ stepId: "issuance", status: "success", txHash: tx.hash().toString("hex") }]);
});
