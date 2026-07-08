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
  ExternalLink,
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
import { useXlmUsdPrice } from "@/hooks/use-xlm-usd-price";
import { useConfirmClick } from "@/hooks/use-confirm-click";
import { ShortAddress } from "@/components/shared/ShortAddress";
import { ProceedsDestinationsTable } from "@/components/shared/proceeds/ProceedsDestinationsTable";
import { fetchAssetXlmProceeds } from "@/lib/proceeds-investigator/fetchers";
import { formatXlm, formatUsdEstimate } from "@/lib/format";
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

/** Groups snapshots of the same asset+issuer+network together — re-running an
 *  analysis saves a fresh snapshot (needed for Compare Snapshots), so the
 *  list must group by identity rather than show one row per snapshot. */
function groupKey(a: SavedAnalysis): string {
  return `${a.assetCode}:${a.issuer}:${a.network}`;
}

function groupAnalyses(analyses: SavedAnalysis[]): SavedAnalysis[][] {
  const map = new Map<string, SavedAnalysis[]>();
  for (const a of analyses) {
    const key = groupKey(a);
    const arr = map.get(key);
    if (arr) arr.push(a);
    else map.set(key, [a]);
  }
  return [...map.values()].map((arr) => [...arr].sort((a, b) => b.timestamp - a.timestamp));
}

/** Latest snapshot per asset+issuer+network — use this (not the raw flat
 *  list) for any aggregate/total, so re-run snapshots don't get double- or
 *  triple-counted alongside their earlier versions. */
function latestPerGroup(analyses: SavedAnalysis[]): SavedAnalysis[] {
  return groupAnalyses(analyses).map((g) => g[0]);
}

/** Deep-link to Asset Sales, pre-filled + auto-run — same param contract as
 *  AssetLookupPanel's "View full data in Asset Sales" and Search History's
 *  "Run Asset Sales" (asset/issuer/account/autorun). Lets you cross-check a
 *  saved snapshot against a live scan. */
function assetSalesUrl(analysis: SavedAnalysis): string {
  const params = new URLSearchParams({
    asset: analysis.assetCode,
    issuer: analysis.issuer,
    account: analysis.distribAddresses.join("\n"),
    autorun: "1",
  });
  return `/asset-sales?${params.toString()}`;
}

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

/** Click-to-confirm delete for one row (history table / table view) — needs its
 *  own component since useConfirmClick's per-button state can't live in a
 *  shared loop-parent without every row sharing one confirm flag. */
function ConfirmDeleteButton({
  onDelete,
  title,
  className,
  iconClassName,
}: {
  onDelete: () => void;
  title: string;
  className?: string;
  iconClassName?: string;
}) {
  const { confirming, onClick } = useConfirmClick(onDelete);
  return (
    <button
      className={
        confirming
          ? "text-xs font-semibold whitespace-nowrap text-destructive px-1.5 py-0.5 rounded bg-destructive/15 hover:bg-destructive/25"
          : className ?? "text-muted-foreground hover:text-destructive"
      }
      title={confirming ? "Click again to confirm delete" : title}
      onClick={onClick}
    >
      {confirming ? "Confirm delete" : <Trash2 className={iconClassName ?? "h-3.5 w-3.5"} />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// AnalysisCard — expanded card view
// ---------------------------------------------------------------------------

function AnalysisCard({ group, xlmUsdPrice }: { group: SavedAnalysis[]; xlmUsdPrice: number | null }) {
  const analysis = group[0]; // most recent snapshot — drives header, editing, Top Destinations
  const history = group; // all snapshots for this asset+issuer+network, newest first
  const { updateName, updateNotes, updateTags, remove, saveAnalysis } = useSavedAnalyses();
  const { rerunning, error: rerunError, rerun } = useRerun(analysis, saveAnalysis);
  const { confirming: confirmingDelete, onClick: handleDeleteClick } = useConfirmClick(() => remove(analysis.id));
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
            {history.length > 1 && (
              <>
                {" · "}
                <span className="font-semibold text-foreground">{history.length} snapshots</span>
              </>
            )}
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
            {formatUsdEstimate(analysis.result.totalXlmProceeds, xlmUsdPrice) && (
              <p className="text-[11px] text-muted-foreground font-mono">
                {formatUsdEstimate(analysis.result.totalXlmProceeds, xlmUsdPrice)}
              </p>
            )}
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
            title="View full data in Asset Sales — cross-check against a live scan"
            onClick={() => window.open(assetSalesUrl(analysis), "_blank")}
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
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
            size={confirmingDelete ? "sm" : "icon"}
            className={
              confirmingDelete
                ? "h-8 px-2 text-xs font-semibold whitespace-nowrap bg-destructive/15 text-destructive hover:bg-destructive/25 hover:text-destructive"
                : "h-8 w-8 text-muted-foreground hover:text-destructive"
            }
            title={
              confirmingDelete
                ? "Click again to confirm delete"
                : history.length > 1
                  ? "Delete latest snapshot"
                  : "Delete"
            }
            onClick={handleDeleteClick}
          >
            {confirmingDelete ? "Confirm delete" : <Trash2 className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border px-4 pb-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
            <div>
              <p className="text-xs text-muted-foreground">XLM Proceeds</p>
              <p className="font-mono font-semibold">{formatXlm(analysis.result.totalXlmProceeds)} XLM</p>
              {formatUsdEstimate(analysis.result.totalXlmProceeds, xlmUsdPrice) && (
                <p className="text-[11px] text-muted-foreground font-mono">
                  {formatUsdEstimate(analysis.result.totalXlmProceeds, xlmUsdPrice)}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Asset Sold</p>
              <p className="font-mono font-semibold">{formatXlm(analysis.result.totalAssetSold)} {analysis.assetCode}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Outgoing XLM</p>
              <p className="font-mono font-semibold">{formatXlm(analysis.result.totalOutgoingXlm)} XLM</p>
              {formatUsdEstimate(analysis.result.totalOutgoingXlm, xlmUsdPrice) && (
                <p className="text-[11px] text-muted-foreground font-mono">
                  {formatUsdEstimate(analysis.result.totalOutgoingXlm, xlmUsdPrice)}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Est. On Hand</p>
              <p className="font-mono font-semibold">{formatXlm(analysis.result.estimatedOnHandXlm)} XLM</p>
              {formatUsdEstimate(analysis.result.estimatedOnHandXlm ?? 0, xlmUsdPrice) && (
                <p className="text-[11px] text-muted-foreground font-mono">
                  {formatUsdEstimate(analysis.result.estimatedOnHandXlm ?? 0, xlmUsdPrice)}
                </p>
              )}
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

          {history.length > 1 && (
            <div className="mt-4">
              <h4 className="text-sm font-semibold mb-1">Snapshot History ({history.length})</h4>
              <div className="overflow-x-auto border rounded-md">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/40 text-muted-foreground">
                      <th className="px-3 py-2 text-left font-medium">Saved</th>
                      <th className="px-3 py-2 text-right font-medium">XLM Proceeds</th>
                      <th className="px-3 py-2 text-right font-medium">Asset Sold</th>
                      <th className="px-3 py-2 text-right font-medium">Outgoing</th>
                      <th className="px-3 py-2 text-right font-medium">On Hand</th>
                      <th className="px-3 py-2 text-right font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((snap) => (
                      <tr key={snap.id} className="border-b last:border-0">
                        <td className="px-3 py-2 whitespace-nowrap">
                          {new Date(snap.timestamp).toLocaleString()}
                          {snap.id === analysis.id && (
                            <span className="ml-1.5 text-[9px] uppercase tracking-wide font-semibold px-1 py-px rounded border border-primary/40 bg-primary/10 text-primary">
                              latest
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-mono">
                          {formatXlm(snap.result.totalXlmProceeds)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-mono">
                          {formatXlm(snap.result.totalAssetSold)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-mono">
                          {formatXlm(snap.result.totalOutgoingXlm)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-mono">
                          {formatXlm(snap.result.estimatedOnHandXlm ?? 0)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <ConfirmDeleteButton
                            title="Delete this snapshot"
                            onDelete={() => remove(snap.id)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <h4 className="text-sm font-semibold mt-4 mb-1">
            Top Destinations{history.length > 1 ? " (latest snapshot)" : ""}
          </h4>
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
  const { confirming: confirmingDelete, onClick: handleDeleteClick } = useConfirmClick(() => remove(a.id));

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
            title="View full data in Asset Sales — cross-check against a live scan"
            onClick={() => window.open(assetSalesUrl(a), "_blank")}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
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
            size={confirmingDelete ? "sm" : "icon"}
            className={
              confirmingDelete
                ? "h-7 px-2 text-xs font-semibold whitespace-nowrap bg-destructive/15 text-destructive hover:bg-destructive/25 hover:text-destructive"
                : "h-7 w-7 text-muted-foreground hover:text-destructive"
            }
            title={confirmingDelete ? "Click again to confirm delete" : "Delete"}
            onClick={handleDeleteClick}
          >
            {confirmingDelete ? "Confirm delete" : <Trash2 className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// AggregateStats — Phase 3
// ---------------------------------------------------------------------------

function AggregateStats({ analyses, xlmUsdPrice }: { analyses: SavedAnalysis[]; xlmUsdPrice: number | null }) {
  if (analyses.length === 0) return null;

  const totalXlm = analyses.reduce((s, a) => s + a.result.totalXlmProceeds, 0);
  const totalOutgoing = analyses.reduce((s, a) => s + a.result.totalOutgoingXlm, 0);
  const uniqueAssets = new Set(analyses.map((a) => `${a.assetCode}:${a.issuer}`)).size;
  const uniqueIssuers = new Set(analyses.map((a) => a.issuer)).size;
  const top = [...analyses].sort((a, b) => b.result.totalXlmProceeds - a.result.totalXlmProceeds)[0];

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {[
        {
          label: "Total XLM Proceeds",
          value: formatXlm(totalXlm) + " XLM",
          sub: formatUsdEstimate(totalXlm, xlmUsdPrice) ?? undefined,
        },
        {
          label: "Total Outgoing XLM",
          value: formatXlm(totalOutgoing) + " XLM",
          sub: formatUsdEstimate(totalOutgoing, xlmUsdPrice) ?? undefined,
        },
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

const PAGE_SIZE = 10;

export function SavedAnalysesPanel() {
  const { analyses, isLoaded, error } = useSavedAnalyses();
  const { price: xlmUsdPrice, ensure: ensureXlmUsdPrice } = useXlmUsdPrice();
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"cards" | "table">("cards");
  const [sort, setSort] = useState<Sort>({ field: "timestamp", dir: "desc" });
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    ensureXlmUsdPrice();
  }, [ensureXlmUsdPrice]);

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
  // One group per asset+issuer+network — re-running an analysis adds a new
  // snapshot to its group instead of a separate top-level row.
  const groupedFiltered = useMemo(() => groupAnalyses(sortedFiltered), [sortedFiltered]);

  // Reset pagination whenever the underlying list changes shape — otherwise
  // a search/sort change could leave visibleCount pointing past the new list.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [query, view, sort.field, sort.dir]);

  // Cards paginate by group (one asset = one card); Table paginates by row.
  const totalItems = view === "table" ? sortedFiltered.length : groupedFiltered.length;
  const visibleGroups = groupedFiltered.slice(0, visibleCount);
  const visibleRows = sortedFiltered.slice(0, visibleCount);
  const hasMore = visibleCount < totalItems;

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

      {/* Aggregate stats — latest snapshot per asset, so re-run history doesn't inflate totals */}
      <AggregateStats analyses={latestPerGroup(analyses)} xlmUsdPrice={xlmUsdPrice} />

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

      {/* Cross-asset destinations — latest snapshot per asset, same double-counting fix as above */}
      {analyses.length > 1 && <CrossAssetDestinations analyses={latestPerGroup(filtered)} />}

      {/* Main content */}
      {!isLoaded ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading saved analyses…
        </div>
      ) : error ? (
        <Card>
          <CardContent className="py-8 text-center text-sm">
            <p className="text-destructive flex items-center justify-center gap-1.5">
              <AlertTriangle className="h-4 w-4" />
              Failed to load saved analyses: {error}
            </p>
            <p className="text-muted-foreground mt-1">Retrying automatically…</p>
          </CardContent>
        </Card>
      ) : analyses.length === 0 ? (
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
        <>
          <TableView analyses={visibleRows} sort={sort} onSortChange={setSort} />
          {hasMore && (
            <div className="flex items-center justify-center gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}>
                Load 10 More
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setVisibleCount(totalItems)}>
                Load All ({totalItems - visibleCount} more)
              </Button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="space-y-3">
            {visibleGroups.map((group) => (
              <AnalysisCard key={groupKey(group[0])} group={group} xlmUsdPrice={xlmUsdPrice} />
            ))}
          </div>
          {hasMore && (
            <div className="flex items-center justify-center gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}>
                Load 10 More
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setVisibleCount(totalItems)}>
                Load All ({totalItems - visibleCount} more)
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
