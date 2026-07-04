"use client";

import { useEffect, useRef, useState } from "react";
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
import {
  AlertTriangle,
  BookmarkCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Layers,
  Loader2,
  RefreshCw,
  Save,
  Search,
  TrendingDown,
  X,
  XCircle,
} from "lucide-react";
import { useSettings, resolveHorizonUrl } from "@/lib/settings";
import { getErrorMessage } from "@/lib/stellar-helpers";
import { ShortAddress } from "@/components/asset-lookup";
import { inferDistribLite } from "@/lib/asset-lookup/fetchers";
import { fetchAssetXlmProceeds } from "@/lib/proceeds-investigator/fetchers";
import { formatXlm } from "@/lib/format";
import { useSavedSearches } from "@/hooks/use-saved-searches";
import { useSavedAnalyses } from "@/hooks/use-saved-analyses";
import {
  notifyIfHidden,
  requestNotificationPermission,
} from "@/lib/notifications";
import type { AssetProceedsResult } from "@/lib/proceeds-investigator/types";
import { useAssetGroups } from "@/hooks/use-asset-groups";

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
// localStorage persistence
// ---------------------------------------------------------------------------

const ROWS_STORAGE_KEY = "stellar-toolkit-bulk-asset-rows";

function loadPersistedRows(): AssetRow[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(ROWS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AssetRow[]) : [];
  } catch {
    return [];
  }
}

function persistRows(rows: AssetRow[]) {
  try {
    localStorage.setItem(ROWS_STORAGE_KEY, JSON.stringify(rows));
  } catch {}
}

function clearPersistedRows() {
  try {
    localStorage.removeItem(ROWS_STORAGE_KEY);
  } catch {}
}

function getInitialRowsState(): { rows: AssetRow[]; interrupted: boolean } {
  const persisted = loadPersistedRows();
  if (persisted.length === 0) {
    return { rows: [], interrupted: false };
  }

  const interrupted = persisted.some(
    (r) =>
      r.status === "pending" ||
      r.status === "inferring" ||
      r.status === "scanning",
  );

  const rows = persisted.map((r) =>
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

  return { rows, interrupted };
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

async function fetchXlmUsd(signal: AbortSignal): Promise<number | null> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd",
      { signal },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return (data as { stellar?: { usd?: number } })?.stellar?.usd ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseAssetPairs(
  text: string,
): { assetCode: string; issuer: string }[] {
  const seen = new Set<string>();
  const results: { assetCode: string; issuer: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/([A-Za-z0-9]{1,12}):([A-Z2-7]{56})/);
    if (!match) continue;
    const assetCode = match[1]; // preserve original case — Stellar asset codes are case-sensitive on-chain
    const issuer = match[2];
    if (!StrKey.isValidEd25519PublicKey(issuer)) continue;
    const key = `${assetCode}:${issuer}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ assetCode, issuer });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: AssetRowStatus }) {
  if (status === "pending")
    return <span className="text-xs text-muted-foreground">Pending</span>;
  if (status === "inferring")
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Inferring distrib…
      </span>
    );
  if (status === "scanning")
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Scanning trades…
      </span>
    );
  if (status === "done")
    return (
      <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
        <CheckCircle2 className="h-3 w-3" /> Done
      </span>
    );
  return (
    <span className="flex items-center gap-1 text-xs text-destructive">
      <XCircle className="h-3 w-3" /> Error
    </span>
  );
}

function DestinationsTable({
  result,
  network,
}: {
  result: AssetProceedsResult;
  network: string;
}) {
  const { groups } = useAssetGroups();
  const assetGroup = groups.find(
    (g) =>
      g.assetCode?.toUpperCase() === result.assetCode.toUpperCase() &&
      g.issuer === result.issuer &&
      g.network === network,
  );
  const total = result.totalXlmProceeds;
  return (
    <div className="overflow-x-auto mt-4">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="pb-2 text-left font-medium">Destination</th>
            <th className="pb-2 text-right font-medium">XLM Received</th>
            <th className="pb-2 text-right font-medium">% of Proceeds</th>
            <th className="pb-2 text-right font-medium">Tx Count</th>
            <th className="pb-2 text-right font-medium">Group</th>
          </tr>
        </thead>
        <tbody>
          {result.topDestinations.map((d) => {
            const pct = total > 0 ? (d.totalXlm / total) * 100 : 0;
            return (
              <tr key={d.address} className="border-b border-border/50">
                <td className="py-2">
                  <ShortAddress
                    address={d.address}
                    network={network as "public" | "testnet"}
                  />
                </td>
                <td className="py-2 text-right tabular-nums font-mono">
                  {formatXlm(d.totalXlm)}
                </td>
                <td className="py-2 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                    <span className="tabular-nums w-12 text-right">
                      {pct.toFixed(1)}%
                    </span>
                  </div>
                </td>
                <td className="py-2 text-right tabular-nums">{d.count}</td>
                <td className="py-2 text-right">
                  {assetGroup?.members.find((m) => m.address === d.address) ? (
                    <a
                      href={`/groups?open=${assetGroup.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded border border-green-400/40 bg-green-400/10 px-2 py-0.5 text-[10px] font-medium text-green-400 hover:bg-green-400/20 transition-colors"
                    >
                      ✓ in group
                    </a>
                  ) : (
                    <button
                      title="Add to group as Bank"
                      onClick={() => {
                        const p = new URLSearchParams({
                          autoCreate: "1",
                          name: `${result.assetCode} Investigation`,
                          assetCode: result.assetCode,
                          issuer: result.issuer,
                          distrib: result.accounts[0] ?? "",
                          network,
                          addAddress: d.address,
                          addRole: "bank",
                        });
                        window.open(`/groups?${p.toString()}`, "_blank");
                      }}
                      className="inline-flex items-center gap-1 rounded border border-purple-400/40 bg-purple-400/10 px-2 py-0.5 text-[10px] font-medium text-purple-400 hover:bg-purple-400/20 transition-colors"
                    >
                      + Bank
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
          {result.topDestinations.length === 0 && (
            <tr>
              <td
                colSpan={5}
                className="py-4 text-center text-muted-foreground"
              >
                No outgoing XLM transfers found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

export function BulkAssetSalesPanel() {
  const [initialState] = useState(getInitialRowsState);

  const { settings } = useSettings();
  const { groups } = useAssetGroups();
  const { upsert: upsertSearch } = useSavedSearches();
  const { saveAnalysis } = useSavedAnalyses();
  const [assetsText, setAssetsText] = useState("");
  const [rows, setRows] = useState<AssetRow[]>(initialState.rows);
  const [running, setRunning] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [interrupted, setInterrupted] = useState(initialState.interrupted);
  const [allSaved, setAllSaved] = useState(false);
  const [xlmUsdPrice, setXlmUsdPrice] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    requestNotificationPermission();
  }, []);

  const updateRow = (index: number, patch: Partial<AssetRow>) => {
    setRows((prev) => {
      const next = prev.map((r, i) => (i === index ? { ...r, ...patch } : r));
      persistRows(next);
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
      expanded: false,
    }));
    setRows(initial);
    persistRows(initial);
    setRunning(true);

    const horizonUrl = resolveHorizonUrl(settings);

    // Fetch XLM/USD price in parallel with first batch
    fetchXlmUsd(signal).then((price) => {
      if (price !== null) setXlmUsdPrice(price);
    });

    await runConcurrent(
      pairs,
      CONCURRENCY,
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
          try {
            const acctRes = await fetch(
              `${horizonUrl}/accounts/${encodeURIComponent(issuer)}`,
              { signal },
            );
            if (!signal.aborted && acctRes.ok) {
              const acctData = await acctRes.json();
              const hd = (acctData as { home_domain?: string }).home_domain;
              if (hd) updateRow(i, { homeDomain: hd });
            }
          } catch {
            // non-fatal
          }
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
    clearPersistedRows();
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
            <div className="flex justify-end">
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
                  <StatusBadge status={row.status} />
                  {row.distribAddress && (() => {
                    const existingGroup = groups.find(
                      (g) =>
                        g.assetCode?.toUpperCase() === row.assetCode.toUpperCase() &&
                        g.issuer === row.issuer &&
                        g.network === settings.network,
                    );
                    return existingGroup ? (
                      <a
                        href={`/groups?open=${existingGroup.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded border border-green-400/40 bg-green-400/10 px-2 py-0.5 text-[10px] font-medium text-green-400 hover:bg-green-400/20 transition-colors whitespace-nowrap"
                      >
                        <Layers className="h-3 w-3" />
                        Open Group
                      </a>
                    ) : (
                      <a
                        href={(() => {
                          const p = new URLSearchParams({
                            autoCreate: "1",
                            name: `${row.assetCode} Investigation`,
                            assetCode: row.assetCode,
                            issuer: row.issuer,
                            distrib: row.distribAddress!,
                            network: settings.network,
                          });
                          if (row.homeDomain) p.set("issuerHomeDomain", row.homeDomain);
                          return `/groups?${p.toString()}`;
                        })()}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Save issuer + distrib to an Asset Group"
                        className="inline-flex items-center gap-1 rounded border border-purple-400/40 bg-purple-400/10 px-2 py-0.5 text-[10px] font-medium text-purple-400 hover:bg-purple-400/20 transition-colors whitespace-nowrap"
                      >
                        <Layers className="h-3 w-3" />
                        Save to Group
                      </a>
                    );
                  })()}
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
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                    <div>
                      <p className="text-xs text-muted-foreground">
                        XLM Proceeds
                      </p>
                      <p className="font-mono font-semibold">
                        {formatXlm(row.result.totalXlmProceeds)} XLM
                      </p>
                      {xlmUsdPrice !== null && (
                        <p className="text-xs text-muted-foreground">
                          ≈ $
                          {(
                            row.result.totalXlmProceeds * xlmUsdPrice
                          ).toLocaleString(undefined, {
                            maximumFractionDigits: 0,
                          })}
                        </p>
                      )}
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Asset Sold
                      </p>
                      <p className="font-mono font-semibold">
                        {formatXlm(row.result.totalAssetSold)} {row.assetCode}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Outgoing XLM
                      </p>
                      <p className="font-mono font-semibold">
                        {formatXlm(row.result.totalOutgoingXlm)} XLM
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Est. On Hand
                      </p>
                      <p className="font-mono font-semibold">
                        {formatXlm(row.result.estimatedOnHandXlm)} XLM
                      </p>
                    </div>
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
                  <DestinationsTable
                    result={row.result}
                    network={settings.network}
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
