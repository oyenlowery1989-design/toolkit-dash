"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { Horizon } from "stellar-sdk";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Activity,
  Zap,
  Fingerprint,
  Database,
  RefreshCw,
  AlertCircle,
  Coins,
  UserSearch,
  Megaphone,
  Wallet,
  Send,
} from "lucide-react";
import { useSettings, NETWORK_LABELS } from "@/lib/settings";
import { timeAgo, getErrorMessage } from "@/lib/stellar-helpers";
import { useAssetHistory } from "@/components/asset-lookup/useAssetHistory";
import { useBulkRunHistory } from "@/hooks/use-bulk-run-history";
import { useWalletsV2 as useWallets } from "@/hooks/use-wallets-v2";
import { useHorizonServer } from "@/hooks/use-horizon-server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FeeStats {
  lastBaseFee: number;
  p50Fee: number;
  p99Fee: number;
}

interface DashboardData {
  feeStats: FeeStats;
}

type FetchStatus = "idle" | "loading" | "live" | "error";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchDashboardData(
  horizonUrl: string,
  signal: AbortSignal,
): Promise<DashboardData> {
  const server = new Horizon.Server(horizonUrl);

  const feeResponse = await server.feeStats();

  if (signal.aborted) throw new DOMException("Aborted", "AbortError");

  const feeStats: FeeStats = {
    lastBaseFee: parseInt(feeResponse.last_ledger_base_fee),
    p50Fee: parseInt(feeResponse.fee_charged.p50),
    p99Fee: parseInt(feeResponse.fee_charged.p99),
  };

  return { feeStats };
}

// ---------------------------------------------------------------------------
// Skeleton for loading state
// ---------------------------------------------------------------------------

function Skeleton({ className }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded bg-muted ${className ?? ""}`} />
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 10_000;

export default function DashboardPage() {
  const { settings } = useSettings();
  const { history: assetHistory } = useAssetHistory();
  const { runs: bulkRuns } = useBulkRunHistory();
  const { wallets } = useWallets();
  const { url: horizonUrl } = useHorizonServer();

  // Start in loading state so skeletons render immediately on first paint.
  const [status, setStatus] = useState<FetchStatus>("loading");
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [, setTick] = useState(0); // drives timeAgo re-renders

  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // No synchronous setState here — status is initialised as "loading" and
    // transitions only on async resolution (after the await below).
    try {
      const result = await fetchDashboardData(horizonUrl, controller.signal);
      if (controller.signal.aborted) return;
      setData(result);
      setStatus("live");
      setError(null);
      setLastUpdated(new Date());
    } catch (err: unknown) {
      if (controller.signal.aborted) return;
      if (err instanceof DOMException && err.name === "AbortError") return;
      setStatus("error");
      setError(getErrorMessage(err));
    }
  }, [horizonUrl]);

  // Initial fetch + re-fetch when network changes.
  useEffect(() => {
    // fetchData only calls setState after await — this disable is not a silent suppression.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();
    return () => {
      abortRef.current?.abort();
    };
  }, [fetchData]);

  // Poll every 10 seconds.
  useEffect(() => {
    const interval = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Tick every second so timeAgo values stay fresh.
  useEffect(() => {
    const interval = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const networkLabel = NETWORK_LABELS[settings.network];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-2">
            Live overview of the Stellar Network.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
          {status === "loading" && (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          )}
          {status === "live" && lastUpdated && (
            <>
              <span className="h-2 w-2 rounded-full bg-green-500 inline-block" />
              Updated {timeAgo(lastUpdated.toISOString())}
            </>
          )}
          {status === "error" && (
            <>
              <AlertCircle className="h-3.5 w-3.5 text-destructive" />
              <span className="text-destructive">Horizon unreachable</span>
            </>
          )}
        </div>
      </div>

      {/* Error banner */}
      {status === "error" && error && (
        <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        {/* Network Status */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Network Status
            </CardTitle>
            <Activity
              className={`h-4 w-4 ${
                status === "live"
                  ? "text-green-500"
                  : status === "error"
                    ? "text-destructive"
                    : "text-muted-foreground"
              }`}
            />
          </CardHeader>
          <CardContent>
            {status === "loading" ? (
              <>
                <Skeleton className="h-7 w-20 mb-1" />
                <Skeleton className="h-3 w-32" />
              </>
            ) : (
              <>
                <div className="text-2xl font-bold">
                  {status === "live"
                    ? "Live"
                    : status === "error"
                      ? "Error"
                      : "—"}
                </div>
                <p className="text-xs text-muted-foreground">{networkLabel}</p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Tracked Assets */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Tracked Assets
            </CardTitle>
            <Database className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <>
              <div className="text-2xl font-bold font-mono">
                {assetHistory.length.toLocaleString()}
              </div>
              <p className="text-xs text-muted-foreground">
                Recently searched assets
              </p>
            </>
          </CardContent>
        </Card>

        {/* Base Fee */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Base Fee</CardTitle>
            <Zap className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            {status === "loading" || !data ? (
              <>
                <Skeleton className="h-7 w-32 mb-1" />
                <Skeleton className="h-3 w-28" />
              </>
            ) : (
              <>
                <div className="text-2xl font-bold font-mono">
                  {data.feeStats.lastBaseFee.toLocaleString()}
                  <span className="text-sm font-normal text-muted-foreground ml-1">
                    stroops
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  p50 {data.feeStats.p50Fee} · p99 {data.feeStats.p99Fee}
                </p>
                {data && data.feeStats.p99Fee > 0 && (
                  <div className="mt-2">
                    <div className="flex gap-1 h-2">
                      <div
                        className="rounded-full bg-primary"
                        style={{
                          width: `${(data.feeStats.p50Fee / data.feeStats.p99Fee) * 100}%`,
                        }}
                      />
                      <div className="rounded-full bg-primary/20 flex-1" />
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      p50 / p99 ratio
                    </p>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Last Asset Search */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Last Asset Search
            </CardTitle>
            <Fingerprint className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            {assetHistory.length === 0 ? (
              <>
                <div className="text-2xl font-bold">—</div>
                <p className="text-xs text-muted-foreground">
                  No asset searches yet
                </p>
              </>
            ) : (
              <>
                <div className="text-sm font-semibold font-mono truncate">
                  {assetHistory[0].assetCode}
                </div>
                <p className="text-xs text-muted-foreground">
                  {timeAgo(new Date(assetHistory[0].timestamp).toISOString())}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Tracked Wallets */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Tracked Wallets
            </CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">
              {wallets.length}
            </div>
            <p className="text-xs text-muted-foreground">
              <Link href="/wallet-manager" className="hover:underline text-primary">
                {wallets.length === 0 ? "Add wallets to track" : "Manage in Wallet Manager"}
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tracked assets + Quick links */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        {/* Tracked assets */}
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>Tracked Assets</CardTitle>
            <CardDescription>
              Recent assets you searched. Use Asset Sales to analyze XLM
              proceeds and distribution for any of these assets.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {status === "loading" ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : assetHistory.length === 0 ? (
              <div className="flex h-[200px] flex-col items-center justify-center text-muted-foreground text-sm gap-3">
                <span>No tracked assets yet.</span>
                <Link
                  href="/asset-lookup"
                  className="text-primary hover:underline"
                >
                  Go to Asset Lookup to start tracking
                </Link>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground">
                      <th className="pb-2 text-left font-medium">Asset</th>
                      <th className="pb-2 text-left font-medium">Issuer</th>
                      <th className="pb-2 text-left font-medium">Network</th>
                      <th className="pb-2 text-right font-medium">
                        Last Search
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {assetHistory.slice(0, 8).map((entry) => (
                      <tr
                        key={`${entry.assetCode}-${entry.issuer}-${entry.network}`}
                        className="border-b border-border/50 text-muted-foreground"
                      >
                        <td className="py-2 font-mono text-xs text-foreground">
                          {entry.assetCode}
                        </td>
                        <td
                          className="py-2 font-mono text-xs max-w-[220px] truncate"
                          title={entry.issuer}
                        >
                          {entry.issuer}
                        </td>
                        <td className="py-2 text-xs">
                          {NETWORK_LABELS[
                            entry.network as keyof typeof NETWORK_LABELS
                          ] ?? entry.network}
                        </td>
                        <td className="py-2 text-right text-xs">
                          {timeAgo(new Date(entry.timestamp).toISOString())}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Links */}
        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>Quick Links</CardTitle>
            <CardDescription>Jump to frequently used modules.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Link href="/address-generator">
              <div className="p-3 bg-accent rounded-md flex items-center gap-3 hover:bg-accent/80 transition-colors">
                <Fingerprint className="h-5 w-5 text-primary shrink-0" />
                <div>
                  <div className="text-sm font-medium">Generate Address</div>
                  <div className="text-xs text-muted-foreground">
                    Find a keypair matching a pattern
                  </div>
                </div>
              </div>
            </Link>
            <Link href="/asset-lookup">
              <div className="p-3 bg-accent rounded-md flex items-center gap-3 hover:bg-accent/80 transition-colors">
                <Database className="h-5 w-5 text-primary shrink-0" />
                <div>
                  <div className="text-sm font-medium">Asset Lookup</div>
                  <div className="text-xs text-muted-foreground">
                    Query accounts holding any asset
                  </div>
                </div>
              </div>
            </Link>
            <Link href="/asset-sales">
              <div className="p-3 bg-accent rounded-md flex items-center gap-3 hover:bg-accent/80 transition-colors">
                <Coins className="h-5 w-5 text-primary shrink-0" />
                <div>
                  <div className="text-sm font-medium">Asset Sales</div>
                  <div className="text-xs text-muted-foreground">
                    Analyze XLM proceeds and distribution
                  </div>
                </div>
              </div>
            </Link>
            <Link href="/address-investigator">
              <div className="p-3 bg-accent rounded-md flex items-center gap-3 hover:bg-accent/80 transition-colors">
                <UserSearch className="h-5 w-5 text-primary shrink-0" />
                <div>
                  <div className="text-sm font-medium">Address Investigator</div>
                  <div className="text-xs text-muted-foreground">
                    Investigate account-level XLM flows
                  </div>
                </div>
              </div>
            </Link>
            <Link href="/bulk-payments">
              <div className="p-3 bg-accent rounded-md flex items-center gap-3 hover:bg-accent/80 transition-colors">
                <Megaphone className="h-5 w-5 text-primary shrink-0" />
                <div>
                  <div className="text-sm font-medium">Bulk Payments</div>
                  <div className="text-xs text-muted-foreground">
                    Send memos to many addresses at once
                  </div>
                </div>
              </div>
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      {bulkRuns.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Bulk Payments</CardTitle>
            <CardDescription>
              Last {bulkRuns.length} send run{bulkRuns.length !== 1 ? "s" : ""} across all networks.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="pb-2 text-left font-medium">Memo</th>
                    <th className="pb-2 text-left font-medium">Network</th>
                    <th className="pb-2 text-right font-medium">Recipients</th>
                    <th className="pb-2 text-right font-medium">Sent</th>
                    <th className="pb-2 text-right font-medium">Failed</th>
                    <th className="pb-2 text-right font-medium">When</th>
                  </tr>
                </thead>
                <tbody>
                  {bulkRuns.slice(0, 5).map((run) => (
                    <tr key={run.id} className="border-b border-border/50 text-muted-foreground">
                      <td className="py-2 font-mono text-xs text-foreground max-w-[200px] truncate">
                        {run.memo || <span className="italic opacity-50">no memo</span>}
                      </td>
                      <td className="py-2 text-xs">
                        {NETWORK_LABELS[run.network as keyof typeof NETWORK_LABELS] ?? run.network}
                      </td>
                      <td className="py-2 text-right tabular-nums">{run.recipientCount.toLocaleString()}</td>
                      <td className="py-2 text-right tabular-nums text-green-600 dark:text-green-400">
                        {run.successCount.toLocaleString()}
                      </td>
                      <td className="py-2 text-right tabular-nums text-destructive">
                        {run.failedCount > 0 ? run.failedCount.toLocaleString() : "—"}
                      </td>
                      <td className="py-2 text-right text-xs">
                        {timeAgo(new Date(run.ranAt).toISOString())}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
