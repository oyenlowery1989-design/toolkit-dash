"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
  Save,
  Search,
  TrendingDown,
  X,
} from "lucide-react";
import { useSettings, resolveHorizonUrl } from "@/lib/settings";
import { getErrorMessage } from "@/lib/stellar-helpers";
import { ShortAddress } from "@/components/shared/ShortAddress";
import { inferDistribLite } from "@/lib/asset-lookup/fetchers";
import { fetchAssetXlmProceeds } from "@/lib/proceeds-investigator/fetchers";
import { formatXlm } from "@/lib/format";
import { useSavedSearches } from "@/hooks/use-saved-searches";
import { useSavedAnalyses } from "@/hooks/use-saved-analyses";
import { useBulkScanState } from "@/hooks/use-bulk-scan-state";
import { parseAssetPairs } from "@/lib/asset-pair";
import { useXlmUsdPrice } from "@/hooks/use-xlm-usd-price";
import { fetchHomeDomain } from "@/components/shared/ChainDisplay";
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
} from "@/components/shared/proceeds";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AssetRowStatus = "pending" | "inferring" | "scanning" | "done" | "error";

interface AssetRow {
  assetCode: string;
  issuer: string;
  status: AssetRowStatus;
  error?: string;
  distribAddress?: string;
  homeDomain?: string;
  inferReason?: string;
  result?: AssetProceedsResult;
  expanded: boolean;
}

// ---------------------------------------------------------------------------
// Concurrency helpers
// ---------------------------------------------------------------------------

const CONCURRENCY = 3;

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
// Sub-components
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

export function BulkAssetSalesPanel() {
  const router = useRouter();
  const { settings } = useSettings();
  const { upsert: upsertSearch } = useSavedSearches();
  const { saveAnalysis } = useSavedAnalyses();
  const [assetsText, setAssetsText] = useState("");
  const [rows, setRows] = useState<AssetRow[]>([]);
  const [running, setRunning] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [interrupted, setInterrupted] = useState(false);
  const [allSaved, setAllSaved] = useState(false);
  const [sequential, setSequential] = useState(false);
  const { price: xlmUsdPrice, ensure: ensureXlmUsdPrice } = useXlmUsdPrice();
  const abortRef = useRef<AbortController | null>(null);
  const bulkScanState = useBulkScanState<AssetRow>();

  useEffect(() => {
    requestNotificationPermission();
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
      const rows = persisted.rows.map((r) =>
        r.status === "pending" ||
        r.status === "inferring" ||
        r.status === "scanning"
          ? {
              ...r,
              status: "error" as AssetRowStatus,
              error: "Scan was interrupted (page refresh).",
            }
          : r,
      );
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
    setParseError(null);
    setInterrupted(false);
    setAllSaved(false);
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
        // Step 1: infer distribution address
        updateRow(i, { status: "inferring" });
        let distribAddress: string | undefined;
        let inferReason: string | undefined;

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
                "Distribution may use DEX sell orders only. Use Asset Sales to enter the address manually.",
            });
            return;
          }
          distribAddress = candidates[0].address;
          inferReason = candidates[0].reason;

          // Fetch issuer home_domain in background (best-effort)
          const hd = await fetchHomeDomain(horizonUrl, issuer, signal);
          if (!signal.aborted && hd) updateRow(i, { homeDomain: hd });
        } catch (e) {
          if (signal.aborted) return;
          updateRow(i, { status: "error", error: getErrorMessage(e) });
          return;
        }

        // Step 2: scan proceeds
        updateRow(i, { status: "scanning", distribAddress, inferReason });
        try {
          const result = await fetchAssetXlmProceeds(
            horizonUrl,
            assetCode,
            issuer,
            [distribAddress],
            signal,
            () => {},
          );
          if (signal.aborted) return;
          updateRow(i, { status: "done", result });
          // Auto-save to Saved Analyses on completion
          saveAnalysis({
            name: `${assetCode} — ${new Date().toLocaleDateString()}`,
            assetCode,
            issuer,
            distribAddresses: [distribAddress],
            network: settings.network,
            result,
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
          updateRow(i, { status: "error", error: getErrorMessage(e) });
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
      "Bulk Asset Sales complete",
      `Scan finished for ${pairs.length} assets.`,
    );
  };

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

      {/* Input card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingDown className="h-5 w-5" />
            Asset List
          </CardTitle>
          <CardDescription>
            One <code className="text-xs">CODE:ISSUER</code> per line. Lobstr
            URLs also work. Distribution address is inferred automatically.
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

          {rows.map((row, i) => (
            <Card key={`${row.assetCode}:${row.issuer}`}>
              {/* Summary row */}
              <div
                className="flex items-center gap-3 p-4 cursor-pointer select-none"
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
                <div className="w-28 shrink-0 flex flex-col gap-0.5">
                  <span className="font-mono font-semibold text-sm">
                    {row.assetCode}
                  </span>
                  {row.homeDomain && (
                    <span className="text-[10px] text-muted-foreground truncate">
                      {row.homeDomain}
                    </span>
                  )}
                </div>

                {/* Issuer + Distrib */}
                <div className="flex-1 min-w-0 flex flex-col gap-0.5 text-xs">
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
                  <ProceedsStatusBadge status={row.status} />
                  {row.distribAddress && (
                    <SaveToGroupButton
                      assetCode={row.assetCode}
                      issuer={row.issuer}
                      network={settings.network}
                      distribAddress={row.distribAddress}
                      homeDomain={row.homeDomain}
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
                  />
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
