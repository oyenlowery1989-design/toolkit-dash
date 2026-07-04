import { describe, it, expect } from "vitest";
import { withAccountLock, isBadSeq } from "../stellar-submit";

describe("withAccountLock", () => {
  it("serializes calls for same key", async () => {
    const order: number[] = [];
    const slow = withAccountLock("G1", async () => {
      await new Promise((r) => setTimeout(r, 30));
      order.push(1);
    });
    const fast = withAccountLock("G1", async () => { order.push(2); });
    await Promise.all([slow, fast]);
    expect(order).toEqual([1, 2]);
  });

  it("does not serialize different keys", async () => {
    const order: number[] = [];
    const a = withAccountLock("G1", async () => {
      await new Promise((r) => setTimeout(r, 30));
      order.push(1);
    });
    const b = withAccountLock("G2", async () => { order.push(2); });
    await Promise.all([a, b]);
    expect(order).toEqual([2, 1]);
  });

  it("releases lock after a throwing fn", async () => {
    await expect(withAccountLock("G1", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(withAccountLock("G1", async () => 42)).resolves.toBe(42);
  });
});

describe("isBadSeq", () => {
  it("detects horizon tx_bad_seq shape", () => {
    expect(isBadSeq({ response: { data: { extras: { result_codes: { transaction: "tx_bad_seq" } } } } })).toBe(true);
    expect(isBadSeq(new Error("random"))).toBe(false);
  });
});
