import { describe, it, expect } from "vitest";
import { computeFingerprints } from "@/lib/tracer-v2/fingerprint";
import type { AssetGroup } from "@/lib/asset-groups/types";

function grp(id: string, network: string, members: Array<[string, string, string?]>): AssetGroup {
  return {
    id, name: `G${id}`, network, createdAt: 0, updatedAt: 0,
    members: members.map(([address, role, homeDomain], i) => ({
      id: `${id}-${i}`, groupId: id, address, role: role as any,
      homeDomain, addedAt: 0,
    })),
  };
}

describe("computeFingerprints", () => {
  it("returns empty when fewer than 2 groups", () => {
    expect(computeFingerprints({ groups: [grp("1", "public", [])], analyses: [], creatorChildren: [] })).toEqual([]);
  });

  it("short-circuits to 100/confirmed when issuer shared both sides", () => {
    const a = grp("1", "public", [["GISS", "issuer"]]);
    const b = grp("2", "public", [["GISS", "issuer"]]);
    const [m] = computeFingerprints({ groups: [a, b], analyses: [], creatorChildren: [] });
    expect(m.score).toBe(100);
    expect(m.tier).toBe("confirmed");
    expect(m.shortCircuit).toBe(true);
  });

  it("does NOT pair groups on different networks", () => {
    const a = grp("1", "public", [["GISS", "issuer"]]);
    const b = grp("2", "testnet", [["GISS", "issuer"]]);
    expect(computeFingerprints({ groups: [a, b], analyses: [], creatorChildren: [] })).toEqual([]);
  });

  it("a single low-weight shared 'other' address scores <=25 (hidden by default)", () => {
    const a = grp("1", "public", [["GX", "other"]]);
    const b = grp("2", "public", [["GX", "other"]]);
    const res = computeFingerprints({ groups: [a, b], analyses: [], creatorChildren: [] });
    // 0.15 weight → score 15 → below MIN_SCORE_DEFAULT 25 → filtered out
    expect(res).toEqual([]);
  });

  it("dampens an address that appears in many groups", () => {
    // GX is 'intermediary' (0.5) but present in 8 groups → damp(8)=0.33 → 0.5*0.33≈0.165
    const groups = Array.from({ length: 8 }, (_, i) => grp(String(i), "public", [["GX", "intermediary"]]));
    const res = computeFingerprints({ groups, analyses: [], creatorChildren: [], minScore: 0 });
    const pair = res.find(m => m.groupAId === "0" && m.groupBId === "1")!;
    expect(pair.score).toBeLessThan(25);
  });

  it("two independent moderate signals compound (prob-OR, diminishing)", () => {
    // shared intermediary (0.5) + shared home domain (0.35) between exactly 2 groups
    const a = grp("1", "public", [["GI", "intermediary", "acme.com"], ["GD", "distributor", "acme.com"]]);
    const b = grp("2", "public", [["GI", "intermediary", "acme.com"]]);
    const [m] = computeFingerprints({ groups: [a, b], analyses: [], creatorChildren: [], minScore: 0 });
    // 1 - (1-0.5)(1-0.35) = 1 - 0.325 = 0.675 → ~68 (dedup: GI counted once at its max weight 0.5)
    expect(m.score).toBeGreaterThanOrEqual(60);
    expect(m.score).toBeLessThan(80);
    expect(m.tier).toBe("moderate");
  });

  it("ignores wallet-service home domains (lobstr.co is not operator evidence)", () => {
    // Two groups whose ONLY link is a shared lobstr.co home domain — must not correlate.
    const a = grp("1", "public", [["GA1", "destination", "lobstr.co"]]);
    const b = grp("2", "public", [["GB1", "destination", "lobstr.co"]]);
    const res = computeFingerprints({ groups: [a, b], analyses: [], creatorChildren: [], minScore: 0 });
    const pair = res.find((m) => m.groupAId === "1" && m.groupBId === "2");
    // No shared-domain evidence should be emitted for lobstr.co.
    expect(pair?.evidence.some((e) => e.signal === "shared-domain")).not.toBe(true);
  });

  it("still scores a shared PROJECT home domain (non-wallet domain)", () => {
    const a = grp("1", "public", [["GA1", "bank", "acme-project.io"]]);
    const b = grp("2", "public", [["GB1", "bank", "acme-project.io"]]);
    const [m] = computeFingerprints({ groups: [a, b], analyses: [], creatorChildren: [], minScore: 0 });
    expect(m.evidence.some((e) => e.signal === "shared-domain")).toBe(true);
  });
});
