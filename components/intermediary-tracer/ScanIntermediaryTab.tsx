"use client";

import { useRef, useState } from "react";
import { StrKey } from "stellar-sdk";
import {
  AlertTriangle,
  Clock,
  Download,
  ExternalLink,
  Loader2,
  ScanSearch,
  Users,
  X,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ShortAddress } from "@/components/asset-lookup";
import { useSettings, resolveHorizonUrl } from "@/lib/settings";
import { getErrorMessage } from "@/lib/stellar-helpers";
import { scanIntermediaryCreations } from "@/lib/intermediary-tracer/fetchers";
import { detectClusters } from "@/lib/intermediary-tracer/matcher";
import { useKnownIntermediaries } from "@/hooks/use-known-intermediaries";
import { useSavedSearches } from "@/hooks/use-saved-searches";
import { useIntermediaryHistory, intermediaryHistoryGetSnapshot } from "@/hooks/use-intermediary-history";
import { LogPanel } from "./LogPanel";
import type { CreatedAccountEntry } from "@/lib/intermediary-tracer/fetchers";

const WINDOW_OPTIONS = [
  { label: "2 minutes", value: "120" },
  { label: "5 minutes", value: "300" },
  { label: "10 minutes", value: "600" },
];

const TOLERANCE_OPTIONS = [
  { label: "1%", value: "1" },
  { label: "2%", value: "2" },
  { label: "5%", value: "5" },
];

const FROM_DATE_OPTIONS = [
  { label: "Last 1 hour", value: "0.042" },
  { label: "Last 3 hours", value: "0.125" },
  { label: "Last 6 hours", value: "0.25" },
  { label: "Last 24 hours", value: "1" },
  { label: "Last 7 days", value: "7" },
  { label: "Last 30 days", value: "30" },
  { label: "Last 90 days", value: "90" },
  { label: "All time", value: "all" },
];

function exportCsv(results: CreatedAccountEntry[], intermediary: string) {
  const rows = [
    "created_account,created_at,starting_balance_xlm,home_domain,probable_funder,confidence_pct",
    ...results.map((r) => [
      r.account,
      r.createdAt,
      r.startingBalance.toFixed(7),
      r.homeDomain ?? "",
      r.topFunder?.address ?? "",
      r.topFunder?.confidence ?? "",
    ].join(",")),
  ];
  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `created-by-${intermediary.slice(0, 6)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ScanIntermediaryTab() {
  const { settings } = useSettings();
  const { entries: knownEntries } = useKnownIntermediaries();
  const { upsert: upsertHistory } = useSavedSearches();
  const { history: recentSearches, upsert: upsertRecent, remove: removeRecent } = useIntermediaryHistory();
  const abortRef = useRef<AbortController | null>(null);

  const [address, setAddress] = useState(
    () => intermediaryHistoryGetSnapshot()[0]?.address ?? "",
  );
  const [fromDays, setFromDays] = useState("0.042");
  const [windowSec, setWindowSec] = useState("300");
  const [tolerancePct, setTolerancePct] = useState("2");

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<CreatedAccountEntry[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [hasStarted, setHasStarted] = useState(false);

  const addrValid = StrKey.isValidEd25519PublicKey(address.trim());

  const addLog = (msg: string) => setLogs((prev) => [...prev, msg]);

  const handleRun = async () => {
    const addr = address.trim();
    if (!addrValid) return;

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setRunning(true);
    setError(null);
    setResults([]);
    setLogs([]);
    setHasStarted(true);

    try {
      const horizonUrl = resolveHorizonUrl(settings);
      const fromDate =
        fromDays === "all"
          ? null
          : new Date(Date.now() - parseFloat(fromDays) * 86_400_000);

      const knownName = knownEntries.find((e) => e.address === addr)?.name;
      upsertRecent({ address: addr, network: settings.network as "public" | "testnet", name: knownName });
      upsertHistory({ type: "intermediary-scan", value: addr, network: settings.network, intermediaryName: knownName });

      await scanIntermediaryCreations(
        horizonUrl,
        addr,
        fromDate,
        parseInt(windowSec),
        parseInt(tolerancePct),
        abortRef.current.signal,
        addLog,
        (entry) => setResults((prev) => {
          const idx = prev.findIndex((r) => r.account === entry.account);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = entry;
            return next;
          }
          return [...prev, entry];
        }),
      );
    } catch (e) {
      if (!abortRef.current?.signal.aborted) {
        const msg = getErrorMessage(e);
        setError(msg);
        addLog(`ERROR: ${msg}`);
      }
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Recent searches */}
      {recentSearches.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            Recent searches
          </div>
          <div className="flex flex-wrap gap-2">
            {recentSearches.map((entry) => (
              <div key={entry.timestamp} className="flex items-center gap-1 rounded-md border border-border bg-muted/40 pl-2 pr-1 py-1 text-xs">
                <button
                  className="flex items-center gap-1.5 hover:text-foreground text-muted-foreground transition-colors"
                  onClick={() => setAddress(entry.address)}
                >
                  {entry.name && (
                    <span className="font-medium text-foreground">{entry.name}</span>
                  )}
                  <span className="font-mono font-semibold text-foreground">
                    {entry.address.slice(0, 4)}…{entry.address.slice(-4)}
                  </span>
                  <span className="opacity-50">{entry.network}</span>
                </button>
                <button
                  className="ml-1 text-muted-foreground hover:text-destructive transition-colors p-0.5 rounded"
                  onClick={() => removeRecent(entry.timestamp)}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Config card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ScanSearch className="h-5 w-5" />
            Scan Intermediary Accounts
          </CardTitle>
          <CardDescription>
            Enter an intermediary address to scan all accounts it created and
            find probable funders for each. Results appear as they are found.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="scan-addr">Intermediary Address</Label>
            <div className="flex gap-2">
              <Input
                id="scan-addr"
                value={address}
                onChange={(e) => { setAddress(e.target.value); setError(null); }}
                placeholder="GXXXXXX…"
                className="font-mono text-xs flex-1"
                onKeyDown={(e) => { if (e.key === "Enter" && addrValid && !running) handleRun(); }}
              />
              {knownEntries.length > 0 && (
                <Select value="" onValueChange={(val) => { if (val) setAddress(val); }}>
                  <SelectTrigger className="w-32 shrink-0">
                    <SelectValue placeholder="Known…" />
                  </SelectTrigger>
                  <SelectContent align="end">
                    {knownEntries.map((e) => (
                      <SelectItem key={e.address} value={e.address}>{e.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Scan Period</Label>
              <Select value={fromDays} onValueChange={setFromDays}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FROM_DATE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Funder Time Window</Label>
              <Select value={windowSec} onValueChange={setWindowSec}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WINDOW_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Amount Tolerance</Label>
              <Select value={tolerancePct} onValueChange={setTolerancePct}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TOLERANCE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
        <CardFooter className="gap-3 flex-wrap">
          <Button onClick={handleRun} disabled={running || !addrValid}>
            {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ScanSearch className="mr-2 h-4 w-4" />}
            Start Scan
          </Button>
          {running && (
            <Button variant="outline" onClick={() => abortRef.current?.abort()}>Stop</Button>
          )}
          {results.length > 0 && !running && (
            <Button variant="outline" onClick={() => exportCsv(results, address.trim())}>
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          )}
        </CardFooter>
      </Card>

      {error && (
        <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {hasStarted && <LogPanel logs={logs} running={running} />}

      {results.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{results.length}</span>{" "}
            account{results.length !== 1 ? "s" : ""} created by this intermediary
            {running && <span className="ml-2 text-xs text-primary animate-pulse">live</span>}
          </p>
          <div className="rounded-md border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-muted-foreground">
                  <th className="text-left px-3 py-2 font-medium">Created Account</th>
                  <th className="text-left px-3 py-2 font-medium">Home Domain</th>
                  <th className="text-left px-3 py-2 font-medium">Created At</th>
                  <th className="text-right px-3 py-2 font-medium">Balance</th>
                  <th className="text-left px-3 py-2 font-medium">Probable Funder</th>
                  <th className="text-right px-3 py-2 font-medium">Confidence</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.account + r.createdAt} className="border-b border-border last:border-0 hover:bg-muted/20">
                    <td className="px-3 py-2 font-mono">
                      <ShortAddress address={r.account} network={settings.network as "public" | "testnet"} />
                    </td>
                    <td className="px-3 py-2">
                      {r.homeDomain ? (
                        <span className="text-blue-400 font-medium">{r.homeDomain}</span>
                      ) : r.topFunder === undefined ? (
                        <span className="text-muted-foreground/40 text-xs">…</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground tabular-nums">
                      {new Date(r.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.startingBalance.toFixed(2)} XLM
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {r.topFunder ? (
                        <ShortAddress address={r.topFunder.address} network={settings.network as "public" | "testnet"} />
                      ) : r.topFunder === undefined ? (
                        <span className="text-muted-foreground animate-pulse">searching…</span>
                      ) : r.noNativeCandidates ? (
                        <span className="text-muted-foreground italic text-xs">non-XLM?</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.topFunder ? (
                        <span className={
                          r.topFunder.confidence >= 80 ? "text-green-500 font-semibold" :
                          r.topFunder.confidence >= 60 ? "text-yellow-500 font-semibold" :
                          "text-red-400"
                        }>
                          {r.topFunder.confidence}%
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <a
                        href={`/address-investigator?address=${r.account}&network=${settings.network}`}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        title="Investigate"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Cluster summary — shown when scan is complete and clusters exist */}
      {!running && results.length > 0 && (() => {
        const enriched = results.filter((r) => r.topFunder !== undefined);
        const clusters = detectClusters(
          enriched.map((r) => ({ candidates: r.topFunder ? [r.topFunder] : [], startingBalance: r.startingBalance })),
        );
        if (clusters.size === 0) return null;
        const sorted = [...clusters.entries()].sort((a, b) => b[1].count - a[1].count);
        return (
          <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-yellow-500">
              <Users className="h-4 w-4" />
              Cluster Detection — {sorted.length} repeated funder{sorted.length !== 1 ? "s" : ""} found
            </div>
            <p className="text-xs text-muted-foreground">
              These addresses appear as the probable funder for multiple accounts — possible mass account creation.
            </p>
            <div className="space-y-1">
              {sorted.map(([addr, data]) => (
                <div key={addr} className="flex items-center gap-3 text-xs">
                  <ShortAddress address={addr} network={settings.network as "public" | "testnet"} />
                  <span className="text-muted-foreground">
                    {data.count} accounts · {data.totalFunded.toFixed(2)} XLM total
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {hasStarted && !running && results.length === 0 && !error && (
        <p className="text-sm text-muted-foreground">
          No accounts created by this intermediary in the selected period.
        </p>
      )}
    </div>
  );
}
