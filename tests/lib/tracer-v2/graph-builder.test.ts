import { describe, it, expect } from "vitest";
import { buildGraph } from "@/lib/tracer-v2/graph-builder";
import type { AssetGroup, GroupMemberRole } from "@/lib/asset-groups/types";
import type { CreatorChild } from "@/lib/intermediary-tracer/types";
import type { SavedAnalysis } from "@/hooks/use-saved-analyses";
import type { AssetProceedsResult } from "@/lib/proceeds-investigator/types";
import type { GraphInput } from "@/lib/tracer-v2/types";

function grp(
  id: string,
  network: string,
  members: Array<[string, GroupMemberRole]>,
): AssetGroup {
  return {
    id,
    name: `G${id}`,
    network,
    createdAt: 0,
    updatedAt: 0,
    members: members.map(([address, role], i) => ({
      id: `${id}-${i}`,
      groupId: id,
      address,
      role,
      addedAt: 0,
    })),
  };
}

function child(
  creatorAddress: string,
  childAddress: string,
  network: string,
  viaIntermediary?: string,
): CreatorChild {
  return {
    id: `${creatorAddress}-${childAddress}`,
    creatorAddress,
    childAddress,
    network,
    viaIntermediary,
    discoveredAt: 0,
  };
}

function mkAnalysis(
  id: string,
  assetCode: string,
  issuer: string,
  distribAddresses: string[],
  network: string,
  topDestinations: { address: string; totalXlm: number; count: number }[],
): SavedAnalysis {
  const result: AssetProceedsResult = {
    assetCode,
    issuer,
    accounts: distribAddresses,
    totalAssetSold: 0,
    totalXlmProceeds: 0,
    totalOutgoingXlm: 0,
    estimatedOnHandXlm: 0,
    dexTradeCount: 0,
    pathSaleCount: 0,
    proceedsLedger: [],
    outgoingLedger: [],
    topDestinations,
  };
  return {
    id,
    name: `A${id}`,
    assetCode,
    issuer,
    distribAddresses,
    network,
    timestamp: 0,
    result,
  };
}

const emptyInput: GraphInput = {
  groups: [],
  knownIntermediaries: [],
  knownCreators: [],
  creatorChildren: [],
  analyses: [],
};

describe("buildGraph", () => {
  it("dedups an address that is BOTH a known intermediary and a group member into one node with both kinds", () => {
    const group = grp("1", "public", [["GI1", "intermediary"]]);
    const { nodes } = buildGraph({
      ...emptyInput,
      groups: [group],
      knownIntermediaries: [{ address: "GI1", name: "Inter1" }],
    });
    const node = nodes.find((n) => n.id === "GI1");
    expect(node).toBeDefined();
    expect(node!.kinds).toEqual(expect.arrayContaining(["group-member", "intermediary"]));
    expect(node!.roles).toContain("intermediary");
    // dedup: only one node for this address
    expect(nodes.filter((n) => n.id === "GI1")).toHaveLength(1);
  });

  it("builds a creator-child edge from CreatorChild.creatorAddress -> childAddress", () => {
    const cc = child("GCREATOR", "GCHILD", "public");
    const { edges } = buildGraph({
      ...emptyInput,
      knownCreators: [{ address: "GCREATOR", name: "Creator1" }],
      creatorChildren: [cc],
    });
    const edge = edges.find((e) => e.kind === "creator-child");
    expect(edge).toBeDefined();
    expect(edge).toMatchObject({ source: "GCREATOR", target: "GCHILD", kind: "creator-child", weight: 1 });
  });

  it("builds a distrib-destination edge with weight equal to topDestinations totalXlm", () => {
    const group = grp("1", "public", [
      ["GISS", "issuer"],
      ["GDIST", "distributor"],
    ]);
    const analysis = mkAnalysis("a1", "FOO", "GISS", ["GDIST"], "public", [
      { address: "GDEST", totalXlm: 777, count: 2 },
    ]);
    const { edges } = buildGraph({
      ...emptyInput,
      groups: [group],
      analyses: [analysis],
    });
    const edge = edges.find((e) => e.kind === "distrib-destination");
    expect(edge).toBeDefined();
    expect(edge).toMatchObject({ source: "GDIST", target: "GDEST", kind: "distrib-destination", weight: 777 });
  });

  it("minEdgeWeight prunes light edges AND removes resulting orphan nodes", () => {
    const groupA = grp("A", "public", [
      ["GISS_A", "issuer"],
      ["GX_A", "other"],
    ]);
    const groupB = grp("B", "public", [
      ["GISS_B", "issuer"],
      ["GDIST_B", "distributor"],
    ]);
    const analysis = mkAnalysis("b1", "BAR", "GISS_B", ["GDIST_B"], "public", [
      { address: "GDEST_B", totalXlm: 777, count: 1 },
    ]);
    const { nodes, edges } = buildGraph({
      ...emptyInput,
      groups: [groupA, groupB],
      analyses: [analysis],
      filters: { minEdgeWeight: 10 },
    });

    // light co-membership edge (weight 1) between GX_A and GISS_A is pruned
    expect(edges.find((e) => e.source === "GX_A" && e.target === "GISS_A")).toBeUndefined();
    // both endpoints become orphans and are removed
    expect(nodes.find((n) => n.id === "GX_A")).toBeUndefined();
    expect(nodes.find((n) => n.id === "GISS_A")).toBeUndefined();

    // heavy distrib-destination edge (777) survives
    const heavyEdge = edges.find((e) => e.kind === "distrib-destination");
    expect(heavyEdge).toMatchObject({ source: "GDIST_B", target: "GDEST_B", weight: 777 });
    expect(nodes.find((n) => n.id === "GDIST_B")).toBeDefined();
    expect(nodes.find((n) => n.id === "GDEST_B")).toBeDefined();
  });

  it("focusAddress with focusHops:1 keeps only direct neighbors", () => {
    const children = [
      child("A", "B", "public"),
      child("B", "C", "public"),
      child("C", "D", "public"),
    ];
    const { nodes } = buildGraph({
      ...emptyInput,
      knownCreators: [{ address: "A", name: "CreatorA" }],
      creatorChildren: children,
      filters: { focusAddress: "B", focusHops: 1 },
    });
    const ids = nodes.map((n) => n.id).sort();
    expect(ids).toEqual(["A", "B", "C"]);
    expect(ids).not.toContain("D");
  });

  it("network filter excludes nodes (and their edges) from other networks", () => {
    const groupPublic = grp("pub", "public", [
      ["GISS_PUB", "issuer"],
      ["GBANK_PUB", "bank"],
    ]);
    const groupTestnet = grp("test", "testnet", [
      ["GISS_TEST", "issuer"],
      ["GBANK_TEST", "bank"],
    ]);
    const { nodes, edges } = buildGraph({
      ...emptyInput,
      groups: [groupPublic, groupTestnet],
      filters: { network: "public" },
    });
    const ids = nodes.map((n) => n.id);
    expect(ids).toEqual(expect.arrayContaining(["GISS_PUB", "GBANK_PUB"]));
    expect(ids).not.toContain("GISS_TEST");
    expect(ids).not.toContain("GBANK_TEST");
    expect(edges.some((e) => e.source === "GBANK_TEST" || e.target === "GBANK_TEST")).toBe(false);
  });
});
