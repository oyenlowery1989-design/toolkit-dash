import { describe, it, expect } from "vitest";
import { calcAmount, calcAmounts, skipReason, extractError } from "@/lib/auto-send/runner";
import type { AutoSendDestination } from "@/lib/auto-send/types";

function dest(overrides: Partial<AutoSendDestination> & { id: string }): AutoSendDestination {
  return {
    groupId: "g1",
    destination: `D${overrides.id}`,
    percentage: 0,
    isRemainder: false,
    minThreshold: 0,
    maxCap: 0,
    paused: false,
    position: 0,
    ...overrides,
  };
}

describe("calcAmount", () => {
  it("computes a basic percentage share", () => {
    expect(calcAmount(1000, 25)).toBe(250);
  });

  it("floors to 7 decimal places", () => {
    // 100 * (33.3333333 / 100) = 33.3333333 exactly at 7dp; use a value that would produce more digits.
    // 10 * (1/3 %) → 10 * 0.0033333... = 0.033333... → floored to 0.0333333
    expect(calcAmount(10, 1 / 3)).toBe(0.0333333);
  });

  it("returns 0 for 0%", () => {
    expect(calcAmount(1000, 0)).toBe(0);
  });

  it("returns the full spendable for 100%", () => {
    expect(calcAmount(1000, 100)).toBe(1000);
  });
});

describe("calcAmounts", () => {
  it("gives each fixed-% destination its exact share (sum < 100%, no remainder)", () => {
    const amounts = calcAmounts(1000, [
      dest({ id: "a", percentage: 30 }),
      dest({ id: "b", percentage: 20 }),
    ]);
    expect(amounts.get("a")).toBe(300);
    expect(amounts.get("b")).toBe(200);
  });

  it("gives a remainder destination the leftover after fixed-% destinations", () => {
    const amounts = calcAmounts(1000, [
      dest({ id: "a", percentage: 30 }),
      dest({ id: "rem", isRemainder: true }),
    ]);
    expect(amounts.get("a")).toBe(300);
    // leftover = 1000 - 300 = 700
    expect(amounts.get("rem")).toBe(700);
  });

  it("splits leftover EQUALLY among multiple remainder destinations", () => {
    const amounts = calcAmounts(1000, [
      dest({ id: "a", percentage: 40 }),
      dest({ id: "r1", isRemainder: true }),
      dest({ id: "r2", isRemainder: true }),
    ]);
    expect(amounts.get("a")).toBe(400);
    // leftover = 600, split across 2 → 300 each
    expect(amounts.get("r1")).toBe(300);
    expect(amounts.get("r2")).toBe(300);
  });

  it("clamps a fixed-% destination to maxCap AND redistributes the surplus into the remainder pool", () => {
    const amounts = calcAmounts(1000, [
      dest({ id: "capped", percentage: 50, maxCap: 100 }),
      dest({ id: "rem", isRemainder: true }),
    ]);
    // uncapped = 500, clamped to 100 → surplus of 400
    expect(amounts.get("capped")).toBe(100);
    // leftover = (1000 - 100) + surplus 400 = 1300 → all to the single remainder
    expect(amounts.get("rem")).toBe(1300);
  });

  it("clamps a remainder destination to its own maxCap", () => {
    const amounts = calcAmounts(1000, [
      dest({ id: "a", percentage: 30 }),
      dest({ id: "rem", isRemainder: true, maxCap: 500 }),
    ]);
    // leftover would be 700, but capped to 500
    expect(amounts.get("rem")).toBe(500);
  });

  it("excludes paused destinations entirely from the returned map and from fixedTotal", () => {
    const amounts = calcAmounts(1000, [
      dest({ id: "a", percentage: 30 }),
      dest({ id: "paused", percentage: 40, paused: true }),
      dest({ id: "rem", isRemainder: true }),
    ]);
    expect(amounts.has("paused")).toBe(false);
    expect(amounts.get("a")).toBe(300);
    // paused's 40% is NOT reserved → remainder gets 1000 - 300 = 700
    expect(amounts.get("rem")).toBe(700);
  });

  it("does not distribute stranded leftover when there is no remainder destination", () => {
    const amounts = calcAmounts(1000, [
      dest({ id: "a", percentage: 30 }),
      dest({ id: "b", percentage: 20 }),
    ]);
    // 50% (500 XLM) is stranded — no entry created for it
    expect(amounts.get("a")).toBe(300);
    expect(amounts.get("b")).toBe(200);
    expect(amounts.size).toBe(2);
  });
});

describe("skipReason", () => {
  it("returns 'Paused' first, even when the amount would otherwise be fine", () => {
    expect(skipReason(1000, 500, 0, true)).toBe("Paused");
  });

  it("returns a too-low message mentioning the spendable when amount <= 0", () => {
    const reason = skipReason(5, 0, 0, false);
    expect(reason).toContain("5.0000000");
    expect(reason).toContain("too low");
  });

  it("returns a threshold message when amount is below minThreshold", () => {
    const reason = skipReason(1000, 5, 10, false);
    expect(reason).toContain("10");
    expect(reason).toMatch(/threshold/i);
  });

  it("returns undefined when amount is fine, not paused, and threshold is 0", () => {
    expect(skipReason(1000, 500, 0, false)).toBeUndefined();
  });

  it("returns undefined when amount meets the threshold", () => {
    expect(skipReason(1000, 10, 10, false)).toBeUndefined();
  });
});

describe("extractError", () => {
  it("extracts Stellar result_codes from a 400-style error object", () => {
    const err = {
      response: {
        data: {
          extras: {
            result_codes: { transaction: "tx_failed", operations: ["op_underfunded"] },
          },
        },
      },
    };
    const msg = extractError(err);
    expect(msg).toContain("tx_failed");
    expect(msg).toContain("op_underfunded");
  });

  it("falls back to the Error message", () => {
    expect(extractError(new Error("boom"))).toBe("boom");
  });

  it("stringifies a non-Error non-object value", () => {
    expect(extractError("plain string thrown")).toBe("plain string thrown");
    expect(extractError(42)).toBe("42");
  });
});
