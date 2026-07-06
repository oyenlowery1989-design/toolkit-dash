"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  Loader2,
  ScanSearch,
  Terminal,
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
import { ShortAddress } from "@/components/shared/ShortAddress";
import { useSettings, resolveHorizonUrl } from "@/lib/settings";
import { parseAddresses } from "@/lib/format";
import { downloadCSV } from "@/lib/csv-export";
import { getIntermediariesMap } from "@/hooks/use-known-intermediaries";
import { runBulkTrace, type BulkTraceRow } from "@/lib/tracer-v2/bulk-trace";

// Defaults verified against components/intermediary-tracer/TraceAccountTab.tsx
// (windowSec "300" = 5 min, tolerancePct "2" = 2%).
const DEFAULT_WINDOW_SEC = "300";
const DEFAULT_TOLERANCE_PCT = "2";

// ---------------------------------------------------------------------------
// Activity log — scroll-guard mirrored verbatim from
// components/intermediary-tracer/LogPanel.tsx / TraceAccountTab.tsx
// (imported nowhere; intermediary-tracer is import-only for pure functions).
// ---------------------------------------------------------------------------
function BulkTraceLogPanel({ logs, running }: { logs: string[]; running: boolean }) {
  const [open, setOpen] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    userScrolledUp.current = el.scrollTop + el.clientHeight < el.scrollHeight - 20;
  };

  useEffect(() => {
    if (open && !userScrolledUp.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, open]);

  return (
    <div className="rounded-md border border-border overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 bg-muted/40 hover:bg-muted/60 transition-colors text-xs font-medium text-muted-foreground"
        onClick={() => setOpen((v) => !v)}
      >
        <Terminal className="h-3.5 w-3.5" />
        Activity Log ({logs.length} lines)
        {running && <span className="text-primary animate-pulse ml-1">●</span>}
        {open ? <ChevronDown className="h-3.5 w-3.5 ml-auto" /> : <ChevronRight className="h-3.5 w-3.5 ml-auto" />}
      </button>
      {open && (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="max-h-52 overflow-y-auto bg-black/60 px-3 py-2 space-y-0.5 font-mono text-xs"
        >
          {logs.length === 0 ? (
            <span className="text-muted-foreground">No activity yet.</span>
          ) : (
            logs.map((line, i) => (
              <div
                key={i}
                className={
                  line.startsWith("Found") || line.startsWith("Created by") || line.startsWith("Created at")
                    ? "text-green-400"
                    : line.startsWith("Known intermediary")
                    ? "text-yellow-400"
                    : line.startsWith("ERROR")
                    ? "text-red-400"
                    : line.startsWith("No")
                    ? "text-slate-400"
                    : "text-slate-300"
                }
              >
                {line}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}

const STATUS_STYLES: Record<BulkTraceRow["status"], string> = {
  pending: "bg-muted text-muted-foreground animate-pulse",
  done: "bg-green-500/10 text-green-500 border border-green-500/30",
  error: "bg-red-500/10 text-red-400 border border-red-500/30",
  "not-found": "bg-amber-500/10 text-amber-400 border border-amber-500/30",
};

const STATUS_LABELS: Record<BulkTraceRow["status"], string> = {
  pending: "pending",
  done: "done",
  error: "error",
  "not-found": "not found",
};

function StatusPill({ status }: { status: BulkTraceRow["status"] }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wide ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

export function BulkTraceTab() {
  const { settings } = useSettings();
  const abortRef = useRef<AbortController | null>(null);

  const [text, setText] = useState("");
  const [windowSec, setWindowSec] = useState(DEFAULT_WINDOW_SEC);
  const [tolerancePct, setTolerancePct] = useState(DEFAULT_TOLERANCE_PCT);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<BulkTraceRow[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [hasStarted, setHasStarted] = useState(false);

  const addLog = (msg: string) => setLogs((prev) => [...prev, msg]);

  const parsedAddresses = useMemo(() => parseAddresses(text), [text]);
  const nonEmptyLineCount = useMemo(
    () => text.split("\n").map((l) => l.trim()).filter(Boolean).length,
    [text],
  );
  const skippedCount = Math.max(0, nonEmptyLineCount - parsedAddresses.length);

  // Abort in-flight trace on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const mergeRow = (row: BulkTraceRow) => {
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.address === row.address);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = row;
        return next;
      }
      return [...prev, row];
    });
  };

  const handleRun = async (addressesOverride?: string[]) => {
    const addresses = addressesOverride ?? parsedAddresses;
    if (addresses.length === 0) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setRunning(true);
    setError(null);
    setLogs([]);
    setHasStarted(true);

    try {
      const horizonUrl = resolveHorizonUrl(settings);
      const knownIntermediaries = getIntermediariesMap();
      await runBulkTrace({
        addresses,
        horizonUrl,
        windowSec: parseInt(windowSec, 10) || parseInt(DEFAULT_WINDOW_SEC, 10),
        tolerancePct: parseFloat(tolerancePct) || parseFloat(DEFAULT_TOLERANCE_PCT),
        knownIntermediaries,
        signal: controller.signal,
        onLog: addLog,
        onResult: mergeRow,
      });
    } catch (e) {
      if (!controller.signal.aborted) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setRunning(false);
    }
  };

  // -------------------------------------------------------------------------
  // Deep-link: ?addresses=A,B,C or newline-separated. Hydration-safe — waits
  // for mount, fires once per distinct param value, mirrors the
  // lastUrlAddressRunRef pattern in AddressInvestigatorTab.tsx.
  // -------------------------------------------------------------------------
  const searchParams = useSearchParams();
  const urlAddressesParam = searchParams.get("addresses");
  const deepLinkRanRef = useRef<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  useEffect(() => {
    if (!hydrated) return;
    if (!urlAddressesParam) return;
    if (deepLinkRanRef.current === urlAddressesParam) return;
    deepLinkRanRef.current = urlAddressesParam;

    const normalized = urlAddressesParam
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .join("\n");
    setText(normalized);

    const addresses = parseAddresses(normalized);
    if (addresses.length > 0) handleRun(addresses);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlAddressesParam, hydrated]);

  const handleExportCsv = () => {
    downloadCSV(
      "bulk-trace.csv",
      ["Address", "Status", "Creator", "Creator Known Intermediary", "Top Candidate", "Confidence"],
      rows.map((r) => [
        r.address,
        r.status,
        r.result?.creator ?? "",
        r.result ? (r.result.isKnownIntermediary ? "yes" : "no") : "",
        r.result?.candidates[0]?.address ?? "",
        r.result?.candidates[0]?.confidence?.toString() ?? "",
      ]),
    );
  };

  const network = settings.network;
  const doneCount = rows.filter((r) => r.status !== "pending").length;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ScanSearch className="h-5 w-5" />
            Bulk Trace
          </CardTitle>
          <CardDescription>
            Paste any number of Stellar addresses to trace the origin of each concurrently.
            Reuses the same origin tracer as Intermediary Tracer &gt; Trace Single Account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="bulk-trace-addresses">Addresses (one per line)</Label>
            <textarea
              id="bulk-trace-addresses"
              className="w-full min-h-40 rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono"
              placeholder={"G...\nG..."}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {parsedAddresses.length.toLocaleString()} valid address{parsedAddresses.length !== 1 ? "es" : ""}
              {skippedCount > 0 && (
                <span className="text-amber-400"> · {skippedCount} skipped (invalid or duplicate)</span>
              )}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="bulk-trace-window">Funder Time Window (seconds)</Label>
              <Input
                id="bulk-trace-window"
                type="number"
                min={1}
                value={windowSec}
                onChange={(e) => setWindowSec(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bulk-trace-tolerance">Amount Tolerance (%)</Label>
              <Input
                id="bulk-trace-tolerance"
                type="number"
                min={0}
                step="0.1"
                value={tolerancePct}
                onChange={(e) => setTolerancePct(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
        <CardFooter className="gap-3 flex-wrap">
          <Button onClick={() => handleRun()} disabled={running || parsedAddresses.length === 0}>
            {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ScanSearch className="mr-2 h-4 w-4" />}
            Trace {parsedAddresses.length > 0 ? parsedAddresses.length : ""} Address
            {parsedAddresses.length !== 1 ? "es" : ""}
          </Button>
          {running && (
            <Button variant="outline" onClick={() => abortRef.current?.abort()}>
              Stop
            </Button>
          )}
          {rows.length > 0 && !running && (
            <Button variant="outline" onClick={handleExportCsv}>
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

      {hasStarted && <BulkTraceLogPanel logs={logs} running={running} />}

      {rows.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{doneCount}</span> / {rows.length} traced
            {running && <span className="ml-2 text-xs text-primary animate-pulse">live</span>}
          </p>
          <div className="rounded-md border border-border overflow-x-auto">
            <table className="w-full text-xs min-w-[720px]">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-muted-foreground">
                  <th className="text-left px-3 py-2 font-medium">Address</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                  <th className="text-left px-3 py-2 font-medium">Creator</th>
                  <th className="text-left px-3 py-2 font-medium">Top Candidate</th>
                  <th className="text-right px-3 py-2 font-medium">Confidence</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const topCandidate = row.result?.candidates[0];
                  return (
                    <tr key={row.address} className="border-b border-border last:border-0 hover:bg-muted/20">
                      <td className="px-3 py-2 font-mono">
                        <ShortAddress address={row.address} network={network} />
                      </td>
                      <td className="px-3 py-2">
                        <StatusPill status={row.status} />
                      </td>
                      <td className="px-3 py-2 font-mono">
                        {row.result ? (
                          <div className="flex items-center gap-1.5">
                            <ShortAddress address={row.result.creator} network={network} />
                            {row.result.creatorName && (
                              <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium">
                                {row.result.creatorName}
                              </span>
                            )}
                          </div>
                        ) : row.status === "error" ? (
                          <span className="text-red-400 text-[11px]">{row.error ?? "trace failed"}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono">
                        {topCandidate ? (
                          <ShortAddress address={topCandidate.address} network={network} />
                        ) : row.result?.noNativeCandidates ? (
                          <span className="text-muted-foreground italic text-[11px]">non-XLM?</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {topCandidate ? (
                          <span
                            className={
                              topCandidate.confidence >= 80
                                ? "text-green-500 font-semibold"
                                : topCandidate.confidence >= 60
                                ? "text-yellow-500 font-semibold"
                                : "text-red-400"
                            }
                          >
                            {topCandidate.confidence}%
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <a
                          href={`/address-investigator?address=${row.address}&network=${network}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-foreground transition-colors"
                          title="Investigate"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {hasStarted && !running && rows.length === 0 && !error && (
        <p className="text-sm text-muted-foreground">No results yet.</p>
      )}
    </div>
  );
}
