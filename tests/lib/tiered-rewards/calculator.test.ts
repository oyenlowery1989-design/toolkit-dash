import { describe, it, expect } from "vitest";
import { estimateFeeBudget } from "../../../lib/tiered-rewards/calculator";
import type { TierAssignment, Tier, HolderEntry, RewardAsset } from "../../../lib/tiered-rewards/types";

function makeAsset(id: string): RewardAsset {
  return { id, tierId: "tier-1", assetCode: "XLM", amount: 1 };
}

function makeTier(assetCount: number): Tier {
  return {
    id: "tier-1",
    configId: "config-1",
    tierNumber: 1,
    minTokens: 0,
    position: 0,
    assets: Array.from({ length: assetCount }, (_, i) => makeAsset(`asset-${i}`)),
  };
}

function makeHolders(count: number): HolderEntry[] {
  return Array.from({ length: count }, (_, i) => ({ address: `G${i}`, balance: 1 }));
}

function makeAssignment(holderCount: number, assetCount: number): TierAssignment {
  return { tier: makeTier(assetCount), holders: makeHolders(holderCount) };
}

describe("estimateFeeBudget", () => {
  it("1 holder × 1 tier asset × feeMultiplier=1 → 1 op × 100 stroops / 1e7", () => {
    const assignments = [makeAssignment(1, 1)];
    const result = estimateFeeBudget(assignments, 1);
    expect(result).toBeCloseTo((1 * 100) / 1e7, 10);
  });

  it("sums op count across multiple assignments with different holder/asset counts", () => {
    const assignments = [makeAssignment(10, 2), makeAssignment(5, 1)];
    const totalOps = 10 * 2 + 5 * 1;
    const result = estimateFeeBudget(assignments, 1);
    expect(result).toBeCloseTo((totalOps * 100) / 1e7, 10);
  });

  it("non-integer feeMultiplier rounds (1.5 → 2)", () => {
    const assignments = [makeAssignment(1, 1)];
    const result = estimateFeeBudget(assignments, 1.5);
    expect(result).toBeCloseTo((1 * 100 * 2) / 1e7, 10);
  });

  it("feeMultiplier below 1 is floored to 1 (0.3 rounds to 0, then clamped to 1)", () => {
    const assignments = [makeAssignment(1, 1)];
    const result = estimateFeeBudget(assignments, 0.3);
    expect(result).toBeCloseTo((1 * 100 * 1) / 1e7, 10);
  });

  it("empty assignments array returns 0", () => {
    const result = estimateFeeBudget([], 1);
    expect(result).toBe(0);
  });

  it("an assignment with zero holders contributes 0 ops without error", () => {
    const assignments = [makeAssignment(0, 3), makeAssignment(2, 1)];
    const result = estimateFeeBudget(assignments, 1);
    expect(result).toBeCloseTo((2 * 100) / 1e7, 10);
  });
});
