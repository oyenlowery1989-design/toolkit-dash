import { Account, Asset, Keypair } from "stellar-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ loadAccount: vi.fn(), submitTransaction: vi.fn(), sign: vi.fn(), lookup: vi.fn() }));
vi.mock("@/lib/payments-signing", () => ({ signPaymentTransaction: mocks.sign }));
vi.mock("@/lib/mainnet-submit-client", () => ({ submitMainnetTransaction: mocks.submitTransaction }));
vi.mock("stellar-sdk", async (original) => {
  const sdk = await original<typeof import("stellar-sdk")>();
  return { ...sdk, Horizon: { ...sdk.Horizon, Server: class {
    loadAccount = mocks.loadAccount;
    transactions = () => ({ transaction: () => ({ call: mocks.lookup }) });
  } } };
});

import { runBulkPayments, reconcileBulkBatch } from "@/lib/bulk-payments/runner";

const signer = Keypair.random();
const destination = Keypair.random().publicKey();

beforeEach(() => {
  mocks.loadAccount.mockReset().mockResolvedValue(new Account(signer.publicKey(), "1"));
  mocks.submitTransaction.mockReset().mockResolvedValue({ hash: "submitted-hash" });
  mocks.lookup.mockReset().mockRejectedValue(new Error("Not found"));
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

it("reconciles an accepted payment whose submission response was lost", async () => {
  mocks.submitTransaction.mockRejectedValue(new Error("connection reset"));
  mocks.lookup.mockResolvedValue({ successful: true });
  const updates = vi.fn();
  await runBulkPayments({ horizonUrl: "https://horizon.stellar.org", network: "public", secretKey: signer.secret(), recipients: [destination], memo: "", signal: new AbortController().signal, onBatchUpdate: updates });
  expect(updates).toHaveBeenLastCalledWith(expect.objectContaining({ status: "success", txHash: expect.any(String), signedXdr: expect.any(String) }));
});

it("retains an unresolved signed payment instead of making it retryable", async () => {
  mocks.submitTransaction.mockRejectedValue(new Error("connection reset"));
  const updates = vi.fn();
  await runBulkPayments({ horizonUrl: "https://horizon.stellar.org", network: "public", secretKey: signer.secret(), recipients: [destination], memo: "", signal: new AbortController().signal, onBatchUpdate: updates });
  expect(updates).toHaveBeenLastCalledWith(expect.objectContaining({ status: "uncertain", txHash: expect.any(String), signedXdr: expect.any(String) }));
});

it("stops before broadcasting when the durable checkpoint fails", async () => {
  const updates = vi.fn();
  const checkpoint = vi.fn().mockRejectedValue(new Error("Journal unavailable"));
  await runBulkPayments({
    horizonUrl: "https://horizon.stellar.org", network: "public", secretKey: signer.secret(),
    recipients: [destination, Keypair.random().publicKey()], batchSize: 1, memo: "", signal: new AbortController().signal,
    onBatchUpdate: updates, onBeforeSubmit: checkpoint,
  });
  expect(checkpoint).toHaveBeenCalledWith(expect.objectContaining({ status: "uncertain", txHash: expect.stringMatching(/^[0-9a-f]{64}$/) }));
  expect(mocks.submitTransaction).not.toHaveBeenCalled();
  expect(checkpoint).toHaveBeenCalledTimes(1);
  expect(updates).toHaveBeenCalledWith(expect.objectContaining({ batchIndex: 0, status: "failed", error: expect.stringContaining("Journal unavailable") }));
  expect(updates).toHaveBeenLastCalledWith(expect.objectContaining({ batchIndex: 1, status: "failed", error: expect.stringContaining("Not submitted") }));
});

it("does not broadcast when Stop occurs while saving the checkpoint", async () => {
  const abort = new AbortController();
  const updates = vi.fn();
  await runBulkPayments({ horizonUrl: "https://horizon.stellar.org", network: "public", secretKey: signer.secret(),
    recipients: [destination], memo: "", signal: abort.signal, onBatchUpdate: updates,
    onBeforeSubmit: async () => { await Promise.resolve(); abort.abort(); },
  });
  expect(mocks.submitTransaction).not.toHaveBeenCalled();
  expect(updates).toHaveBeenLastCalledWith(expect.objectContaining({ status: "failed", error: "Aborted — not submitted" }));
});

it("keeps tx_bad_seq unresolved until its original hash is checked on the ledger", async () => {
  mocks.submitTransaction.mockRejectedValue({ response: { status: 400, data: { extras: { result_codes: { transaction: "tx_bad_seq" } } } } });
  const updates = vi.fn();
  await runBulkPayments({ horizonUrl: "https://horizon.stellar.org", network: "public", secretKey: signer.secret(), recipients: [destination], memo: "", signal: new AbortController().signal, onBatchUpdate: updates });
  expect(updates).toHaveBeenLastCalledWith(expect.objectContaining({ status: "uncertain", txHash: expect.any(String) }));
});

it("never reports a ghost policy rejection as ledger inclusion", async () => {
  mocks.submitTransaction.mockRejectedValue({ response: { status: 403, data: { error: "Policy denied" } } });
  const updates = vi.fn();
  await runBulkPayments({ horizonUrl: "https://horizon.stellar.org", network: "public", secretKey: signer.secret(), recipients: [destination], asset: new Asset("GHOST", signer.publicKey()), ghost: true, memo: "", signal: new AbortController().signal, onBatchUpdate: updates });
  expect(updates).toHaveBeenLastCalledWith(expect.objectContaining({ status: "failed" }));
});

it("refuses native ghost payments even if a stale preview says underfunded", async () => {
  const updates = vi.fn();
  await runBulkPayments({ horizonUrl: "https://horizon.stellar.org", network: "public", secretKey: signer.secret(), recipients: [destination], amount: "11", ghost: true, memo: "", signal: new AbortController().signal, onBatchUpdate: updates });
  expect(mocks.submitTransaction).not.toHaveBeenCalled();
  expect(updates).toHaveBeenLastCalledWith(expect.objectContaining({ status: "failed" }));
});

it("only records failed ghost transactions after ledger confirmation", async () => {
  mocks.submitTransaction.mockRejectedValue({ response: { data: { extras: { result_codes: { transaction: "tx_failed" } } } } });
  mocks.lookup.mockResolvedValue({ successful: false });
  const updates = vi.fn();
  await runBulkPayments({ horizonUrl: "https://horizon.stellar.org", network: "public", secretKey: signer.secret(), recipients: [destination], asset: new Asset("GHOST", signer.publicKey()), ghost: true, memo: "", signal: new AbortController().signal, onBatchUpdate: updates });
  expect(updates).toHaveBeenLastCalledWith(expect.objectContaining({ status: "success", txHash: expect.any(String) }));
});

it("reconciles a delayed ledger result without submitting again", async () => {
  mocks.lookup.mockResolvedValue({ successful: true });
  const result = await reconcileBulkBatch("https://horizon.stellar.org", { batchIndex: 0, count: 1, status: "uncertain", txHash: "hash", signedXdr: "envelope" });
  expect(result).toMatchObject({ status: "success", txHash: "hash", signedXdr: "envelope" });
  expect(mocks.submitTransaction).not.toHaveBeenCalled();
});

it("does not turn a mid-submission abort into a retryable payment", async () => {
  const abort = new AbortController();
  mocks.submitTransaction.mockImplementation(async () => { abort.abort(); throw new Error("response lost"); });
  const updates = vi.fn();
  await runBulkPayments({ horizonUrl: "https://horizon.stellar.org", network: "public", secretKey: signer.secret(), recipients: [destination, destination], batchSize: 1, memo: "", signal: abort.signal, onBatchUpdate: updates });
  expect(updates.mock.calls.map(([row]) => row)).toContainEqual(expect.objectContaining({ batchIndex: 0, status: "uncertain", signedXdr: expect.any(String) }));
  expect(updates).toHaveBeenLastCalledWith(expect.objectContaining({ batchIndex: 1, status: "failed", error: expect.stringContaining("Not submitted") }));
  expect(mocks.submitTransaction).toHaveBeenCalledTimes(1);
});
