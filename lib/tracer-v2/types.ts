import type { AssetGroup, GroupMemberRole } from "@/lib/asset-groups/types";
import type { SavedAnalysis } from "@/hooks/use-saved-analyses";
import type { CreatorChild } from "@/lib/intermediary-tracer/types";

export type OperatorTier = "confirmed" | "strong" | "moderate" | "weak" | "hidden";
export type SignalType = "shared-address" | "shared-destination" | "shared-domain" | "shared-lineage";

export interface EvidenceItem {
  signal: SignalType;
  entity: string;            // the shared address or domain
  roleA?: GroupMemberRole;   // signal 1 only
  roleB?: GroupMemberRole;
  entityGroupCount: number;  // k used for dampening
  weight: number;            // effective weight after damp + cap
  detail: string;            // human label e.g. "shared intermediary GABC…WXYZ"
}

export interface OperatorMatch {
  groupAId: string; groupAName: string;
  groupBId: string; groupBName: string;
  network: string;
  score: number;             // 0-100
  tier: OperatorTier;
  evidence: EvidenceItem[];
  shortCircuit: boolean;     // true when issuer/distrib shared both sides
}

export interface FingerprintInput {
  groups: AssetGroup[];
  analyses: SavedAnalysis[];
  creatorChildren: CreatorChild[];
  minScore?: number;         // default MIN_SCORE_DEFAULT
}

// ── Phase 3 — Watchlist ────────────────────────────────────────────────────
export interface WatchlistEntry {
  id: string;
  address: string;
  label: string;
  network: string;
  enabled: boolean;
  pollCursor?: string | null;
  lastCheckedAt?: number | null;
  createdAt: number;
}

export interface WatchEvent {
  id: string;
  watchId: string;
  eventType: string;
  accountCreated: string;
  funder?: string | null;
  amount?: string | null;
  txHash?: string | null;
  ledgerTime?: string | null;
  seen: boolean;
  createdAt: number;
}

// ── Phase 4 — Flow Graph ───────────────────────────────────────────────────
export type GraphNodeKind = "group-member" | "intermediary" | "creator" | "creator-child" | "destination";

export interface GraphNode {
  id: string;              // address (dedup key)
  kinds: GraphNodeKind[];  // multi-badge — a node can be several things
  roles: string[];         // group roles held (issuer/distributor/bank/...)
  label?: string;          // best human label (group member label / known name)
  network: string;
}

export interface GraphEdge {
  source: string;          // address
  target: string;          // address
  kind: "creator-child" | "intermediary-created" | "distrib-destination" | "co-membership";
  weight: number;          // XLM for distrib-destination, else 1
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphFilters {
  network?: string;                 // restrict to one network
  groupId?: string;                 // only nodes/edges touching this group
  kinds?: GraphNodeKind[];          // include only these node kinds
  minEdgeWeight?: number;           // drop lighter edges
  focusAddress?: string;            // N-hop neighborhood only
  focusHops?: number;               // default 2
}

export interface GraphInput {
  groups: AssetGroup[];
  knownIntermediaries: { address: string; name: string }[];
  knownCreators: { address: string; name: string }[];
  creatorChildren: CreatorChild[];
  analyses: SavedAnalysis[];
  filters?: GraphFilters;
}
