import { Account, Keypair } from "stellar-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ loadAccount: vi.fn(), submitTransaction: vi.fn(), sign: vi.fn() }));
vi.mock("@/lib/payments-signing", () => ({ signPaymentTransaction: mocks.sign }));
vi.mock("@/lib/mainnet-submit-client", () => ({ submitMainnetTransaction: mocks.submitTransaction }));
vi.mock("stellar-sdk", async (original) => {
  const sdk = await original<typeof import("stellar-sdk")>();
  return { ...sdk, Horizon: { ...sdk.Horizon, Server: class {
    loadAccount = mocks.loadAccount;
  } } };
});

import { runBulkPayments } from "@/lib/bulk-payments/runner";

const signer = Keypair.random();
const destination = Keypair.random().publicKey();

beforeEach(() => {
  mocks.loadAccount.mockReset().mockResolvedValue(new Account(signer.publicKey(), "1"));
  mocks.submitTransaction.mockReset().mockResolvedValue({ hash: "submitted-hash" });
  mocks.sign.mockReset().mockImplementation(async (tx) => {
    expect(tx.signatures).toHaveLength(0);
    tx.sign(signer);
    return tx;
  });
});

describe("Bulk Payments connected wallet", () => {
  it("signs an unsigned batch through the saved wallet and submits it", async () => {
    const onBatchUpdate = vi.fn();
    await runBulkPayments({
      horizonUrl: "https://horizon.stellar.org", network: "public", secretKey: "",
      walletId: "wallet-1", walletAddress: signer.publicKey(),
      recipients: [destination], memo: "", signal: new AbortController().signal, onBatchUpdate,
    });
    expect(mocks.sign).toHaveBeenCalledWith(expect.anything(), "wallet-1", "");
    expect(mocks.submitTransaction).toHaveBeenCalledOnce();
    expect(onBatchUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ status: "success" }));
  });

  it("never submits when saved-wallet signing fails", async () => {
    mocks.sign.mockRejectedValue(new Error("Saved wallet is watch-only"));
    const onBatchUpdate = vi.fn();
    await runBulkPayments({
      horizonUrl: "https://horizon.stellar.org", network: "public", secretKey: "",
      walletId: "wallet-1", walletAddress: signer.publicKey(),
      recipients: [destination], memo: "", signal: new AbortController().signal, onBatchUpdate,
    });
    expect(mocks.submitTransaction).not.toHaveBeenCalled();
    expect(onBatchUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ status: "failed", error: "Saved wallet is watch-only" }));
  });
});
