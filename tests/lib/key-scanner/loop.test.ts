import { afterEach, expect, it, vi } from "vitest";

const checkAccount = vi.hoisted(() => vi.fn());
vi.mock("@/lib/key-scanner/engine", () => ({
  generateKeypair: () => ({ publicKey: "GTEST", secretKey: "STEST" }),
  checkAccount,
}));
vi.mock("@/lib/db", () => ({ getDb: () => ({ prepare: () => ({ run: () => ({ changes: 1 }) }) }) }));

import { startKeyScanLoopRun, stopKeyScanLoopRun, updateKeyScanConfig } from "@/lib/key-scanner/loop";

afterEach(() => {
  stopKeyScanLoopRun();
  vi.useRealTimers();
  delete global._keyScanLoop;
  checkAccount.mockReset();
});

it("does not duplicate workers when concurrency shrinks and immediately grows", async () => {
  vi.useFakeTimers();
  checkAccount.mockImplementation((_url, _key, signal: AbortSignal) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  }));
  updateKeyScanConfig({ concurrency: 3, pacedRps: 10 });
  startKeyScanLoopRun();
  await vi.advanceTimersByTimeAsync(250);
  expect(checkAccount).toHaveBeenCalledTimes(3);

  updateKeyScanConfig({ concurrency: 1 });
  updateKeyScanConfig({ concurrency: 3 });
  await vi.advanceTimersByTimeAsync(500);
  expect(checkAccount).toHaveBeenCalledTimes(3);
});

it("discards a result that arrives after the run was stopped", async () => {
  vi.useFakeTimers();
  let complete!: (result: { status: "not-found" }) => void;
  checkAccount.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
  updateKeyScanConfig({ concurrency: 1, pacedRps: 10 });
  startKeyScanLoopRun();
  await vi.advanceTimersByTimeAsync(1);
  stopKeyScanLoopRun();
  complete({ status: "not-found" });
  await vi.advanceTimersByTimeAsync(1);
  expect(global._keyScanLoop?.totalGenerated).toBe(0);
  expect(global._keyScanLoop?.totalNotFound).toBe(0);
});
