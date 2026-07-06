import type { GraphData, GraphEdge, GraphInput, GraphNode, GraphNodeKind } from "./types";

function ensureNode(
  nodes: Map<string, GraphNode>,
  address: string,
  kind: GraphNodeKind,
  network?: string,
  role?: string,
  label?: string,
): GraphNode {
  let node = nodes.get(address);
  if (!node) {
    node = { id: address, kinds: [], roles: [], network: network ?? "", label };
    nodes.set(address, node);
  }
  if (!node.kinds.includes(kind)) node.kinds.push(kind);
  if (role && !node.roles.includes(role)) node.roles.push(role);
  // First source to provide a non-empty network wins; don't overwrite once set.
  if (!node.network && network) node.network = network;
  if (!node.label && label) node.label = label;
  return node;
}

function pushEdge(edges: GraphEdge[], source: string, target: string, kind: GraphEdge["kind"], weight: number) {
  edges.push({ source, target, kind, weight });
}

export function buildGraph(input: GraphInput): GraphData {
  const { groups, knownIntermediaries, knownCreators, creatorChildren, analyses, filters } = input;

  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  // ---- Nodes ----

  // Group members
  for (const g of groups) {
    for (const m of g.members) {
      ensureNode(nodes, m.address, "group-member", g.network, m.role, m.label);
    }
  }

  // Known intermediaries
  for (const ki of knownIntermediaries) {
    ensureNode(nodes, ki.address, "intermediary", undefined, undefined, ki.name);
  }

  // Known creators
  for (const kc of knownCreators) {
    ensureNode(nodes, kc.address, "creator", undefined, undefined, kc.name);
  }

  // Creator children
  for (const cc of creatorChildren) {
    ensureNode(nodes, cc.childAddress, "creator-child", cc.network);
  }

  // Saved-analysis top destinations
  for (const a of analyses) {
    for (const dest of a.result?.topDestinations ?? []) {
      ensureNode(nodes, dest.address, "destination", a.network);
    }
  }

  // ---- Edges ----

  for (const cc of creatorChildren) {
    pushEdge(edges, cc.creatorAddress, cc.childAddress, "creator-child", 1);
    if (cc.viaIntermediary) {
      pushEdge(edges, cc.viaIntermediary, cc.childAddress, "intermediary-created", 1);
    }
  }

  for (const a of analyses) {
    const destinations = a.result?.topDestinations ?? [];
    for (const distrib of a.distribAddresses) {
      for (const dest of destinations) {
        pushEdge(edges, distrib, dest.address, "distrib-destination", dest.totalXlm);
      }
    }
  }

  for (const g of groups) {
    const issuer = g.members.find((m) => m.role === "issuer");
    if (!issuer) continue;
    for (const m of g.members) {
      if (m.role === "issuer") continue;
      pushEdge(edges, m.address, issuer.address, "co-membership", 1);
    }
  }

  let graph: GraphData = { nodes: Array.from(nodes.values()), edges };

  // ---- Filters ----
  if (filters) {
    const groupMemberAddresses = filters.groupId
      ? new Set(groups.find((g) => g.id === filters.groupId)?.members.map((m) => m.address) ?? [])
      : null;
    graph = applyFilters(graph, filters, groupMemberAddresses);
  }

  return graph;
}

function applyFilters(
  graph: GraphData,
  filters: NonNullable<GraphInput["filters"]>,
  groupMemberAddresses: Set<string> | null,
): GraphData {
  let nodes = graph.nodes;
  let edges = graph.edges;

  if (filters.network) {
    const network = filters.network;
    const keep = new Set(nodes.filter((n) => n.network === network).map((n) => n.id));
    nodes = nodes.filter((n) => keep.has(n.id));
    edges = filterEdgesBySurvivingNodes(edges, keep);
  }

  if (groupMemberAddresses) {
    nodes = nodes.filter((n) => groupMemberAddresses.has(n.id));
    const keep = new Set(nodes.map((n) => n.id));
    edges = filterEdgesBySurvivingNodes(edges, keep);
  }

  if (filters.kinds && filters.kinds.length > 0) {
    const kindsFilter = new Set(filters.kinds);
    const keep = new Set(nodes.filter((n) => n.kinds.some((k) => kindsFilter.has(k))).map((n) => n.id));
    nodes = nodes.filter((n) => keep.has(n.id));
    edges = filterEdgesBySurvivingNodes(edges, keep);
  }

  if (filters.minEdgeWeight !== undefined) {
    const minWeight = filters.minEdgeWeight;
    edges = edges.filter((e) => e.weight >= minWeight);
    const connected = new Set<string>();
    for (const e of edges) {
      connected.add(e.source);
      connected.add(e.target);
    }
    nodes = nodes.filter((n) => connected.has(n.id));
    edges = filterEdgesBySurvivingNodes(edges, new Set(nodes.map((n) => n.id)));
  }

  if (filters.focusAddress) {
    const hops = filters.focusHops ?? 2;
    const adjacency = new Map<string, Set<string>>();
    for (const e of edges) {
      if (!adjacency.has(e.source)) adjacency.set(e.source, new Set());
      if (!adjacency.has(e.target)) adjacency.set(e.target, new Set());
      adjacency.get(e.source)!.add(e.target);
      adjacency.get(e.target)!.add(e.source);
    }
    const reached = new Set<string>([filters.focusAddress]);
    let frontier = [filters.focusAddress];
    for (let hop = 0; hop < hops; hop++) {
      const next: string[] = [];
      for (const addr of frontier) {
        for (const neighbor of adjacency.get(addr) ?? []) {
          if (!reached.has(neighbor)) {
            reached.add(neighbor);
            next.push(neighbor);
          }
        }
      }
      frontier = next;
      if (frontier.length === 0) break;
    }
    nodes = nodes.filter((n) => reached.has(n.id));
    edges = filterEdgesBySurvivingNodes(edges, reached);
  }

  return { nodes, edges };
}

function filterEdgesBySurvivingNodes(edges: GraphEdge[], keep: Set<string>): GraphEdge[] {
  return edges.filter((e) => keep.has(e.source) && keep.has(e.target));
}
