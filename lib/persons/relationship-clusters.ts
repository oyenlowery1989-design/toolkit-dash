import type { Person } from "@/lib/persons/types";

export interface PersonCluster {
  personIds: string[];
  edgeCount: number;
}

/** Connected components over all persons' relationship edges (union-find).
 *  Clusters of size 1 (no relationships) are omitted. Each underlying DB
 *  edge produces a ref on both sides sharing the same `id` — edges are
 *  counted once per cluster by deduping on that id. */
export function computeClusters(persons: Person[]): PersonCluster[] {
  const parent = new Map<string, string>();

  const find = (id: string): string => {
    if (!parent.has(id)) parent.set(id, id);
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = id;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };

  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const p of persons) {
    find(p.id);
    for (const r of p.relationships) union(p.id, r.personId);
  }

  const membersByRoot = new Map<string, Set<string>>();
  for (const p of persons) {
    const root = find(p.id);
    if (!membersByRoot.has(root)) membersByRoot.set(root, new Set());
    membersByRoot.get(root)!.add(p.id);
  }

  const countedEdgeIds = new Set<string>();
  const edgeCountByRoot = new Map<string, number>();
  for (const p of persons) {
    for (const r of p.relationships) {
      if (countedEdgeIds.has(r.id)) continue;
      countedEdgeIds.add(r.id);
      const root = find(p.id);
      edgeCountByRoot.set(root, (edgeCountByRoot.get(root) ?? 0) + 1);
    }
  }

  return [...membersByRoot.entries()]
    .filter(([, members]) => members.size > 1)
    .map(([root, members]) => ({ personIds: [...members], edgeCount: edgeCountByRoot.get(root) ?? 0 }))
    .sort((a, b) => b.personIds.length - a.personIds.length || b.edgeCount - a.edgeCount);
}
