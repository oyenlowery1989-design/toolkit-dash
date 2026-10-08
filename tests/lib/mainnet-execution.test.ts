import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from "stellar-sdk";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ submit: vi.fn(), reserve: vi.fn(), read: vi.fn(), finish: vi.fn(), load: vi.fn(), lease: vi.fn() }));
vi.mock("@/lib/execution-context", () => ({ assertExecutionLease: state.lease }));
vi.mock("@/lib/transaction-budget", () => ({ reserveExecution: state.reserve, readExecution: state.read, finishExecution: state.finish }));
vi.mock("stellar-sdk", async (importOriginal) => {
  const sdk = await importOriginal<typeof import("stellar-sdk")>();
  return { ...sdk, Horizon: { ...sdk.Horizon, Server: class { submitTransaction = state.submit; loadAccount = state.load; } } };
});
import { executeMainnetTransaction } from "@/lib/mainnet-execution";
const signer = Keypair.random(), target = Keypair.random().publicKey();
function tx() {
  const tx = new TransactionBuilder(new Account(signer.publicKey(), "1"), { fee: "100", networkPassphrase: Networks.PUBLIC })
    .addOperation(Operation.payment({ destination: target, asset: Asset.native(), amount: "1" })).setTimeout(30).build();
  tx.sign(signer); return tx;
}
beforeEach(() => {
  vi.stubEnv("MAINNET_TRANSACTIONS_ENABLED", "true"); vi.stubEnv("MAINNET_EMERGENCY_STOP", "false"); vi.stubEnv("MAINNET_ALLOWED_DESTINATIONS", "");
  state.submit.mockReset().mockResolvedValue({ hash: "confirmed" });
  state.lease.mockReset().mockResolvedValue(undefined);
  state.reserve.mockReset().mockResolvedValue(true); state.finish.mockReset().mockResolvedValue(undefined);
  state.read.mockReset().mockResolvedValue({ status: "reserved" });
  state.load.mockReset().mockResolvedValue({ signers: [{ key: signer.publicKey(), weight: 1 }], thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 } });
});
afterEach(() => vi.unstubAllEnvs());
it.each([["false", "false"], ["true", "true"]])("blocks disabled/stopped execution before network use", async (enabled, stopped) => {
  vi.stubEnv("MAINNET_TRANSACTIONS_ENABLED", enabled); vi.stubEnv("MAINNET_EMERGENCY_STOP", stopped);
  await expect(executeMainnetTransaction(tx())).rejects.toThrow();
  expect(state.submit).not.toHaveBeenCalled(); expect(state.reserve).not.toHaveBeenCalled(); expect(state.load).not.toHaveBeenCalled();
});
it("reserves before submitting and records confirmed execution", async () => {
  await executeMainnetTransaction(tx());
  expect(state.reserve.mock.invocationCallOrder[0]).toBeLessThan(state.submit.mock.invocationCallOrder[0]);
  expect(state.finish).toHaveBeenCalledWith(expect.any(String), "submitted", { hash: "confirmed" });
});
it("does not submit if durable budget reservation fails", async () => {
  state.reserve.mockRejectedValue(new Error("budget exhausted"));
  await expect(executeMainnetTransaction(tx())).rejects.toThrow("exhausted"); expect(state.submit).not.toHaveBeenCalled();
});
it("revalidates lease ownership after reservation and releases an unsubmitted hold", async () => {
  state.lease.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("lease changed"));
  await expect(executeMainnetTransaction(tx())).rejects.toThrow("lease changed");
  expect(state.submit).not.toHaveBeenCalled();
  expect(state.finish).toHaveBeenCalledWith(expect.any(String), "rejected", undefined, 0n);
});
it("keeps unknown outcomes held and refuses to replay them", async () => {
  state.submit.mockRejectedValue(new Error("timeout"));
  await expect(executeMainnetTransaction(tx())).rejects.toThrow("timeout");
  expect(state.finish).toHaveBeenCalledWith(expect.any(String), "unknown", undefined, undefined);
  state.reserve.mockResolvedValue(false); state.read.mockResolvedValue({ status: "unknown" }); state.submit.mockClear();
  await expect(executeMainnetTransaction(tx())).rejects.toThrow("reconcile"); expect(state.submit).not.toHaveBeenCalled();
});
it("does not describe a post-submission accounting failure as safely retryable", async () => {
  state.finish.mockRejectedValue(new Error("disk full"));
  await expect(executeMainnetTransaction(tx())).rejects.toThrow("was submitted but accounting failed"); expect(state.submit).toHaveBeenCalledOnce();
});
it("returns the same confirmed result on exact replay without submitting twice", async () => {
  state.reserve.mockResolvedValue(false); state.read.mockResolvedValue({ status: "submitted", result_json: '{"hash":"confirmed"}' });
  await expect(executeMainnetTransaction(tx())).resolves.toEqual({ hash: "confirmed" }); expect(state.submit).not.toHaveBeenCalled();
});
