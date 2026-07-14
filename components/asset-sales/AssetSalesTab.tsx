"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { StrKey } from "stellar-sdk";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  AlertTriangle,
  BookmarkCheck,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  RefreshCw,
  Save,
  Search,
  Trash2,
  TrendingDown,
  X,
} from "lucide-react";
import { useSettings, resolveHorizonUrl, type Network } from "@/lib/settings";
import { useProceedsHistory } from "./useProceedsHistory";
import { getErrorMessage } from "@/lib/stellar-helpers";
import { ShortAddress } from "@/components/shared/ShortAddress";
import { inferDistribLite } from "@/lib/asset-lookup/fetchers";
import { fetchAssetXlmProceeds } from "@/lib/proceeds-investigator/fetchers";
import { formatXlm, formatUsdEstimate, parseAddresses } from "@/lib/format";
import { useSavedSearches } from "@/hooks/use-saved-searches";
import { useSavedAnalyses } from "@/hooks/use-saved-analyses";
import { useBulkScanState } from "@/hooks/use-bulk-scan-state";
import { useConfirmClick } from "@/hooks/use-confirm-click";
import { parseAssetPairs } from "@/lib/asset-pair";
import { useXlmUsdPrice } from "@/hooks/use-xlm-usd-price";
import { fetchHomeDomain } from "@/components/shared/ChainDisplay";
import { assetKey, diffSnapshots } from "@/lib/saved-analyses/diff";
import { DeltaBadge, FieldDeltaCard } from "@/components/saved-analyses/SnapshotCompare";
import { timeAgo } from "@/lib/stellar-helpers";
import type { SavedAnalysis } from "@/hooks/use-saved-analyses";
import {
  notifyIfHidden,
  requestNotificationPermission,
} from "@/lib/notifications";
import type { AssetProceedsResult } from "@/lib/proceeds-investigator/types";
import {
  ProceedsStatsCards,
  ProceedsDestinationsTable,
  SaveToGroupButton,
  ProceedsStatusBadge,
  WindowedSalesStats,
} from "@/components/shared/proceeds";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AssetRowStatus = "pending" | "inferring" | "scanning" | "done" | "error";

interface PriorSaveInfo {
  matches: SavedAnalysis[]; // sorted newest-first
}

interface AssetRow {
  assetCode: string;
  issuer: string;
  status: AssetRowStatus;
  error?: string;
  distribAddress?: string;
  homeDomain?: string;
  inferReason?: string;
  result?: AssetProceedsResult;
  priorSave?: PriorSaveInfo | null;
  skippedUnchanged?: boolean;
  newSaveId?: string;
  elapsedMs?: number;
  expanded: boolean;
}

/** True when a fresh result is identical (all tracked fields + destinations) to the given prior save. */
function isUnchangedSince(prior: SavedAnalysis, result: AssetProceedsResult): boolean {
  const diff = diffSnapshots(prior, { ...prior, timestamp: Date.now(), result });
  return diff.fields.every((f) => f.delta === 0) && diff.destinations.length === 0;
}

// ---------------------------------------------------------------------------
// Concurrency helpers
// ---------------------------------------------------------------------------

const CONCURRENCY = 3;

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

async function runConcurrent<T>(
  items: T[],
  concurrency: number,
  fn: (index: number, item: T) => Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  let next = 0;
  async function worker() {
    while (!signal.aborted) {
      const i = next++;
      if (i >= items.length) return;
      await fn(i, items[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
}

// ---------------------------------------------------------------------------
// "Since Last Save" — field + destination diff against the most recent prior
// Saved Analyses entry for this exact asset+issuer+network. Mirrors the
// Compare Snapshots diff on the Saved Analyses page, surfaced inline here so
// you don't have to leave the page to see what changed since last run.
// ---------------------------------------------------------------------------

function SavedEntryRow({
  analysis,
  xlmUsdPrice,
  isLatest,
  onDelete,
}: {
  analysis: SavedAnalysis;
  xlmUsdPrice: number | null;
  isLatest: boolean;
  onDelete: (id: string) => void;
}) {
  const { confirming, onClick } = useConfirmClick(() => onDelete(analysis.id));
  return (
    <div className="flex items-center gap-2 text-xs py-1">
      <span className="text-muted-foreground w-20 shrink-0">{timeAgo(analysis.timestamp)}</span>
      <span className="font-mono">
        {formatXlm(analysis.result.totalXlmProceeds)} XLM
        {xlmUsdPrice != null && (
          <span className="text-muted-foreground ml-1">({formatUsdEstimate(analysis.result.totalXlmProceeds, xlmUsdPrice)})</span>
        )}
      </span>
      {isLatest && <span className="text-[10px] text-muted-foreground">(most recent)</span>}
      <Button
        variant="ghost"
        size="sm"
        className={`ml-auto h-6 px-2 text-xs ${confirming ? "text-destructive" : "text-muted-foreground"}`}
        onClick={onClick}
        title={confirming ? "Click again to confirm delete" : "Delete this saved analysis"}
      >
        {confirming ? "Confirm delete" : <Trash2 className="h-3 w-3" />}
      </Button>
    </div>
  );
}

function SinceLastSave({
  priorSave,
  currentResult,
  network,
  xlmUsdPrice,
  skippedUnchanged,
  newSaveId,
  onDelete,
}: {
  priorSave: PriorSaveInfo;
  currentResult: AssetProceedsResult;
  network: string;
  xlmUsdPrice: number | null;
  skippedUnchanged: boolean;
  newSaveId?: string;
  onDelete: (id: string) => void;
}) {
  const [showAllSaves, setShowAllSaves] = useState(false);
  // Date.now() sampled via useState's lazy initializer (runs once, not on every
  // render) instead of directly in the render body, to stay a pure render —
  // this only stamps the synthetic "current" snapshot passed to diffSnapshots,
  // not anything displayed directly.
  const [mountedAt] = useState(() => Date.now());
  const lastAnalysis = priorSave.matches[0];
  const diff = diffSnapshots(lastAnalysis, { ...lastAnalysis, timestamp: mountedAt, result: currentResult });

  return (
    <div className="mt-6 border-t border-border pt-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h4 className="text-sm font-semibold flex items-center gap-2">
          Since Last Save
          <span className="text-xs font-normal text-muted-foreground">
            saved {priorSave.matches.length}× before · last {timeAgo(lastAnalysis.timestamp)}
          </span>
        </h4>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs text-muted-foreground"
          onClick={() => setShowAllSaves((v) => !v)}
        >
          {showAllSaves ? <ChevronDown className="h-3 w-3 mr-1" /> : <ChevronRight className="h-3 w-3 mr-1" />}
          Manage saves ({priorSave.matches.length}{newSaveId ? " + this run" : ""})
        </Button>
      </div>

      {showAllSaves && (
        <div className="mt-2 mb-3 rounded-md border border-border bg-muted/20 px-3 py-1 divide-y divide-border/60">
          {newSaveId && (
            <div className="flex items-center gap-2 text-xs py-1">
              <Check className="h-3 w-3 text-green-500 shrink-0" />
              <span className="font-mono">
                {formatXlm(currentResult.totalXlmProceeds)} XLM
                {xlmUsdPrice != null && (
                  <span className="text-muted-foreground ml-1">({formatUsdEstimate(currentResult.totalXlmProceeds, xlmUsdPrice)})</span>
                )}
              </span>
              <span className="text-[10px] text-muted-foreground">(just saved this run)</span>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-6 px-2 text-xs text-muted-foreground"
                onClick={() => onDelete(newSaveId)}
                title="Undo this run's save"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          )}
          {priorSave.matches.map((a, i) => (
            <SavedEntryRow key={a.id} analysis={a} xlmUsdPrice={xlmUsdPrice} isLatest={i === 0} onDelete={onDelete} />
          ))}
        </div>
      )}

      {skippedUnchanged ? (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-2">
          <Check className="h-3.5 w-3.5 text-green-500" />
          No changes since the last save — not saved again.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
            {diff.fields.map((f) => (
              <FieldDeltaCard
                key={f.key}
                label={f.label}
                before={f.before}
                after={f.after}
                delta={f.delta}
                xlmUsdPrice={xlmUsdPrice}
                isXlmAmount={f.key !== "totalAssetSold"}
              />
            ))}
          </div>

          <div className="mt-4">
            <h5 className="text-xs font-semibold text-muted-foreground mb-1.5">
              Destination Changes
            </h5>
            {diff.destinations.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">
                No destination changes since the last save.
              </p>
            ) : (
              <div className="overflow-x-auto border rounded-md">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/40 text-muted-foreground">
                      <th className="px-3 py-2 text-left font-medium">Destination</th>
                      <th className="px-3 py-2 text-left font-medium"></th>
                      <th className="px-3 py-2 text-right font-medium">Before</th>
                      <th className="px-3 py-2 text-right font-medium">After</th>
                      <th className="px-3 py-2 text-right font-medium">Δ XLM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diff.destinations.map((d) => (
                      <tr key={d.address} className="border-b last:border-0">
                        <td className="px-3 py-2">
                          <ShortAddress address={d.address} network={network as "public" | "testnet"} />
                        </td>
                        <td className="px-3 py-2">
                          <DeltaBadge kind={d.kind} />
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-mono">
                          {formatXlm(d.beforeXlm)}
                          {xlmUsdPrice != null && (
                            <div className="text-[10px] font-normal text-muted-foreground">{formatUsdEstimate(d.beforeXlm, xlmUsdPrice)}</div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-mono">
                          {formatXlm(d.afterXlm)}
                          {xlmUsdPrice != null && (
                            <div className="text-[10px] font-normal text-muted-foreground">{formatUsdEstimate(d.afterXlm, xlmUsdPrice)}</div>
                          )}
                        </td>
                        <td className={`px-3 py-2 text-right tabular-nums font-mono font-semibold ${d.deltaXlm > 0 ? "text-green-500" : d.deltaXlm < 0 ? "text-red-500" : ""}`}>
                          {d.deltaXlm > 0 ? "+" : ""}{formatXlm(d.deltaXlm)}
                          {xlmUsdPrice != null && (
                            <div className="text-[10px] font-normal text-muted-foreground">
                              {d.deltaXlm > 0 ? "+" : ""}{formatUsdEstimate(d.deltaXlm, xlmUsdPrice)}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

export function AssetSalesTab() {
  const router = useRouter();
  const { settings, updateSettings } = useSettings();
  const { upsert: upsertSearch } = useSavedSearches();
  const { analyses: savedAnalyses, saveAnalysis, remove: removeSavedAnalysis } = useSavedAnalyses();
  const {
    history: searchHistory,
    upsert: upsertHistory,
    remove: removeHistory,
  } = useProceedsHistory();
  const [assetsText, setAssetsText] = useState("");
  const [overrideAccountsText, setOverrideAccountsText] = useState("");
  const [rows, setRows] = useState<AssetRow[]>([]);
  const [running, setRunning] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [interrupted, setInterrupted] = useState(false);
  const [allSaved, setAllSaved] = useState(false);
  const [sequential, setSequential] = useState(false);
  const { price: xlmUsdPrice, ensure: ensureXlmUsdPrice } = useXlmUsdPrice();
  const abortRef = useRef<AbortController | null>(null);
  const bulkScanState = useBulkScanState<AssetRow>();
  const searchParams = useSearchParams();
  const prefilledRef = useRef(false);
  const pendingAutorunRef = useRef(false);

  const singlePair = parseAssetPairs(assetsText).length === 1;

  useEffect(() => {
    requestNotificationPermission();
  }, []);

  // Deep-link prefill — once, from either ?bulkAssets= (multi) or
  // ?asset=/?code=&issuer=&account= (single, e.g. from Asset Lookup /
  // Search History). Fires an autorun if requested once the text lands.
  useEffect(() => {
    if (prefilledRef.current) return;
    prefilledRef.current = true;
    const bulkAssets = searchParams.get("bulkAssets");
    const urlAsset = searchParams.get("asset") ?? searchParams.get("code");
    const urlIssuer = searchParams.get("issuer");
    const urlAccount = searchParams.get("account");
    const urlAutorun = searchParams.get("autorun") === "1";

    if (bulkAssets) {
      setAssetsText(bulkAssets);
    } else if (urlAsset && urlIssuer) {
      setAssetsText(`${urlAsset}:${urlIssuer}`);
      if (urlAccount) setOverrideAccountsText(urlAccount);
    }
    if (urlAutorun && (bulkAssets || (urlAsset && urlIssuer))) {
      pendingAutorunRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Abort any in-flight scan on unmount — without this, navigating away
  // mid-scan leaves runConcurrent's worker pool running invisibly in the
  // background (no UI to cancel it), which then compounds with whatever
  // scan-heavy module the user opens next.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // SSR output must be empty state; apply any persisted rows after mount.
  useEffect(() => {
    let cancelled = false;
    bulkScanState.load().then((persisted) => {
      if (cancelled || !persisted || persisted.rows.length === 0) return;
      const wasInterrupted = persisted.rows.some(
        (r) =>
          r.status === "pending" ||
          r.status === "inferring" ||
          r.status === "scanning",
      );
      const rows = persisted.rows.map((r) => ({
        ...r,
        expanded: true,
        ...(r.status === "pending" ||
        r.status === "inferring" ||
        r.status === "scanning"
          ? {
              status: "error" as AssetRowStatus,
              error: "Scan was interrupted (page refresh).",
            }
          : {}),
      }));
      setRows(rows);
      setInterrupted(wasInterrupted);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateRow = (index: number, patch: Partial<AssetRow>) => {
    setRows((prev) => {
      const next = prev.map((r, i) => (i === index ? { ...r, ...patch } : r));
      bulkScanState.save(next);
      return next;
    });
  };

  const handleRun = async () => {
    const pairs = parseAssetPairs(assetsText);
    if (pairs.length === 0) {
      setParseError("No valid CODE:ISSUER pairs found. Enter one per line.");
      return;
    }

    // Manual override only applies when there's exactly one asset — skip
    // auto-infer and use these addresses directly instead.
    let overrideAccounts: string[] = [];
    if (pairs.length === 1 && overrideAccountsText.trim()) {
      overrideAccounts = parseAddresses(overrideAccountsText);
      const invalid = overrideAccounts.find(
        (a) => !StrKey.isValidEd25519PublicKey(a),
      );
      if (invalid) {
        setParseError(`Invalid seller account address: ${invalid}`);
        return;
      }
    }

    setParseError(null);
    setInterrupted(false);
    setAllSaved(false);
    upsertHistory({
      assetsText: assetsText.trim(),
      network: settings.network,
      assetCount: pairs.length,
    });
    upsertSearch({
      type: "asset-sales-bulk",
      value: assetsText.trim(),
      label: `${pairs.length} asset${pairs.length === 1 ? "" : "s"}`,
      network: settings.network,
      accountsFound: pairs.length,
    });
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    const initial: AssetRow[] = pairs.map((p) => ({
      ...p,
      status: "pending",
      expanded: true,
    }));
    setRows(initial);
    bulkScanState.saveImmediate(initial, false);
    setRunning(true);

    const horizonUrl = resolveHorizonUrl(settings);

    // Fetch XLM/USD price in parallel with first batch
    ensureXlmUsdPrice();

    await runConcurrent(
      pairs,
      sequential ? 1 : CONCURRENCY,
      async (i, { assetCode, issuer }) => {
        const startedAt = Date.now();
        let distribAddress: string | undefined;
        let inferReason: string | undefined;
        let scanAccounts: string[];

        if (overrideAccounts.length > 0) {
          scanAccounts = overrideAccounts;
          distribAddress = overrideAccounts[0];
          updateRow(i, { status: "scanning", distribAddress });
          const hd = await fetchHomeDomain(horizonUrl, issuer, signal).catch(
            () => null,
          );
          if (!signal.aborted && hd) updateRow(i, { homeDomain: hd });
        } else {
          // Step 1: infer distribution address
          updateRow(i, { status: "inferring" });
          try {
            const candidates = await inferDistribLite(
              horizonUrl,
              assetCode,
              issuer,
              signal,
            );
            if (signal.aborted) return;
            if (candidates.length === 0) {
              updateRow(i, {
                status: "error",
                error:
                  "Could not infer a distribution address — the issuer has made no direct payments of this asset. " +
                  "Distribution may use DEX sell orders only. Enter seller accounts manually below.",
                elapsedMs: Date.now() - startedAt,
              });
              return;
            }
            distribAddress = candidates[0].address;
            inferReason = candidates[0].reason;
            scanAccounts = [distribAddress];

            // Fetch issuer home_domain in background (best-effort)
            const hd = await fetchHomeDomain(horizonUrl, issuer, signal);
            if (!signal.aborted && hd) updateRow(i, { homeDomain: hd });
          } catch (e) {
            if (signal.aborted) return;
            updateRow(i, {
              status: "error",
              error: getErrorMessage(e),
              elapsedMs: Date.now() - startedAt,
            });
            return;
          }
        }

        // Step 2: scan proceeds
        updateRow(i, { status: "scanning", distribAddress, inferReason });
        try {
          const result = await fetchAssetXlmProceeds(
            horizonUrl,
            assetCode,
            issuer,
            scanAccounts,
            signal,
            () => {},
          );
          if (signal.aborted) return;

          // Prior saves of this exact asset — used to skip a redundant save
          // when nothing actually changed, and to render the diff below.
          const key = assetKey({ assetCode, issuer, network: settings.network });
          const priorMatches = savedAnalyses
            .filter((a) => assetKey(a) === key)
            .sort((a, b) => b.timestamp - a.timestamp);
          const priorSave: PriorSaveInfo | null = priorMatches.length
            ? { matches: priorMatches }
            : null;
          const unchanged = priorSave
            ? isUnchangedSince(priorSave.matches[0], result)
            : false;

          let newSaveId: string | undefined;
          if (!unchanged) {
            // Auto-save to Saved Analyses on completion — skipped when identical
            // to the most recent prior save, so re-running a static asset doesn't
            // pile up duplicate entries.
            newSaveId = saveAnalysis({
              name: `${assetCode} — ${new Date().toLocaleDateString()}`,
              assetCode,
              issuer,
              distribAddresses: scanAccounts,
              network: settings.network,
              result,
            });
          }

          updateRow(i, {
            status: "done",
            result,
            priorSave,
            skippedUnchanged: unchanged,
            newSaveId,
            elapsedMs: Date.now() - startedAt,
          });
          upsertSearch({
            type: "asset",
            value: `${assetCode}:${issuer}`,
            network: settings.network,
            distribAddress,
            totalXlmProceeds: result.totalXlmProceeds,
            totalAssetSold: result.totalAssetSold,
          });
        } catch (e) {
          if (signal.aborted) return;
          updateRow(i, {
            status: "error",
            error: getErrorMessage(e),
            elapsedMs: Date.now() - startedAt,
          });
        }
      },
      signal,
    );

    setRunning(false);
    setRows((currentRows) => {
      bulkScanState.saveImmediate(currentRows, false);
      return currentRows;
    });
    notifyIfHidden(
      "Asset Sales scan complete",
      `Scan finished for ${pairs.length} asset${pairs.length === 1 ? "" : "s"}.`,
    );
  };

  // Fire a pending autorun once the deep-linked text has actually landed in state.
  useEffect(() => {
    if (pendingAutorunRef.current && assetsText) {
      pendingAutorunRef.current = false;
      handleRun();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetsText]);

  const handleCancel = () => {
    abortRef.current?.abort();
    setRunning(false);
  };

  const handleClear = () => {
    abortRef.current?.abort();
    setRunning(false);
    setRows([]);
    setInterrupted(false);
    setAllSaved(false);
    bulkScanState.clear();
  };

  const handleSaveAll = () => {
    const doneRows = rows.filter((r) => r.status === "done" && r.result);
    for (const row of doneRows) {
      saveAnalysis({
        name: `${row.assetCode} — ${new Date().toLocaleDateString()}`,
        assetCode: row.assetCode,
        issuer: row.issuer,
        distribAddresses: row.distribAddress ? [row.distribAddress] : [],
        network: settings.network,
        result: row.result!,
      });
    }
    setAllSaved(true);
  };

  const handleDeleteSavedAnalysis = (rowIndex: number, id: string) => {
    removeSavedAnalysis(id);
    setRows((prev) =>
      prev.map((r, idx) => {
        if (idx !== rowIndex || !r.priorSave) return r;
        return {
          ...r,
          newSaveId: r.newSaveId === id ? undefined : r.newSaveId,
          priorSave: { matches: r.priorSave.matches.filter((a) => a.id !== id) },
        };
      }),
    );
  };

  const toggleExpand = (i: number) =>
    setRows((prev) =>
      prev.map((r, idx) => (idx === i ? { ...r, expanded: !r.expanded } : r)),
    );

  const doneCount = rows.filter((r) => r.status === "done").length;
  const errorCount = rows.filter((r) => r.status === "error").length;
  const pendingCount = rows.filter(
    (r) =>
      r.status === "pending" ||
      r.status === "inferring" ||
      r.status === "scanning",
  ).length;

  // Watchdog: if running but all rows reached a terminal state, stop the spinner.
  // This handles cases where a fetch hangs and runConcurrent never resolves.
  useEffect(() => {
    if (running && rows.length > 0 && pendingCount === 0) {
      abortRef.current?.abort();
      setRunning(false);
    }
  }, [running, rows.length, pendingCount]);

  return (
    <div className="space-y-6">
      {/* Interrupted banner */}
      {interrupted && (
        <div className="flex items-start gap-3 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" />
          <div className="flex-1 text-sm">
            <p className="font-medium text-yellow-700 dark:text-yellow-400">
              Previous scan was interrupted
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              The page was refreshed while a scan was running. Completed results
              are shown below. Start a new scan or clear to reset.
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={() => setInterrupted(false)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {searchHistory.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            Recent searches
          </div>
          <div className="flex flex-wrap gap-2">
            {searchHistory.map((entry) => (
              <div
                key={entry.timestamp}
                className="flex items-center gap-1 rounded-md border border-border bg-muted/40 pl-2 pr-1 py-1 text-xs"
              >
                <Button
                  variant="ghost"
                  className="h-auto gap-1.5 p-0 text-xs font-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
                  onClick={() => {
                    setAssetsText(entry.assetsText);
                    updateSettings({ network: entry.network as Network });
                  }}
                  disabled={running}
                  title={entry.assetsText}
                >
                  <span className="font-mono font-semibold text-foreground">
                    {entry.assetCount} asset{entry.assetCount === 1 ? "" : "s"}
                  </span>
                  <span className="opacity-50">{entry.network}</span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-1 h-auto w-auto rounded p-0.5 text-muted-foreground hover:bg-transparent hover:text-destructive"
                  onClick={() => removeHistory(entry.timestamp)}
                  aria-label="Remove"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Input card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingDown className="h-5 w-5" />
            Asset → XLM Proceeds
          </CardTitle>
          <CardDescription>
            One <code className="text-xs">CODE:ISSUER</code> per line. Lobstr
            URLs also work. Distribution address is inferred automatically
            unless you enter seller accounts manually below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="assets-input">Assets</Label>
            <textarea
              id="assets-input"
              className="w-full min-h-36 rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono"
              placeholder={
                "TOKEN:GABC...\nUSDC:GA5Z...\nhttps://lobstr.co/trade/GSF:GAD2..."
              }
              value={assetsText}
              onChange={(e) => {
                setAssetsText(e.target.value);
                setParseError(null);
              }}
              disabled={running}
            />
            {parseError && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                {parseError}
              </p>
            )}
          </div>

          {singlePair && (
            <div className="space-y-2">
              <Label htmlFor="override-accounts">
                Seller Accounts (override, optional)
              </Label>
              <textarea
                id="override-accounts"
                className="w-full min-h-20 rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono"
                placeholder="Leave empty to auto-infer, or paste one G... address per line"
                value={overrideAccountsText}
                onChange={(e) => setOverrideAccountsText(e.target.value)}
                disabled={running}
              />
            </div>
          )}

          <div className="flex items-center gap-2">
            <Switch
              id="sequential-scan"
              checked={sequential}
              onCheckedChange={setSequential}
              disabled={running}
            />
            <Label htmlFor="sequential-scan" className="text-sm font-normal">
              Scan one at a time
            </Label>
            <span className="text-xs text-muted-foreground">
              {sequential
                ? "1 asset at a time"
                : `${CONCURRENCY} assets in parallel`}
            </span>
          </div>
        </CardContent>
        <CardFooter className="flex gap-2 flex-wrap">
          <Button onClick={handleRun} disabled={running}>
            {running ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Search className="mr-2 h-4 w-4" />
            )}
            Run Analysis
          </Button>
          <Button variant="outline" onClick={handleCancel} disabled={!running}>
            <X className="mr-2 h-4 w-4" />
            Cancel
          </Button>
          {rows.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClear}
              disabled={running}
              className="text-muted-foreground"
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Clear
            </Button>
          )}
          {rows.length > 0 && !running && (
            <span className="text-xs text-muted-foreground ml-auto self-center">
              {doneCount} done · {errorCount} failed
              {pendingCount > 0 && ` · ${pendingCount} pending`}
            </span>
          )}
        </CardFooter>
      </Card>

      {/* Running progress */}
      {running && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
          <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
          <div className="flex-1 text-sm">
            <p className="font-medium">
              {pendingCount === 0
                ? "Finalising…"
                : `Scanning ${Math.min(doneCount + errorCount + 1, rows.length)} of ${rows.length}…`}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {doneCount} done · {errorCount} failed · results are saved
              automatically if you navigate away
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleCancel}>
            <X className="mr-1.5 h-3.5 w-3.5" />
            Stop
          </Button>
        </div>
      )}

      {/* Results */}
      {rows.length > 0 && (
        <div className="space-y-3">
          {/* Save All button */}
          {doneCount > 0 && !running && (
            <div className="flex justify-end gap-2">
              {allSaved ? (
                <Button variant="outline" size="sm" disabled>
                  <BookmarkCheck className="mr-2 h-3.5 w-3.5 text-green-500" />
                  All Saved ({doneCount})
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={handleSaveAll}>
                  <Save className="mr-2 h-3.5 w-3.5" />
                  Save All Completed ({doneCount})
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => router.push("/saved-analyses")}>
                <BookmarkCheck className="mr-2 h-3.5 w-3.5" />
                View Saved Analyses →
              </Button>
            </div>
          )}

          {rows.map((row, i) => {
            const single = rows.length === 1;
            return (
            <Card key={`${row.assetCode}:${row.issuer}`}>
              {/* Summary row */}
              <div
                className={`flex items-center gap-3 p-4 cursor-pointer select-none ${single ? "flex-wrap" : ""}`}
                onClick={() => row.status === "done" && toggleExpand(i)}
              >
                {/* Expand toggle */}
                <div className="w-4 shrink-0 text-muted-foreground">
                  {row.status === "done" ? (
                    row.expanded ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )
                  ) : null}
                </div>

                {/* Asset + home domain */}
                <div className={`${single ? "" : "w-28"} shrink-0 flex flex-col gap-0.5`}>
                  <span className={`font-mono font-semibold ${single ? "text-base" : "text-sm"}`}>
                    {row.assetCode}
                  </span>
                  {row.homeDomain && (
                    <span className={`text-[10px] text-muted-foreground ${single ? "" : "truncate"}`}>
                      {row.homeDomain}
                    </span>
                  )}
                </div>

                {/* Issuer + Distrib */}
                <div className={`${single ? "w-full" : "flex-1 min-w-0"} flex flex-col gap-1 text-xs`}>
                  <ShortAddress
                    address={row.issuer}
                    label="ISS"
                    network={settings.network as "public" | "testnet"}
                  />
                  {row.distribAddress ? (
                    <ShortAddress
                      address={row.distribAddress}
                      label="DST"
                      network={settings.network as "public" | "testnet"}
                    />
                  ) : (
                    <span className="text-muted-foreground opacity-50">—</span>
                  )}
                </div>

                {/* XLM proceeds */}
                <div className="w-44 text-right shrink-0">
                  {row.result ? (
                    <div className="flex flex-col items-end">
                      <span className="font-mono text-sm font-semibold">
                        {formatXlm(row.result.totalXlmProceeds)}{" "}
                        <span className="text-xs font-normal text-muted-foreground">
                          XLM
                        </span>
                      </span>
                      {xlmUsdPrice !== null && (
                        <span className="text-xs text-muted-foreground tabular-nums">
                          ≈ $
                          {(
                            row.result.totalXlmProceeds * xlmUsdPrice
                          ).toLocaleString(undefined, {
                            maximumFractionDigits: 0,
                          })}
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                </div>

                {/* Asset sold */}
                <div className="w-36 text-right shrink-0">
                  {row.result ? (
                    <span className="font-mono text-sm">
                      {formatXlm(row.result.totalAssetSold)}{" "}
                      <span className="text-xs text-muted-foreground">
                        {row.assetCode}
                      </span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                </div>

                {/* Status + Save to Group */}
                <div className="shrink-0 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  {row.elapsedMs !== undefined && (
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap" title="Time this scan took">
                      {formatDuration(row.elapsedMs)}
                    </span>
                  )}
                  {row.priorSave && row.priorSave.matches.length > 0 && (
                    <span
                      className={`text-[10px] rounded-full border px-2 py-0.5 whitespace-nowrap ${
                        row.skippedUnchanged
                          ? "border-green-500/30 bg-green-500/10 text-green-500"
                          : "border-border text-muted-foreground"
                      }`}
                      title={
                        row.skippedUnchanged
                          ? "Unchanged since last save — not saved again"
                          : `Saved ${row.priorSave.matches.length}× before — see "Since Last Save" below for the full diff`
                      }
                    >
                      {row.skippedUnchanged
                        ? "unchanged, not saved"
                        : `saved ${row.priorSave.matches.length}× before`}
                    </span>
                  )}
                  <ProceedsStatusBadge status={row.status} />
                  {row.distribAddress && (
                    <SaveToGroupButton
                      assetCode={row.assetCode}
                      issuer={row.issuer}
                      network={settings.network}
                      distribAddress={row.distribAddress}
                      homeDomain={row.homeDomain}
                      topDestinations={row.result?.topDestinations}
                      size="sm"
                    />
                  )}
                </div>
              </div>

              {/* Error */}
              {row.status === "error" && row.error && (
                <div className="px-4 pb-4">
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    {row.error}
                  </p>
                </div>
              )}

              {/* Infer reason */}
              {row.inferReason && row.status !== "error" && !row.expanded && (
                <div className="px-4 pb-3 -mt-1">
                  <p className="text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">
                      Distrib:{" "}
                    </span>
                    {row.inferReason}
                  </p>
                </div>
              )}

              {/* Expanded detail */}
              {row.expanded && row.result && (
                <div className="border-t border-border px-4 pb-4">
                  <ProceedsStatsCards
                    result={row.result}
                    assetCode={row.assetCode}
                    xlmUsdPrice={xlmUsdPrice}
                  />

                  <div className="mt-3">
                    <WindowedSalesStats
                      ledger={row.result.proceedsLedger}
                      assetCode={row.assetCode}
                      xlmUsdPrice={xlmUsdPrice}
                    />
                  </div>

                  {row.inferReason && (
                    <p className="text-xs text-muted-foreground mt-3">
                      <span className="font-semibold text-foreground">
                        Distrib address:{" "}
                      </span>
                      {row.distribAddress} · {row.inferReason}
                    </p>
                  )}

                  <h4 className="text-sm font-semibold mt-4 mb-1">
                    Top Destinations
                  </h4>
                  <ProceedsDestinationsTable
                    destinations={row.result.topDestinations}
                    totalXlmProceeds={row.result.totalXlmProceeds}
                    network={settings.network}
                    assetCode={row.result.assetCode}
                    issuer={row.result.issuer}
                    showProgressBar
                    showGroupAction
                    undistributedXlm={row.result.estimatedOnHandXlm}
                    xlmUsdPrice={xlmUsdPrice}
                  />

                  {row.priorSave && row.priorSave.matches.length > 0 && (
                    <SinceLastSave
                      priorSave={row.priorSave}
                      currentResult={row.result}
                      network={settings.network}
                      xlmUsdPrice={xlmUsdPrice}
                      skippedUnchanged={!!row.skippedUnchanged}
                      newSaveId={row.newSaveId}
                      onDelete={(id) => handleDeleteSavedAnalysis(i, id)}
                    />
                  )}
                </div>
              )}
            </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
