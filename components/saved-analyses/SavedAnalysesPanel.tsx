"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BookmarkCheck,
  ChevronDown,
  ChevronRight,
  LayoutList,
  Loader2,
  MessageSquare,
  Pencil,
  PlayCircle,
  Search,
  Table2,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSavedAnalyses } from "@/hooks/use-saved-analyses";
import type { SavedAnalysis } from "@/hooks/use-saved-analyses";
import { ShortAddress } from "@/components/shared/ShortAddress";
import { ProceedsDestinationsTable } from "@/components/shared/proceeds/ProceedsDestinationsTable";
import { fetchAssetXlmProceeds } from "@/lib/proceeds-investigator/fetchers";
import { formatXlm } from "@/lib/format";
import { getErrorMessage, timeAgo } from "@/lib/stellar-helpers";
import { NETWORK_LABELS, resolveHorizonUrl, useSettings } from "@/lib/settings";
import type { Network, Settings } from "@/lib/settings";
import { SnapshotCompare } from "./SnapshotCompare";

// ---------------------------------------------------------------------------
// Shared sort logic — used by both Table and Cards views
// ---------------------------------------------------------------------------

type SortField = "assetCode" | "xlmProceeds" | "assetSold" | "outgoing" | "onHand" | "timestamp";
type SortDir = "asc" | "desc";
type Sort = { field: SortField; dir: SortDir };

const SORT_OPTIONS: { value: string; label: string; sort: Sort }[] = [
  { value: "timestamp:desc", label: "Newest first", sort: { field: "timestamp", dir: "desc" } },
  { value: "timestamp:asc", label: "Oldest first", sort: { field: "timestamp", dir: "asc" } },
  { value: "xlmProceeds:desc", label: "Highest XLM Proceeds", sort: { field: "xlmProceeds", dir: "desc" } },
  { value: "assetSold:desc", label: "Highest Asset Sold", sort: { field: "assetSold", dir: "desc" } },
  { value: "outgoing:desc", label: "Highest Outgoing", sort: { field: "outgoing", dir: "desc" } },
  { value: "onHand:desc", label: "Highest On Hand", sort: { field: "onHand", dir: "desc" } },
  { value: "assetCode:asc", label: "Asset Code A→Z", sort: { field: "assetCode", dir: "asc" } },
];

function sortAnalyses(analyses: SavedAnalysis[], sort: Sort): SavedAnalysis[] {
  return [...analyses].sort((a, b) => {
    let av = 0, bv = 0;
    switch (sort.field) {
      case "assetCode": return sort.dir === "asc"
        ? a.assetCode.localeCompare(b.assetCode)
        : b.assetCode.localeCompare(a.assetCode);
      case "xlmProceeds": av = a.result.totalXlmProceeds; bv = b.result.totalXlmProceeds; break;
      case "assetSold":   av = a.result.totalAssetSold;   bv = b.result.totalAssetSold;   break;
      case "outgoing":    av = a.result.totalOutgoingXlm; bv = b.result.totalOutgoingXlm; break;
      case "onHand":      av = a.result.estimatedOnHandXlm ?? 0; bv = b.result.estimatedOnHandXlm ?? 0; break;
      case "timestamp":   av = a.timestamp; bv = b.timestamp; break;
    }
    return sort.dir === "desc" ? bv - av : av - bv;
  });
}

// ---------------------------------------------------------------------------
// Re-run in place — re-scans the same asset/distrib/network and saves a
// fresh snapshot (so it also shows up in Compare Snapshots), no navigation.
// ---------------------------------------------------------------------------

type SaveAnalysisFn = (entry: Omit<SavedAnalysis, "id" | "timestamp">) => string;

async function rerunAnalysis(
  analysis: SavedAnalysis,
  settings: Settings,
  saveAnalysis: SaveAnalysisFn,
  signal: AbortSignal,
): Promise<void> {
  const horizonUrl = resolveHorizonUrl({
    network: analysis.network as Network,
    localHorizonUrl: settings.localHorizonUrl,
  });
  const result = await fetchAssetXlmProceeds(
    horizonUrl,
    analysis.assetCode,
    analysis.issuer,
    analysis.distribAddresses,
    signal,
  );
  saveAnalysis({
    name: `${analysis.assetCode} — ${new Date().toLocaleDateString()}`,
    assetCode: analysis.assetCode,
    issuer: analysis.issuer,
    distribAddresses: analysis.distribAddresses,
    network: analysis.network,
    result,
  });
}

/** Shared re-run state/handler — one instance per row, used by both Card and Table views. */
function useRerun(analysis: SavedAnalysis, saveAnalysis: SaveAnalysisFn) {
  const { settings } = useSettings();
  const [rerunning, setRerunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const rerun = async () => {
    if (rerunning) return;
    setRerunning(true);
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await rerunAnalysis(analysis, settings, saveAnalysis, controller.signal);
    } catch (err) {
      if (!controller.signal.aborted) setError(getErrorMessage(err));
    } finally {
      setRerunning(false);
    }
  };

  return { rerunning, error, rerun };
}

// ---------------------------------------------------------------------------
// AnalysisCard — expanded card view
// ---------------------------------------------------------------------------

function AnalysisCard({ analysis }: { analysis: SavedAnalysis }) {
  const { updateName, updateNotes, updateTags, remove, saveAnalysis } = useSavedAnalyses();
  const { rerunning, error: rerunError, rerun } = useRerun(analysis, saveAnalysis);
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState(analysis.name);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesInput, setNotesInput] = useState(analysis.notes ?? "");
  const [tagInput, setTagInput] = useState("");

  const handleSaveName = () => {
    if (nameInput.trim()) updateName(analysis.id, nameInput.trim());
    setEditing(false);
  };

  return (
    <Card>
      <div className="flex items-center gap-3 p-4">
        <button
          className="shrink-0 text-muted-foreground"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>

        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="flex items-center gap-2">
              <Input
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveName();
                  if (e.key === "Escape") setEditing(false);
                }}
                className="h-7 text-sm"
                autoFocus
              />
              <Button size="sm" className="h-7 px-2" onClick={handleSaveName}>Save</Button>
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setEditing(false)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span
                className="font-medium text-sm truncate cursor-pointer"
                onClick={() => setExpanded((v) => !v)}
              >
                {analysis.name}
              </span>
              <button
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground"
                onClick={() => setEditing(true)}
              >
                <Pencil className="h-3 w-3" />
              </button>
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-0.5">
            <span className="font-mono">{analysis.assetCode}</span>
            {" · "}
            {NETWORK_LABELS[analysis.network as keyof typeof NETWORK_LABELS] ?? analysis.network}
            {" · "}
            {timeAgo(analysis.timestamp)}
          </p>
          {rerunError && (
            <p className="text-xs text-destructive flex items-center gap-1 mt-0.5">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              Re-run failed: {rerunError}
            </p>
          )}
        </div>

        <div className="hidden sm:flex gap-6 shrink-0 text-right">
          <div>
            <p className="text-xs text-muted-foreground">XLM Proceeds</p>
            <p className="font-mono font-semibold text-sm">
              {formatXlm(analysis.result.totalXlmProceeds)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Asset Sold</p>
            <p className="font-mono font-semibold text-sm">
              {formatXlm(analysis.result.totalAssetSold)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title={rerunError ? "Re-run failed — click to retry" : "Re-run analysis"}
            onClick={rerun}
            disabled={rerunning}
          >
            {rerunning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <PlayCircle className={`h-4 w-4 ${rerunError ? "text-destructive" : ""}`} />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            title="Delete"
            onClick={() => {
              if (window.confirm(`Delete saved analysis "${analysis.name}"? This cannot be undone.`)) {
                remove(analysis.id);
              }
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border px-4 pb-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
            <div>
              <p className="text-xs text-muted-foreground">XLM Proceeds</p>
              <p className="font-mono font-semibold">{formatXlm(analysis.result.totalXlmProceeds)} XLM</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Asset Sold</p>
              <p className="font-mono font-semibold">{formatXlm(analysis.result.totalAssetSold)} {analysis.assetCode}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Outgoing XLM</p>
              <p className="font-mono font-semibold">{formatXlm(analysis.result.totalOutgoingXlm)} XLM</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Est. On Hand</p>
              <p className="font-mono font-semibold">{formatXlm(analysis.result.estimatedOnHandXlm)} XLM</p>
            </div>
          </div>

          <div className="mt-3">
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">Distribution addresses: </span>
              {analysis.distribAddresses.map((addr) => (
                <span key={addr} className="inline-block mr-2">
                  <ShortAddress address={addr} network={analysis.network as "public" | "testnet"} />
                </span>
              ))}
            </p>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {(analysis.tags ?? []).map((tag) => (
              <span key={tag} className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                {tag}
                <button
                  className="hover:text-destructive"
                  onClick={() => updateTags(analysis.id, (analysis.tags ?? []).filter((t) => t !== tag))}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
            <div className="flex items-center gap-1">
              <Tag className="h-3 w-3 text-muted-foreground" />
              <input
                className="text-xs bg-transparent border-none outline-none w-24 placeholder:text-muted-foreground"
                placeholder="Add tag…"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && tagInput.trim()) {
                    const tag = tagInput.trim();
                    if (!(analysis.tags ?? []).includes(tag)) {
                      updateTags(analysis.id, [...(analysis.tags ?? []), tag]);
                    }
                    setTagInput("");
                  }
                }}
              />
            </div>
          </div>

          <div className="mt-3">
            {editingNotes ? (
              <div className="space-y-1.5">
                <textarea
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs min-h-16 resize-none"
                  placeholder="Add notes…"
                  value={notesInput}
                  onChange={(e) => setNotesInput(e.target.value)}
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button size="sm" className="h-6 text-xs px-2" onClick={() => { updateNotes(analysis.id, notesInput); setEditingNotes(false); }}>Save</Button>
                  <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => { setNotesInput(analysis.notes ?? ""); setEditingNotes(false); }}>Cancel</Button>
                </div>
              </div>
            ) : (
              <button
                className="flex items-start gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-left"
                onClick={() => setEditingNotes(true)}
              >
                <MessageSquare className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                {analysis.notes ? <span className="italic">{analysis.notes}</span> : <span className="opacity-60">Add notes…</span>}
              </button>
            )}
          </div>

          <h4 className="text-sm font-semibold mt-4 mb-1">Top Destinations</h4>
          <ProceedsDestinationsTable
            destinations={analysis.result.topDestinations}
            totalXlmProceeds={analysis.result.totalXlmProceeds}
            network={analysis.network}
            showProgressBar
            emptyMessage="No outgoing XLM transfers found."
          />
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// SortableTableView — Phase 1
// ---------------------------------------------------------------------------

function SortIcon({ field, sort }: { field: SortField; sort: Sort }) {
  if (sort.field !== field) return <ArrowUpDown className="h-3 w-3 opacity-40" />;
  return sort.dir === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />;
}

function TableView({
  analyses,
  sort,
  onSortChange,
}: {
  analyses: SavedAnalysis[];
  sort: Sort;
  onSortChange: (sort: Sort) => void;
}) {
  const toggle = (field: SortField) =>
    onSortChange({ field, dir: sort.field === field && sort.dir === "desc" ? "asc" : "desc" });

  const sorted = useMemo(() => sortAnalyses(analyses, sort), [analyses, sort]);

  const th = (label: string, field: SortField) => (
    <th
      className="px-3 py-2 text-right font-medium cursor-pointer hover:text-foreground whitespace-nowrap select-none"
      onClick={() => toggle(field)}
    >
      <span className="inline-flex items-center justify-end gap-1">
        {label} <SortIcon field={field} sort={sort} />
      </span>
    </th>
  );

  return (
    <div className="overflow-x-auto border rounded-md">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/40 text-muted-foreground text-xs">
            <th
              className="px-3 py-2 text-left font-medium cursor-pointer hover:text-foreground select-none"
              onClick={() => toggle("assetCode")}
            >
              <span className="inline-flex items-center gap-1">
                Asset <SortIcon field="assetCode" sort={sort} />
              </span>
            </th>
            <th className="px-3 py-2 text-left font-medium">Distrib</th>
            <th className="px-3 py-2 text-left font-medium">Network</th>
            {th("XLM Proceeds", "xlmProceeds")}
            {th("Asset Sold", "assetSold")}
            {th("Outgoing XLM", "outgoing")}
            {th("Est. On Hand", "onHand")}
            {th("Saved", "timestamp")}
            <th className="px-3 py-2 text-right font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((a) => (
            <TableRow key={a.id} analysis={a} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TableRow({ analysis: a }: { analysis: SavedAnalysis }) {
  const { remove, saveAnalysis } = useSavedAnalyses();
  const { rerunning, error: rerunError, rerun } = useRerun(a, saveAnalysis);

  return (
    <tr className="border-b last:border-0 hover:bg-muted/20 transition-colors">
      <td className="px-3 py-2 font-mono font-semibold text-xs whitespace-nowrap">
        {a.assetCode}
      </td>
      <td className="px-3 py-2 text-xs">
        {a.distribAddresses[0] ? (
          <ShortAddress address={a.distribAddresses[0]} network={a.network as "public" | "testnet"} />
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
        {NETWORK_LABELS[a.network as keyof typeof NETWORK_LABELS] ?? a.network}
      </td>
      <td className="px-3 py-2 text-right tabular-nums font-mono text-xs">
        {formatXlm(a.result.totalXlmProceeds)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums font-mono text-xs">
        {formatXlm(a.result.totalAssetSold)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums font-mono text-xs">
        {formatXlm(a.result.totalOutgoingXlm)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums font-mono text-xs">
        {formatXlm(a.result.estimatedOnHandXlm ?? 0)}
      </td>
      <td className="px-3 py-2 text-right text-xs text-muted-foreground whitespace-nowrap">
        {timeAgo(a.timestamp)}
      </td>
      <td className="px-3 py-2 text-right">
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title={rerunError ? `Re-run failed: ${rerunError} — click to retry` : "Re-run analysis"}
            onClick={rerun}
            disabled={rerunning}
          >
            {rerunning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <PlayCircle className={`h-3.5 w-3.5 ${rerunError ? "text-destructive" : ""}`} />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            title="Delete"
            onClick={() => {
              if (window.confirm(`Delete saved analysis "${a.name}"? This cannot be undone.`)) {
                remove(a.id);
              }
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// AggregateStats — Phase 3
// ---------------------------------------------------------------------------

function AggregateStats({ analyses }: { analyses: SavedAnalysis[] }) {
  if (analyses.length === 0) return null;

  const totalXlm = analyses.reduce((s, a) => s + a.result.totalXlmProceeds, 0);
  const totalOutgoing = analyses.reduce((s, a) => s + a.result.totalOutgoingXlm, 0);
  const uniqueAssets = new Set(analyses.map((a) => `${a.assetCode}:${a.issuer}`)).size;
  const uniqueIssuers = new Set(analyses.map((a) => a.issuer)).size;
  const top = [...analyses].sort((a, b) => b.result.totalXlmProceeds - a.result.totalXlmProceeds)[0];

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {[
        { label: "Total XLM Proceeds", value: formatXlm(totalXlm) + " XLM" },
        { label: "Total Outgoing XLM", value: formatXlm(totalOutgoing) + " XLM" },
        { label: "Unique Assets", value: String(uniqueAssets) },
        { label: "Unique Issuers", value: String(uniqueIssuers) },
        { label: "Top Earner", value: top.assetCode, sub: formatXlm(top.result.totalXlmProceeds) + " XLM" },
      ].map(({ label, value, sub }) => (
        <Card key={label}>
          <CardHeader className="py-3 px-4">
            <CardDescription className="text-xs">{label}</CardDescription>
            <CardTitle className="text-base font-mono">{value}</CardTitle>
            {sub && <p className="text-xs text-muted-foreground font-mono">{sub}</p>}
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CrossAssetDestinations — Phase 4
// ---------------------------------------------------------------------------

function CrossAssetDestinations({ analyses }: { analyses: SavedAnalysis[] }) {
  const [show, setShow] = useState(false);

  const aggregated = useMemo(() => {
    const map = new Map<string, { totalXlm: number; assetCount: Set<string>; txCount: number }>();
    for (const a of analyses) {
      for (const d of a.result.topDestinations) {
        const existing = map.get(d.address);
        if (existing) {
          existing.totalXlm += d.totalXlm;
          existing.assetCount.add(`${a.assetCode}:${a.issuer}`);
          existing.txCount += d.count;
        } else {
          map.set(d.address, { totalXlm: d.totalXlm, assetCount: new Set([`${a.assetCode}:${a.issuer}`]), txCount: d.count });
        }
      }
    }
    return [...map.entries()]
      .map(([address, v]) => ({ address, totalXlm: v.totalXlm, assetCount: v.assetCount.size, txCount: v.txCount }))
      .sort((a, b) => b.assetCount - a.assetCount || b.totalXlm - a.totalXlm);
  }, [analyses]);

  if (aggregated.length === 0) return null;

  const multiAsset = aggregated.filter((r) => r.assetCount > 1);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Cross-Asset Destinations</CardTitle>
            <CardDescription className="text-xs mt-0.5">
              Addresses that received XLM across multiple assets — likely shared banks or exchanges.
              {multiAsset.length > 0 && (
                <span className="ml-1 font-semibold text-yellow-500">
                  {multiAsset.length} shared destination{multiAsset.length > 1 ? "s" : ""} found.
                </span>
              )}
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setShow((v) => !v)}>
            {show ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>
      {show && (
        <CardContent className="pt-0">
          <div className="overflow-x-auto border rounded-md">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/40 text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">Destination</th>
                  <th className="px-3 py-2 text-right font-medium">Assets</th>
                  <th className="px-3 py-2 text-right font-medium">Total XLM</th>
                  <th className="px-3 py-2 text-right font-medium">Txns</th>
                </tr>
              </thead>
              <tbody>
                {aggregated.slice(0, 20).map((row) => (
                  <tr
                    key={row.address}
                    className={`border-b last:border-0 ${row.assetCount > 1 ? "bg-yellow-500/5" : ""}`}
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <ShortAddress address={row.address} network="public" />
                        {row.assetCount > 1 && (
                          <span className="text-[9px] uppercase tracking-wide font-semibold px-1 py-px rounded border border-yellow-400/40 bg-yellow-400/10 text-yellow-400">
                            shared
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">
                      {row.assetCount}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-mono">
                      {formatXlm(row.totalXlm)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.txCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// SavedAnalysesPanel — main export
// ---------------------------------------------------------------------------

export function SavedAnalysesPanel() {
  const { analyses } = useSavedAnalyses();
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"cards" | "table">("cards");
  const [sort, setSort] = useState<Sort>({ field: "timestamp", dir: "desc" });

  const filtered = useMemo(() => {
    if (!query.trim()) return analyses;
    const q = query.toLowerCase();
    return analyses.filter(
      (a) =>
        a.assetCode.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        (a.notes ?? "").toLowerCase().includes(q) ||
        (a.tags ?? []).some((t) => t.toLowerCase().includes(q)) ||
        a.issuer.toLowerCase().includes(q),
    );
  }, [analyses, query]);

  const sortedFiltered = useMemo(() => sortAnalyses(filtered, sort), [filtered, sort]);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BookmarkCheck className="h-6 w-6" />
            Saved Analyses
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Auto-saved XLM proceeds analyses. Sort, filter, tag, and compare results across assets — including cross-asset destination tracking to reveal shared banks and exchanges.
          </p>
        </div>
        {analyses.length > 0 && (
          <div className="flex items-center gap-2 shrink-0">
            <Select
              value={`${sort.field}:${sort.dir}`}
              onValueChange={(v) => {
                const opt = SORT_OPTIONS.find((o) => o.value === v);
                if (opt) setSort(opt.sort);
              }}
            >
              <SelectTrigger className="h-9 w-[180px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center rounded-md border border-border overflow-hidden shrink-0">
              <button
                className={`px-3 py-1.5 text-xs flex items-center gap-1.5 transition-colors ${view === "cards" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                onClick={() => setView("cards")}
              >
                <LayoutList className="h-3.5 w-3.5" /> Cards
              </button>
              <button
                className={`px-3 py-1.5 text-xs flex items-center gap-1.5 transition-colors ${view === "table" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                onClick={() => setView("table")}
              >
                <Table2 className="h-3.5 w-3.5" /> Table
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Aggregate stats */}
      <AggregateStats analyses={analyses} />

      {/* Search */}
      {analyses.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            className="w-full rounded-md border border-input bg-transparent pl-9 pr-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Search by asset, name, tag, notes, issuer…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}

      {/* Snapshot compare */}
      {analyses.length > 1 && <SnapshotCompare analyses={filtered} />}

      {/* Cross-asset destinations */}
      {analyses.length > 1 && <CrossAssetDestinations analyses={filtered} />}

      {/* Main content */}
      {analyses.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No saved analyses yet. Run a Bulk Asset Sales scan — results are saved automatically.
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground text-sm">
            No analyses match &ldquo;{query}&rdquo;.
          </CardContent>
        </Card>
      ) : view === "table" ? (
        <TableView analyses={filtered} sort={sort} onSortChange={setSort} />
      ) : (
        <div className="space-y-3">
          {sortedFiltered.map((a) => <AnalysisCard key={a.id} analysis={a} />)}
        </div>
      )}
    </div>
  );
}
