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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSavedAnalyses, loadSavedAnalysis } from "@/hooks/use-saved-analyses";
import { ADDRESS_COLORS, useAddressBook } from "@/hooks/use-address-book";
import type { SavedAnalysisSummary } from "@/hooks/use-saved-analyses";
import { useXlmUsdPrice } from "@/hooks/use-xlm-usd-price";
import { useConfirmClick } from "@/hooks/use-confirm-click";
import { ShortAddress } from "@/components/shared/ShortAddress";
import { ProceedsDestinationsTable } from "@/components/shared/proceeds/ProceedsDestinationsTable";
import { WindowedSalesStats } from "@/components/shared/proceeds/WindowedSalesStats";
import { fetchAssetXlmProceeds } from "@/lib/proceeds-investigator/fetchers";
import { formatXlm, formatUsdEstimate } from "@/lib/format";
import { getErrorMessage, timeAgo } from "@/lib/stellar-helpers";
import { NETWORK_LABELS, resolveHorizonUrl, useSettings } from "@/lib/settings";
import type { Network, Settings } from "@/lib/settings";
import { SnapshotCompare } from "./SnapshotCompare";
import { classifyAdPayment } from "@/lib/saved-analyses/ad-payments";
import type { AdPaymentClassification } from "@/lib/saved-analyses/ad-payments";
import { StrKey } from "stellar-sdk";

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
function groupKey(a: SavedAnalysisSummary): string {
  return `${a.assetCode}:${a.issuer}:${a.network}`;
}

function groupAnalyses(analyses: SavedAnalysisSummary[]): SavedAnalysisSummary[][] {
  const map = new Map<string, SavedAnalysisSummary[]>();
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
function latestPerGroup(analyses: SavedAnalysisSummary[]): SavedAnalysisSummary[] {
  return groupAnalyses(analyses).map((g) => g[0]);
}

/** Deep-link to Asset Sales, pre-filled + auto-run — same param contract as
 *  AssetLookupPanel's "View full data in Asset Sales" and Search History's
 *  "Run Asset Sales" (asset/issuer/account/autorun). Lets you cross-check a
 *  saved snapshot against a live scan. */
function assetSalesUrl(analysis: SavedAnalysisSummary): string {
  const params = new URLSearchParams({
    asset: analysis.assetCode,
    issuer: analysis.issuer,
    account: analysis.distribAddresses.join("\n"),
    autorun: "1",
  });
  return `/asset-sales?${params.toString()}`;
}

function sortAnalyses(analyses: SavedAnalysisSummary[], sort: Sort): SavedAnalysisSummary[] {
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

type SaveAnalysisFn = (entry: Omit<import("@/hooks/use-saved-analyses").SavedAnalysis, "id" | "timestamp">) => string;

export async function rerunAnalysis(
  analysis: SavedAnalysisSummary,
  settings: Settings,
  saveAnalysis: SaveAnalysisFn,
  signal: AbortSignal,
): Promise<void> {
  if (analysis.network !== "public") {
    throw new Error("This saved analysis uses a network that is no longer available for re-runs.");
  }
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
  if (signal.aborted) return;
  saveAnalysis({
    name: analysis.name,
    assetCode: analysis.assetCode,
    issuer: analysis.issuer,
    distribAddresses: analysis.distribAddresses,
    network: analysis.network,
    result,
    notes: analysis.notes,
    tags: analysis.tags,
  });
}

/** Shared re-run state/handler — one instance per row, used by both Card and Table views. */
function useRerun(analysis: SavedAnalysisSummary, saveAnalysis: SaveAnalysisFn) {
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

function AnalysisCard({ group, xlmUsdPrice }: { group: SavedAnalysisSummary[]; xlmUsdPrice: number | null }) {
  const analysis = group[0]; // most recent snapshot — drives header, editing, Top Destinations
  const history = group; // all snapshots for this asset+issuer+network, newest first
  const { updateName, updateNotes, updateTags, remove, saveAnalysis } = useSavedAnalyses({ load: false });
  const { rerunning, error: rerunError, rerun } = useRerun(analysis, saveAnalysis);
  const { confirming: confirmingDelete, onClick: handleDeleteClick } = useConfirmClick(() => remove(analysis.id));
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<import("@/hooks/use-saved-analyses").SavedAnalysis | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailAttempt, setDetailAttempt] = useState(0);
  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    setDetail(null);
    setDetailError(null);
    loadSavedAnalysis(analysis.id, controller.signal).then((loaded) => { if (!controller.signal.aborted) setDetail(loaded); }).catch((error) => {
      if (!controller.signal.aborted) setDetailError(String(error));
    });
    return () => controller.abort();
  }, [analysis.id, expanded, detailAttempt]);
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
            {detailError ? <div role="alert" className="text-sm text-destructive">{detailError} <Button size="sm" variant="outline" onClick={() => setDetailAttempt((n) => n + 1)}>Retry</Button></div> : !detail ? <p className="text-sm text-muted-foreground">Loading snapshot detail…</p> : <WindowedSalesStats
              ledger={detail.result.proceedsLedger}
              assetCode={analysis.assetCode}
              xlmUsdPrice={xlmUsdPrice}
            />}
            <p className="text-[11px] text-muted-foreground mt-1">
              Based on this snapshot&apos;s scanned trades — re-run to include sales since {timeAgo(analysis.timestamp)}.
            </p>
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
            undistributedXlm={analysis.result.estimatedOnHandXlm}
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
  analyses: SavedAnalysisSummary[];
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

function TableRow({ analysis: a }: { analysis: SavedAnalysisSummary }) {
  const { remove, saveAnalysis } = useSavedAnalyses({ load: false });
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

function AggregateStats({ analyses, xlmUsdPrice }: { analyses: SavedAnalysisSummary[]; xlmUsdPrice: number | null }) {
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

function CrossAssetDestinations({ analyses }: { analyses: SavedAnalysisSummary[] }) {
  const [show, setShow] = useState(false);

  const aggregated = useMemo(() => {
    const map = new Map<string, { address: string; network: string; totalXlm: number; assetCount: Set<string>; txCount: number }>();
    for (const a of analyses) {
      for (const d of a.result.topDestinations) {
        const key = `${a.network}:${d.address}`;
        const existing = map.get(key);
        if (existing) {
          existing.totalXlm += d.totalXlm;
          existing.assetCount.add(`${a.assetCode}:${a.issuer}`);
          existing.txCount += d.count;
        } else {
          map.set(key, { address: d.address, network: a.network, totalXlm: d.totalXlm, assetCount: new Set([`${a.assetCode}:${a.issuer}`]), txCount: d.count });
        }
      }
    }
    return [...map.entries()]
      .map(([, v]) => ({ address: v.address, network: v.network, totalXlm: v.totalXlm, assetCount: v.assetCount.size, txCount: v.txCount }))
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
                    key={`${row.network}:${row.address}`}
                    className={`border-b last:border-0 ${row.assetCount > 1 ? "bg-yellow-500/5" : ""}`}
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <ShortAddress address={row.address} network={row.network} />
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

function classifySummaryAdPayment(analysis: SavedAnalysisSummary, recipient: string): AdPaymentClassification {
  if (!Array.isArray(analysis.result?.outgoingLedger)) return {
    status: "unknown", paidXlm: 0, percentage: null, requiredXlm: 0, shortfallXlm: 0, evidence: [], reason: "Open Ad payments to load snapshot evidence.",
  };
  return classifyAdPayment(analysis.result as import("@/lib/proceeds-investigator/types").AssetProceedsResult, recipient);
}

export function AdPaymentsSection({ analyses, onClassifications }: { analyses: SavedAnalysisSummary[]; onClassifications?: (value: { recipient: string; items: Record<string, AdPaymentClassification> }) => void }) {
  const { settings, updateSettings } = useSettings();
  const { saveAnalysis } = useSavedAnalyses({ load: false });
  const { entries } = useAddressBook();
  const [statusFilter, setStatusFilter] = useState<"all" | AdPaymentClassification["status"]>("all");
  const [draftState, setDraftState] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const draft = draftState ?? settings.adPaymentRecipient;
  const recipientEntry = entries.find((entry) => entry.publicKey === settings.adPaymentRecipient);
  const [detailCount, setDetailCount] = useState(10);
  const [details, setDetails] = useState<Record<string, import("@/hooks/use-saved-analyses").SavedAnalysis>>({});
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailAttempt, setDetailAttempt] = useState(0);
  const selected = useMemo(() => latestPerGroup(analyses).slice(0, detailCount), [analyses, detailCount]);
  useEffect(() => {
    const controller = new AbortController();
    setDetailError(null);
    (async () => {
      for (const analysis of selected) {
        if (analysis.result?.outgoingLedger !== undefined || details[analysis.id]) continue;
        const detail = await loadSavedAnalysis(analysis.id, controller.signal);
        if (controller.signal.aborted) return;
        setDetails((previous) => ({ ...previous, [analysis.id]: detail }));
      }
    })().catch((error) => { if (!controller.signal.aborted) setDetailError(String(error)); });
    return () => controller.abort();
  // Details stream in one by one; do not restart the request sequence on each result.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, detailAttempt]);
  const loadingDetails = selected.some((analysis) => analysis.result?.outgoingLedger === undefined && !details[analysis.id]);
  const latest = useMemo(() => {
    const order = { compliant: 0, unpaid: 1, underpaid: 2, unknown: 3 };
    return selected
      .map((summary) => {
        const analysis = details[summary.id] ? { ...summary, result: details[summary.id].result } : summary;
        return { analysis, classification: classifySummaryAdPayment(analysis, settings.adPaymentRecipient) };
      })
      .sort((a, b) => order[a.classification.status] - order[b.classification.status]);
  }, [selected, details, settings.adPaymentRecipient]);
  useEffect(() => {
    onClassifications?.({ recipient: settings.adPaymentRecipient, items: Object.fromEntries(latest.map(({ analysis, classification }) => [analysis.id, classification])) });
  }, [latest, onClassifications, settings.adPaymentRecipient]);
  const validRecipient = StrKey.isValidEd25519PublicKey(settings.adPaymentRecipient ?? "");
  const counts = { all: latest.length, compliant: 0, unpaid: 0, underpaid: 0, unknown: 0 };
  const totals = new Map<string, { paid: number; required: number; shortfall: number }>();
  for (const { analysis, classification } of latest) {
    counts[classification.status]++;
    if (classification.status === "unknown") continue;
    const total = totals.get(analysis.network) ?? { paid: 0, required: 0, shortfall: 0 };
    total.paid += classification.paidXlm;
    total.required += classification.requiredXlm;
    total.shortfall += classification.shortfallXlm;
    totals.set(analysis.network, total);
  }
  const visible = latest.filter(({ classification }) => statusFilter === "all" || classification.status === statusFilter);

  const saveRecipient = () => {
    const recipient = draft.trim();
    if (!StrKey.isValidEd25519PublicKey(recipient)) {
      setValidationError("Enter a valid Stellar G-address.");
      return;
    }
    setValidationError(null);
    setDraftState(null);
    updateSettings({ adPaymentRecipient: recipient });
  };

  const clearRecipient = () => {
    setValidationError(null);
    setDraftState(null);
    updateSettings({ adPaymentRecipient: "" });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Ad payments</CardTitle>
        <CardDescription className="text-xs">
          Check the latest saved snapshot for each asset against the configured 25% recipient.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="ad-payment-contact" className="text-xs font-medium">Choose from Address Book</label>
          <select
            id="ad-payment-contact"
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={recipientEntry?.publicKey ?? ""}
            onChange={(event) => {
              if (!event.target.value) return;
              updateSettings({ adPaymentRecipient: event.target.value });
              setDraftState(null);
              setValidationError(null);
            }}
          >
            <option value="">Select a saved address</option>
            {entries.filter((entry) => StrKey.isValidEd25519PublicKey(entry.publicKey)).map((entry) => (
              <option key={entry.publicKey} value={entry.publicKey}>{entry.label} · {entry.publicKey}</option>
            ))}
          </select>
          {recipientEntry ? (
            <p className="flex items-center gap-2 text-xs">
              <span aria-hidden="true" className={`h-2 w-2 rounded-full ${ADDRESS_COLORS[recipientEntry.color ?? "gray"].dot}`} />
              Linked to {recipientEntry.label}
            </p>
          ) : validRecipient ? (
            <p className="text-xs text-muted-foreground">This recipient is not in Address Book. Its saved address is still used.</p>
          ) : null}
          <a href="/address-book" className="text-xs underline">Open Address Book</a>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[min(100%,28rem)] flex-1">
            <label htmlFor="ad-payment-recipient" className="text-xs font-medium">Ad payment recipient</label>
            <Input
              id="ad-payment-recipient"
              aria-describedby={validationError ? "ad-payment-recipient-error" : undefined}
              aria-invalid={validationError ? "true" : undefined}
              value={draft}
              onChange={(event) => { setDraftState(event.target.value); setValidationError(null); }}
              placeholder="G..."
              className="mt-1 font-mono text-xs"
            />
            {validationError && <p id="ad-payment-recipient-error" role="alert" className="mt-1 text-xs text-destructive">{validationError}</p>}
            <p className="mt-1 text-[11px] text-muted-foreground">Saved in this browser and used for all saved analyses.</p>
          </div>
          <Button size="sm" onClick={saveRecipient}>Save</Button>
          <Button size="sm" variant="outline" onClick={clearRecipient}>Clear</Button>
        </div>

        {!validRecipient ? (
          <p className="text-sm text-muted-foreground">Configure a valid recipient to classify ad payments.</p>
        ) : latest.length === 0 ? (
          <p className="text-sm text-muted-foreground">No saved analyses yet.</p>
        ) : (
          <section aria-label="Ad payment results" className="space-y-3">
            {loadingDetails && !detailError && <p className="text-sm text-muted-foreground">Loading snapshot evidence…</p>}
            {detailError && <div role="alert" className="text-sm text-destructive">{detailError} <Button size="sm" variant="outline" onClick={() => setDetailAttempt((n) => n + 1)}>Retry</Button></div>}
            <p className="text-xs text-muted-foreground">Reviewing {selected.length} of {latestPerGroup(analyses).length} assets. Totals cover loaded evidence.</p>
            {detailCount < latestPerGroup(analyses).length && <Button size="sm" variant="outline" onClick={() => setDetailCount((n) => n + 10)}>Load more assets</Button>}
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter ad payments by status">
              {(["all", "compliant", "unpaid", "underpaid", "unknown"] as const).map((status) => (
                <Button key={status} size="sm" variant={statusFilter === status ? "default" : "outline"} aria-pressed={statusFilter === status} onClick={() => setStatusFilter(status)}>
                  {status[0].toUpperCase() + status.slice(1)} ({counts[status]})
                </Button>
              ))}
            </div>
            <div aria-label="Ad payment snapshot totals" className="space-y-2 rounded-md bg-muted/40 p-3 text-xs">
              <p className="font-medium">Snapshot totals · all statuses</p>
              {[...totals].map(([network, total]) => (
                <div key={network} className="space-y-1">
                  <p className="font-medium">{NETWORK_LABELS[network as keyof typeof NETWORK_LABELS] ?? network}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <span>Observed total: {formatXlm(total.paid)} XLM</span>
                    <span>Required total (25%): {formatXlm(total.required)} XLM</span>
                    <span>Shortfall total: {formatXlm(total.shortfall)} XLM</span>
                  </div>
                </div>
              ))}
              <p className="text-muted-foreground">Latest snapshot per asset. Unknown results are excluded from totals. Shared distribution accounts can count the same payment across assets.</p>
            </div>
            <div className="space-y-2" aria-label="Ad payment assets">
              {visible.length === 0 && <p className="text-sm text-muted-foreground">No assets match this status.</p>}
              {visible.map(({ analysis, classification }) => (
                <AdPaymentRow key={`${analysis.assetCode}:${analysis.issuer}:${analysis.network}`} analysis={analysis} classification={classification} settings={settings} saveAnalysis={saveAnalysis} />
              ))}
            </div>
          </section>
        )}
      </CardContent>
    </Card>
  );
}

function AdPaymentRow({ analysis, classification, settings, saveAnalysis }: {
  analysis: SavedAnalysisSummary;
  classification: AdPaymentClassification;
  settings: Settings;
  saveAnalysis: SaveAnalysisFn;
}) {
  const { rerunning, error, rerun } = useRerun(analysis, saveAnalysis);
  const status = classification.status[0].toUpperCase() + classification.status.slice(1);
  const explorer = resolveHorizonUrl({ network: analysis.network as Network, localHorizonUrl: settings.localHorizonUrl });
  return (
    <div className="rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium break-all">{analysis.assetCode} · {analysis.issuer}</p>
          <p className="text-xs text-muted-foreground"><span title={new Date(analysis.timestamp).toLocaleString()}>Snapshot saved {timeAgo(analysis.timestamp)}</span> · {NETWORK_LABELS[analysis.network as keyof typeof NETWORK_LABELS] ?? analysis.network}</p>
        </div>
        <div className="flex items-center gap-2"><span className="font-semibold">{status}</span><Button size="sm" variant="outline" onClick={rerun} disabled={rerunning}>{rerunning ? "Refreshing…" : "Refresh"}</Button></div>
      </div>
      {error && <p role="alert" className="mt-1 text-xs text-destructive">Refresh failed: {error}</p>}
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <span>Observed: {classification.status === "unknown" ? "—" : `${formatXlm(classification.paidXlm)} XLM`}</span>
        <span>Share: {classification.percentage == null ? "—" : `${classification.percentage.toFixed(7).replace(/0+$/, "").replace(/\.$/, "")}%`}</span>
        <span>Required: {classification.status === "unknown" ? "—" : `${formatXlm(classification.requiredXlm)} XLM (25%)`}</span>
        <span>Shortfall: {classification.status === "unknown" ? "—" : `${formatXlm(classification.shortfallXlm)} XLM`}</span>
      </div>
      {classification.reason && <p className="mt-1 text-xs text-muted-foreground">{classification.reason}</p>}
      <p className="mt-1 text-[11px] text-muted-foreground">Observed outgoing XLM from this snapshot’s distribution accounts; shared accounts can overlap across assets.</p>
      {classification.evidence.length > 0 && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer underline">Transactions ({classification.evidence.length})</summary>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            {classification.evidence.map((entry) => (
              <li key={entry.id}>
                {formatXlm(entry.amountXlm)} XLM · {new Date(entry.createdAt).toLocaleString()} · {entry.category} · source <ShortAddress address={entry.from ?? entry.account} network={analysis.network as "public" | "testnet"} />
                {entry.category === "path_native_out" && <span className="ml-1">(sent, not necessarily received)</span>}
                {entry.txHash && <a className="ml-1 underline" href={`${explorer}/transactions/${encodeURIComponent(entry.txHash)}`} target="_blank" rel="noreferrer">View transaction</a>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SavedAnalysesPanel — main export
// ---------------------------------------------------------------------------

const PAGE_SIZE = 10;

export function SavedAnalysesPanel() {
  const { analyses, isLoaded, error, loadingHistory, retry } = useSavedAnalyses();
  const { settings } = useSettings();
  const { price: xlmUsdPrice, ensure: ensureXlmUsdPrice } = useXlmUsdPrice();
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"cards" | "table">("cards");
  const [section, setSection] = useState("analyses");
  const [sort, setSort] = useState<Sort>({ field: "timestamp", dir: "desc" });
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const legacyAnalyses = useMemo(
    () => analyses.filter((analysis) => {
      const result = analysis.result as Partial<NonNullable<SavedAnalysisSummary["result"]>> | null | undefined;
      return !!result
        && Number.isFinite(result.totalXlmProceeds)
        && Number.isFinite(result.totalAssetSold)
        && Number.isFinite(result.totalOutgoingXlm)
        && Number.isFinite(result.estimatedOnHandXlm)
        && Array.isArray(result.topDestinations);
    }),
    [analyses],
  );
  const [loadedClassifications, setLoadedClassifications] = useState<{ recipient: string; items: Record<string, AdPaymentClassification> } | null>(null);
  const adPaymentCounts = useMemo(() => {
    const counts = { compliant: 0, unpaid: 0, underpaid: 0, unknown: 0 };
    for (const analysis of latestPerGroup(analyses)) {
      const loaded = loadedClassifications?.recipient === settings.adPaymentRecipient ? loadedClassifications.items[analysis.id] : undefined;
      counts[(loaded ?? classifySummaryAdPayment(analysis, settings.adPaymentRecipient)).status]++;
    }
    return counts;
  }, [analyses, settings.adPaymentRecipient, loadedClassifications]);
  const adPaymentsToReview = adPaymentCounts.unpaid + adPaymentCounts.underpaid + adPaymentCounts.unknown;

  useEffect(() => {
    ensureXlmUsdPrice();
  }, [ensureXlmUsdPrice]);

  const filtered = useMemo(() => {
    if (!query.trim()) return legacyAnalyses;
    const q = query.toLowerCase();
    return legacyAnalyses.filter(
      (a) =>
        a.assetCode.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        (a.notes ?? "").toLowerCase().includes(q) ||
        (a.tags ?? []).some((t) => t.toLowerCase().includes(q)) ||
        a.issuer.toLowerCase().includes(q),
    );
  }, [legacyAnalyses, query]);

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
          {isLoaded && <p className="mt-1 text-xs text-muted-foreground">{analyses.length} saved snapshots · {latestPerGroup(analyses).length} assets · History is kept until you delete it.</p>}
        </div>
        {section === "analyses" && analyses.length > 0 && (
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

      {loadingHistory && <p className="text-sm text-muted-foreground">Loading older saved snapshots…</p>}
      {error && isLoaded && <div role="alert" className="text-sm text-destructive">{error} <Button size="sm" variant="outline" onClick={retry}>Retry history</Button></div>}
      {isLoaded && analyses.length > 0 && (
        <div aria-label="Ad payment status summary" className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{latestPerGroup(analyses).length} assets</span>
          <span>{adPaymentCounts.compliant} compliant</span>
          <span>{adPaymentCounts.unpaid} unpaid</span>
          <span>{adPaymentCounts.underpaid} underpaid</span>
          {adPaymentCounts.unknown > 0 && <span>{adPaymentCounts.unknown} unknown</span>}
        </div>
      )}

      <Tabs value={section} onValueChange={setSection} className="space-y-4">
        <TabsList aria-label="Saved analyses sections">
          <TabsTrigger value="analyses">Analyses ({latestPerGroup(analyses).length})</TabsTrigger>
          <TabsTrigger value="ad-payments">Ad payments ({adPaymentsToReview})</TabsTrigger>
          <TabsTrigger value="connections">Connections</TabsTrigger>
        </TabsList>

        <TabsContent value="analyses" className="space-y-6">
          <AggregateStats analyses={latestPerGroup(legacyAnalyses)} xlmUsdPrice={xlmUsdPrice} />

          {/* Search */}
          {legacyAnalyses.length > 0 && (
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
        </TabsContent>

        <TabsContent value="ad-payments" className="space-y-6">
          {section === "ad-payments" && <AdPaymentsSection analyses={analyses} onClassifications={setLoadedClassifications} />}
        </TabsContent>

        <TabsContent value="connections" className="space-y-6">
          {section === "connections" && (legacyAnalyses.length > 1 ? (
            <>
              <SnapshotCompare analyses={filtered} />
              <CrossAssetDestinations analyses={latestPerGroup(filtered)} />
            </>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                Save at least two analyses to compare snapshots and find shared destinations.
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
