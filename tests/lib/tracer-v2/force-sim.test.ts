import { describe, it, expect } from "vitest";
import { layoutGraph } from "@/lib/tracer-v2/force-sim";
import type { GraphEdge, GraphNode } from "@/lib/tracer-v2/types";

function node(id: string): GraphNode {
  return { id, kinds: ["group-member"], roles: [], network: "public" };
}

function dist(p1: { x: number; y: number }, p2: { x: number; y: number }): number {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

describe("layoutGraph", () => {
  it("pulls connected nodes closer together than unconnected ones", () => {
    const nodes: GraphNode[] = [node("A"), node("B"), node("C"), node("D")];
    const edges: GraphEdge[] = [{ source: "A", target: "B", kind: "co-membership", weight: 1 }];

    const positions = layoutGraph(nodes, edges, { width: 800, height: 600 });

    const distAB = dist(positions.get("A")!, positions.get("B")!);
    const distCD = dist(positions.get("C")!, positions.get("D")!);

    expect(distAB).toBeLessThan(distCD);
  });
});
