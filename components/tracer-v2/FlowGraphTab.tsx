"use client";

import { useMemo, useRef, useState } from "react";
import { Loader2, RotateCcw, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ShortAddress } from "@/components/shared/ShortAddress";
import { useAssetGroups } from "@/hooks/use-asset-groups";
import { useKnownIntermediaries } from "@/hooks/use-known-intermediaries";
import { useKnownCreators } from "@/hooks/use-known-creators";
import { useCreatorChildren } from "@/hooks/use-creator-children";
import { useSavedAnalyses } from "@/hooks/use-saved-analyses";
import { useSettings } from "@/lib/settings";
import { buildGraph } from "@/lib/tracer-v2/graph-builder";
import { layoutGraph, type Point } from "@/lib/tracer-v2/force-sim";
import { computeFingerprints } from "@/lib/tracer-v2/fingerprint";
import type { GraphFilters, GraphInput, GraphNode, GraphNodeKind } from "@/lib/tracer-v2/types";
import { ROLE_LABELS, type GroupMemberRole } from "@/lib/asset-groups/types";

// ---------------------------------------------------------------------------
// Layout / rendering constants
// ---------------------------------------------------------------------------

const GRAPH_WIDTH = 900;
const GRAPH_HEIGHT = 600;

const ALL_KINDS: GraphNodeKind[] = [
  "group-member",
  "intermediary",
  "creator",
  "creator-child",
  "destination",
];

const KIND_LABELS: Record<GraphNodeKind, string> = {
  "group-member": "Group Member",
  intermediary: "Intermediary",
  creator: "Creator",
  "creator-child": "Creator Child",
  destination: "Destination",
};

// Primary-kind colors (checked in priority order below).
const KIND_COLORS: Record<Exclude<GraphNodeKind, "group-member">, string> = {
  intermediary: "#fbbf24", // amber-400
  creator: "#4ade80", // green-400
  destination: "#60a5fa", // blue-400
  "creator-child": "#9ca3af", // gray-400
};

// Mirrors the hues used in lib/asset-groups/types.ts ROLE_COLORS (Tailwind
// classes there aren't usable directly as SVG fill values, so this is a
// small hex twin of the same palette).
const ROLE_COLOR_HEX: Record<GroupMemberRole, string> = {
  issuer: "#60a5fa", // blue-400
  distributor: "#c084fc", // purple-400
  creator: "#4ade80", // green-400
  intermediary: "#fbbf24", // yellow-400
  bank: "#fb923c", // orange-400
  withdrawal: "#f87171", // red-400
  destination: "#ef4444", // red-500
  service: "#22d3ee", // cyan-400
  other: "#9ca3af", // gray-400
};

const NETWORK_OPTIONS = ["public", "testnet", "futurenet", "local"] as const;
const ALL_NETWORKS_SENTINEL = "__all__";
const LARGE_GRAPH_THRESHOLD = 200;

function clamp(min: number, value: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function primaryColor(node: GraphNode): string {
  if (node.kinds.includes("intermediary")) return KIND_COLORS.intermediary;
  if (node.kinds.includes("creator")) return KIND_COLORS.creator;
  if (node.kinds.includes("destination")) return KIND_COLORS.destination;
  if (node.kinds.includes("creator-child")) return KIND_COLORS["creator-child"];
  const role = node.roles[0] as GroupMemberRole | undefined;
  return role ? ROLE_COLOR_HEX[role] ?? ROLE_COLOR_HEX.other : ROLE_COLOR_HEX.other;
}

type DragState =
  | { mode: "pan"; startX: number; startY: number; startTx: number; startTy: number }
  | { mode: "node"; id: string; startX: number; startY: number; startPt: Point }
  | null;

export function FlowGraphTab() {
  const { settings } = useSettings();
  const { groups, isLoaded } = useAssetGroups();
  const { entries: intermediaryEntries } = useKnownIntermediaries();
  const { entries: creatorEntries } = useKnownCreators();
  const { all: creatorChildren } = useCreatorChildren();
  const { analyses } = useSavedAnalyses();

  // ---- Filters state ----
  const [networkFilter, setNetworkFilter] = useState<string>(settings.network);
  const [kindState, setKindState] = useState<Record<GraphNodeKind, boolean>>(() =>
    Object.fromEntries(ALL_KINDS.map((k) => [k, true])) as Record<GraphNodeKind, boolean>,
  );
  const [minEdgeWeight, setMinEdgeWeight] = useState(0);
  const [focusAddress, setFocusAddress] = useState("");
  const [focusHops, setFocusHops] = useState(2);
  const [showOperatorLinks, setShowOperatorLinks] = useState(true);

  // ---- Interaction state ----
  const [view, setView] = useState({ tx: 0, ty: 0, scale: 1 });
  const [pinned, setPinned] = useState<Record<string, Point>>({});
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const dragRef = useRef<DragState>(null);

  const toggleKind = (kind: GraphNodeKind) => {
    setKindState((prev) => ({ ...prev, [kind]: !prev[kind] }));
  };

  const enabledKinds = useMemo(() => ALL_KINDS.filter((k) => kindState[k]), [kindState]);

  const filters: GraphFilters = useMemo(
    () => ({
      network: networkFilter === ALL_NETWORKS_SENTINEL ? undefined : networkFilter,
      kinds: enabledKinds.length < ALL_KINDS.length ? enabledKinds : undefined,
      minEdgeWeight: minEdgeWeight > 0 ? minEdgeWeight : undefined,
      focusAddress: focusAddress.trim() || undefined,
      focusHops,
    }),
    [networkFilter, enabledKinds, minEdgeWeight, focusAddress, focusHops],
  );

  const graphInput: GraphInput = useMemo(
    () => ({
      groups,
      knownIntermediaries: intermediaryEntries.map((e) => ({ address: e.address, name: e.name })),
      knownCreators: creatorEntries.map((e) => ({ address: e.address, name: e.name })),
      creatorChildren,
      analyses,
      filters,
    }),
    [groups, intermediaryEntries, creatorEntries, creatorChildren, analyses, filters],
  );

  const graph = useMemo(() => buildGraph(graphInput), [graphInput]);

  // Recompute layout only when the filtered node/edge set actually changes
  // shape, not on every render (e.g. hover/drag/pan state changes).
  const layoutFiltersKey = JSON.stringify(filters);
  const baseLayout = useMemo(
    () => layoutGraph(graph.nodes, graph.edges, { width: GRAPH_WIDTH, height: GRAPH_HEIGHT }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graph.nodes.length, graph.edges.length, layoutFiltersKey],
  );

  const positions = useMemo(() => {
    const merged = new Map(baseLayout);
    for (const [id, pt] of Object.entries(pinned)) {
      if (merged.has(id)) merged.set(id, pt);
    }
    return merged;
  }, [baseLayout, pinned]);

  const degree = useMemo(() => {
    const d = new Map<string, number>();
    for (const e of graph.edges) {
      d.set(e.source, (d.get(e.source) ?? 0) + 1);
      d.set(e.target, (d.get(e.target) ?? 0) + 1);
    }
    return d;
  }, [graph.edges]);

  const adjacency = useMemo(() => {
    const adj = new Map<string, Set<string>>();
    for (const e of graph.edges) {
      if (!adj.has(e.source)) adj.set(e.source, new Set());
      if (!adj.has(e.target)) adj.set(e.target, new Set());
      adj.get(e.source)!.add(e.target);
      adj.get(e.target)!.add(e.source);
    }
    return adj;
  }, [graph.edges]);

  // ---- Cross-group operator fingerprint overlay ----
  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const fingerprintMatches = useMemo(
    () => computeFingerprints({ groups, analyses, creatorChildren }),
    [groups, analyses, creatorChildren],
  );
  const operatorLinks = useMemo(() => {
    if (!showOperatorLinks) return [];
    const links: { a: string; b: string }[] = [];
    for (const m of fingerprintMatches) {
      if (m.tier !== "strong" && m.tier !== "confirmed") continue;
      const groupA = groupById.get(m.groupAId);
      const groupB = groupById.get(m.groupBId);
      const issuerA = groupA?.members.find((mem) => mem.role === "issuer");
      const issuerB = groupB?.members.find((mem) => mem.role === "issuer");
      if (!issuerA || !issuerB) continue;
      links.push({ a: issuerA.address, b: issuerB.address });
    }
    return links;
  }, [showOperatorLinks, fingerprintMatches, groupById]);

  // ---- Pan / zoom / drag ----
  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const delta = -e.deltaY * 0.001;
    setView((v) => ({ ...v, scale: clamp(0.2, v.scale * (1 + delta), 4) }));
  };

  const handleBackgroundPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.target !== e.currentTarget) return; // a node/edge handled its own pointerdown
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { mode: "pan", startX: e.clientX, startY: e.clientY, startTx: view.tx, startTy: view.ty };
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.mode === "pan") {
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      setView((v) => ({ ...v, tx: drag.startTx + dx, ty: drag.startTy + dy }));
    } else {
      const dx = (e.clientX - drag.startX) / view.scale;
      const dy = (e.clientY - drag.startY) / view.scale;
      setPinned((prev) => ({ ...prev, [drag.id]: { x: drag.startPt.x + dx, y: drag.startPt.y + dy } }));
    }
  };

  const handlePointerUp = () => {
    dragRef.current = null;
  };

  const handleNodePointerDown = (e: React.PointerEvent<SVGCircleElement>, id: string) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const pt = positions.get(id) ?? { x: GRAPH_WIDTH / 2, y: GRAPH_HEIGHT / 2 };
    dragRef.current = { mode: "node", id, startX: e.clientX, startY: e.clientY, startPt: pt };
  };

  const resetView = () => setView({ tx: 0, ty: 0, scale: 1 });

  const selectedNode = selectedId ? graph.nodes.find((n) => n.id === selectedId) : undefined;

  if (!isLoaded) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters bar */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Network</Label>
              <Select value={networkFilter} onValueChange={setNetworkFilter}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_NETWORKS_SENTINEL}>All networks</SelectItem>
                  {NETWORK_OPTIONS.map((n) => (
                    <SelectItem key={n} value={n}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Min edge weight</Label>
              <Input
                type="number"
                min={0}
                value={minEdgeWeight}
                onChange={(e) => setMinEdgeWeight(Number(e.target.value) || 0)}
                className="w-28"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Focus address</Label>
              <Input
                placeholder="G... (optional)"
                value={focusAddress}
                onChange={(e) => setFocusAddress(e.target.value)}
                className="w-56 font-mono text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Hops</Label>
              <Input
                type="number"
                min={1}
                max={6}
                value={focusHops}
                onChange={(e) => setFocusHops(Math.max(1, Number(e.target.value) || 1))}
                className="w-20"
              />
            </div>

            <div className="flex items-center gap-2">
              <Switch checked={showOperatorLinks} onCheckedChange={setShowOperatorLinks} id="operator-links" />
              <Label htmlFor="operator-links" className="text-xs text-muted-foreground">
                Show operator links
              </Label>
            </div>

            <Button type="button" variant="outline" size="sm" onClick={resetView} className="gap-1">
              <RotateCcw className="h-3.5 w-3.5" />
              Reset view
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground mr-1">Kinds:</span>
            {ALL_KINDS.map((kind) => (
              <Button
                key={kind}
                type="button"
                size="sm"
                variant={kindState[kind] ? "secondary" : "outline"}
                onClick={() => toggleKind(kind)}
                className="h-7 px-2 text-xs"
              >
                {KIND_LABELS[kind]}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {graph.nodes.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8">
          No graphable data yet — create asset groups, trace creators, or save analyses first.
        </p>
      ) : (
        <>
          {graph.nodes.length > LARGE_GRAPH_THRESHOLD && !filters.focusAddress && (
            <div className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded-md px-3 py-2">
              Large graph ({graph.nodes.length} nodes) — set a focus address for readability.
            </div>
          )}

          <div className="flex flex-col lg:flex-row gap-4">
            <div className="flex-1 border rounded-lg overflow-hidden bg-muted/10">
              <svg
                width="100%"
                height={GRAPH_HEIGHT}
                viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
                preserveAspectRatio="xMidYMid meet"
                onWheel={handleWheel}
                onPointerDown={handleBackgroundPointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
                className="cursor-grab active:cursor-grabbing touch-none select-none"
              >
                <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
                  {/* Base edges */}
                  {graph.edges.map((edge, i) => {
                    const p1 = positions.get(edge.source);
                    const p2 = positions.get(edge.target);
                    if (!p1 || !p2) return null;
                    const dimmed =
                      hoveredId !== null && edge.source !== hoveredId && edge.target !== hoveredId;
                    const strokeWidth = clamp(1, 1 + Math.log2(edge.weight + 1), 6);
                    return (
                      <line
                        key={`e-${i}`}
                        x1={p1.x}
                        y1={p1.y}
                        x2={p2.x}
                        y2={p2.y}
                        stroke="currentColor"
                        className="text-muted-foreground"
                        strokeOpacity={dimmed ? 0.08 : 0.5}
                        strokeWidth={strokeWidth}
                        strokeDasharray={edge.kind === "co-membership" ? "4 3" : undefined}
                        pointerEvents="none"
                      />
                    );
                  })}

                  {/* Operator-link overlay (fingerprint cross-highlight) */}
                  {operatorLinks.map((link, i) => {
                    const p1 = positions.get(link.a);
                    const p2 = positions.get(link.b);
                    if (!p1 || !p2) return null;
                    return (
                      <line
                        key={`op-${i}`}
                        x1={p1.x}
                        y1={p1.y}
                        x2={p2.x}
                        y2={p2.y}
                        stroke="#ef4444"
                        strokeOpacity={0.35}
                        strokeWidth={3}
                        pointerEvents="none"
                      />
                    );
                  })}

                  {/* Nodes */}
                  {graph.nodes.map((node) => {
                    const p = positions.get(node.id);
                    if (!p) return null;
                    const r = clamp(6, 6 + (degree.get(node.id) ?? 0) * 0.6, 10);
                    const dimmed =
                      hoveredId !== null &&
                      node.id !== hoveredId &&
                      !(adjacency.get(hoveredId)?.has(node.id) ?? false);
                    const showLabel = view.scale > 0.7;
                    return (
                      <g key={node.id} opacity={dimmed ? 0.15 : 1}>
                        <circle
                          cx={p.x}
                          cy={p.y}
                          r={r}
                          fill={primaryColor(node)}
                          stroke={selectedId === node.id ? "#fff" : "rgba(0,0,0,0.35)"}
                          strokeWidth={selectedId === node.id ? 2 : 1}
                          onPointerDown={(e) => handleNodePointerDown(e, node.id)}
                          onPointerEnter={() => setHoveredId(node.id)}
                          onPointerLeave={() => setHoveredId((cur) => (cur === node.id ? null : cur))}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedId(node.id);
                          }}
                          className="cursor-pointer"
                        />
                        {showLabel && (
                          <text
                            x={p.x + r + 3}
                            y={p.y + 3}
                            fontSize={10}
                            fill="currentColor"
                            className="text-foreground"
                            pointerEvents="none"
                          >
                            {node.label ?? `${node.id.slice(0, 4)}…${node.id.slice(-4)}`}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </g>
              </svg>
            </div>

            <div className="w-full lg:w-72 shrink-0">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    {selectedNode ? "Node details" : "Select a node"}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {!selectedNode ? (
                    <p className="text-xs text-muted-foreground">
                      Click a node in the graph to see its details here.
                    </p>
                  ) : (
                    <>
                      <ShortAddress address={selectedNode.id} network={settings.network} />
                      <div className="flex flex-wrap gap-1">
                        {selectedNode.kinds.map((k) => (
                          <span
                            key={k}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                          >
                            {KIND_LABELS[k]}
                          </span>
                        ))}
                        {selectedNode.roles.map((r) => (
                          <span
                            key={r}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                          >
                            {ROLE_LABELS[r as GroupMemberRole] ?? r}
                          </span>
                        ))}
                      </div>
                      <div className="flex flex-col gap-1 text-xs">
                        <a
                          href={`/address-investigator?address=${selectedNode.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          Investigate <ExternalLink className="h-3 w-3" />
                        </a>
                        <a
                          href={`/tracer-v2?addresses=${selectedNode.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          Bulk Trace <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
