import { describe, it, expect } from "vitest";
import { assetKey, groupSnapshots, comparableGroups, diffSnapshots } from "@/lib/saved-analyses/diff";
import type { SavedAnalysis } from "@/hooks/use-saved-analyses";
import type { AssetProceedsResult, DestinationSummary } from "@/lib/proceeds-investigator/types";

function dest(address: string, totalXlm: number, count = 1): DestinationSummary {
  return { address, totalXlm, count };
}

function result(overrides: Partial<AssetProceedsResult> = {}): AssetProceedsResult {
  return {
    assetCode: "FOO",
    issuer: "GISSUER",
    accounts: ["GDIST"],
    totalAssetSold: 100,
    totalXlmProceeds: 1000,
    totalOutgoingXlm: 800,
    estimatedOnHandXlm: 200,
    dexTradeCount: 1,
    pathSaleCount: 0,
    proceedsLedger: [],
    outgoingLedger: [],
    topDestinations: [],
    ...overrides,
  };
}

function snap(overrides: Partial<SavedAnalysis> = {}): SavedAnalysis {
  return {
    id: "1",
    name: "FOO",
    assetCode: "FOO",
    issuer: "GISSUER",
    distribAddresses: ["GDIST"],
    network: "public",
    timestamp: 1000,
    result: result(),
    ...overrides,
  };
}

describe("assetKey", () => {
  it("joins code+issuer+network, case-sensitive", () => {
    expect(assetKey({ assetCode: "FOO", issuer: "GX", network: "public" })).toBe("FOO:GX:public");
    expect(assetKey({ assetCode: "foo", issuer: "GX", network: "public" })).not.toBe(
      assetKey({ assetCode: "FOO", issuer: "GX", network: "public" }),
    );
  });
});

describe("groupSnapshots", () => {
  it("groups by asset identity and sorts each group newest-first", () => {
    const a = snap({ id: "a", timestamp: 1000 });
    const b = snap({ id: "b", timestamp: 2000 });
    const c = snap({ id: "c", assetCode: "BAR", timestamp: 1500 });
    const groups = groupSnapshots([a, b, c]);
    expect(groups.size).toBe(2);
    expect(groups.get(assetKey(a))?.map((s) => s.id)).toEqual(["b", "a"]);
    expect(groups.get(assetKey(c))?.map((s) => s.id)).toEqual(["c"]);
  });
});

describe("comparableGroups", () => {
  it("only returns groups with 2+ snapshots", () => {
    const a = snap({ id: "a", timestamp: 1000 });
    const b = snap({ id: "b", timestamp: 2000 });
    const c = snap({ id: "c", assetCode: "BAR", timestamp: 1500 });
    const result = comparableGroups([a, b, c]);
    expect(result).toHaveLength(1);
    expect(result[0].snapshots.map((s) => s.id)).toEqual(["b", "a"]);
  });

  it("returns empty when no asset has 2+ snapshots", () => {
    expect(comparableGroups([snap({ id: "a" })])).toEqual([]);
  });
});

describe("diffSnapshots", () => {
  it("computes field deltas older -> newer", () => {
    const older = snap({ timestamp: 1000, result: result({ totalXlmProceeds: 1000, estimatedOnHandXlm: 200 }) });
    const newer = snap({ timestamp: 2000, result: result({ totalXlmProceeds: 2000, estimatedOnHandXlm: 300 }) });
    const diff = diffSnapshots(older, newer);
    const proceeds = diff.fields.find((f) => f.key === "totalXlmProceeds")!;
    expect(proceeds).toMatchObject({ before: 1000, after: 2000, delta: 1000 });
    const onHand = diff.fields.find((f) => f.key === "estimatedOnHandXlm")!;
    expect(onHand).toMatchObject({ before: 200, after: 300, delta: 100 });
  });

  it("defensively swaps when passed out of chronological order", () => {
    const early = snap({ timestamp: 1000, result: result({ totalXlmProceeds: 1000 }) });
    const late = snap({ timestamp: 2000, result: result({ totalXlmProceeds: 2000 }) });
    const diff = diffSnapshots(late, early); // passed newer, older
    const proceeds = diff.fields.find((f) => f.key === "totalXlmProceeds")!;
    expect(proceeds).toMatchObject({ before: 1000, after: 2000, delta: 1000 });
  });

  it("marks a destination absent before as 'new'", () => {
    const older = snap({ timestamp: 1000, result: result({ topDestinations: [] }) });
    const newer = snap({ timestamp: 2000, result: result({ topDestinations: [dest("GNEW", 500)] }) });
    const diff = diffSnapshots(older, newer);
    expect(diff.destinations).toEqual([
      { address: "GNEW", kind: "new", beforeXlm: 0, afterXlm: 500, deltaXlm: 500, beforeCount: 0, afterCount: 1 },
    ]);
  });

  it("marks a destination absent after as 'dropped'", () => {
    const older = snap({ timestamp: 1000, result: result({ topDestinations: [dest("GOLD", 300)] }) });
    const newer = snap({ timestamp: 2000, result: result({ topDestinations: [] }) });
    const diff = diffSnapshots(older, newer);
    expect(diff.destinations).toEqual([
      { address: "GOLD", kind: "dropped", beforeXlm: 300, afterXlm: 0, deltaXlm: -300, beforeCount: 1, afterCount: 0 },
    ]);
  });

  it("marks increased and decreased destinations, sorted by |delta| desc", () => {
    const older = snap({
      timestamp: 1000,
      result: result({ topDestinations: [dest("GUP", 100), dest("GDOWN", 900)] }),
    });
    const newer = snap({
      timestamp: 2000,
      result: result({ topDestinations: [dest("GUP", 1100), dest("GDOWN", 850)] }),
    });
    const diff = diffSnapshots(older, newer);
    expect(diff.destinations.map((d) => d.address)).toEqual(["GUP", "GDOWN"]);
    expect(diff.destinations[0]).toMatchObject({ kind: "increased", deltaXlm: 1000 });
    expect(diff.destinations[1]).toMatchObject({ kind: "decreased", deltaXlm: -50 });
  });

  it("skips unchanged destinations", () => {
    const older = snap({ timestamp: 1000, result: result({ topDestinations: [dest("GSAME", 200)] }) });
    const newer = snap({ timestamp: 2000, result: result({ topDestinations: [dest("GSAME", 200)] }) });
    expect(diffSnapshots(older, newer).destinations).toEqual([]);
  });

  it("handles empty topDestinations on both sides", () => {
    const older = snap({ timestamp: 1000, result: result({ topDestinations: [] }) });
    const newer = snap({ timestamp: 2000, result: result({ topDestinations: [] }) });
    expect(diffSnapshots(older, newer).destinations).toEqual([]);
  });
});
