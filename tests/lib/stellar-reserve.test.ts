import { describe, it, expect } from "vitest";
import { calcAvailableXlm, type RawHorizonAccount } from "@/lib/stellar-reserve";

function makeAccount(overrides: Partial<RawHorizonAccount> = {}): RawHorizonAccount {
  return {
    subentry_count: 0,
    num_sponsoring: 0,
    num_sponsored: 0,
    balances: [{ asset_type: "native", balance: "100.0000000" }],
    ...overrides,
  };
}

describe("calcAvailableXlm", () => {
  it("base reserve only (no subentries)", () => {
    const result = calcAvailableXlm(makeAccount());
    expect(result.total).toBe(100);
    expect(result.reserved).toBe(1.0); // (2 + 0) * 0.5
    expect(result.available).toBeCloseTo(99, 7);
  });

  it("adds 0.5 XLM reserve per subentry (trustline/offer/signer)", () => {
    const result = calcAvailableXlm(makeAccount({ subentry_count: 3 }));
    expect(result.reserved).toBe(2.5); // (2 + 3) * 0.5
    expect(result.available).toBeCloseTo(97.5, 7);
  });

  it("sponsoring increases reserve, sponsored decreases it", () => {
    const result = calcAvailableXlm(
      makeAccount({ num_sponsoring: 2, num_sponsored: 1 }),
    );
    // reserved = (2+0)*0.5 + 2*0.5 - 1*0.5 = 1.0 + 1.0 - 0.5 = 1.5
    expect(result.reserved).toBe(1.5);
    expect(result.available).toBeCloseTo(98.5, 7);
  });

  it("subtracts native selling_liabilities from available", () => {
    const result = calcAvailableXlm(
      makeAccount({
        balances: [
          { asset_type: "native", balance: "100.0000000", selling_liabilities: "10.0000000" },
        ],
      }),
    );
    expect(result.total).toBe(100);
    expect(result.reserved).toBe(1.0);
    expect(result.available).toBeCloseTo(89, 7);
  });

  it("clamps available to 0 when reserve + liabilities exceed balance", () => {
    const result = calcAvailableXlm(
      makeAccount({
        subentry_count: 10,
        balances: [
          { asset_type: "native", balance: "1.0000000", selling_liabilities: "5.0000000" },
        ],
      }),
    );
    expect(result.available).toBe(0);
  });

  it("returns total 0 when no native balance entry exists", () => {
    const result = calcAvailableXlm(makeAccount({ balances: [] }));
    expect(result.total).toBe(0);
    expect(result.available).toBe(0);
  });
});
