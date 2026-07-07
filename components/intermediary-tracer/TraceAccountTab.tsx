"use client";

import { useEffect, useRef, useState } from "react";
import { StrKey } from "stellar-sdk";
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, ChevronRight, Clock, Loader2, Search, Terminal, Waypoints, X } from "lucide-react";
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
import { ShortAddress } from "@/components/shared/ShortAddress";
import { useSettings, resolveHorizonUrl } from "@/lib/settings";
import { getErrorMessage } from "@/lib/stellar-helpers";
import { useActiveWallet } from "@/hooks/use-active-wallet";
import { traceAccountOrigin } from "@/lib/intermediary-tracer/fetchers";
import { getIntermediariesMap } from "@/hooks/use-known-intermediaries";
import { useSavedSearches } from "@/hooks/use-saved-searches";
import { useIntermediaryHistory, intermediaryHistoryGetSnapshot } from "@/hooks/use-intermediary-history";
import { OriginResultCard } from "./OriginResultCard";
import type { TraceResult } from "@/lib/intermediary-tracer/types";

function TraceLogPanel({
  logs,
  running,
}: {
  logs: string[];
  running: boolean;
}) {
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
        Activity Log
        {running && <span className="text-primary animate-pulse ml-1">●</span>}
        {open ? <ChevronDown className="h-3.5 w-3.5 ml-auto" /> : <ChevronRight className="h-3.5 w-3.5 ml-auto" />}
      </button>
      {open && (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="max-h-40 overflow-y-auto bg-black/60 px-3 py-2 space-y-0.5 font-mono text-xs"
        >
          {logs.length === 0 ? (
            <span className="text-muted-foreground">Starting…</span>
          ) : (
            logs.map((line, i) => (
              <div
                key={i}
                className={
                  line.startsWith("Found") || line.startsWith("Created by") || line.startsWith("Created at")
                    ? "text-green-400"
                    : line.startsWith("Known intermediary")
                    ? "text-yellow-400"
                    : line.startsWith("No")
                    ? "text-slate-400"
                    : line.startsWith("Creator is not")
                    ? "text-green-400"
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

export function TraceAccountTab() {
  const { settings } = useSettings();
  const { activeWallet } = useActiveWallet();
  const { upsert: upsertHistory } = useSavedSearches();
  const { history: recentSearches, upsert: upsertRecent, remove: removeRecent } = useIntermediaryHistory();
  const abortRef = useRef<AbortController | null>(null);

  const [address, setAddress] = useState(
    () => intermediaryHistoryGetSnapshot()[0]?.address ?? "",
  );
  const [windowSec, setWindowSec] = useState("300");
  const [tolerancePct, setTolerancePct] = useState("2");
  const [minConfidence, setMinConfidence] = useState("60");

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TraceResult | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [hasStarted, setHasStarted] = useState(false);

  const addLog = (msg: string) => setLogs((prev) => [...prev, msg]);

  const addrValid = StrKey.isValidEd25519PublicKey(address.trim());

  const handleRun = async () => {
    const addr = address.trim();
    if (!addrValid) return;

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setRunning(true);
    setError(null);
    setResult(null);
    setLogs([]);
    setHasStarted(true);

    try {
      const horizonUrl = resolveHorizonUrl(settings);
      const intermediariesMap = getIntermediariesMap();
      const res = await traceAccountOrigin(
        horizonUrl,
        addr,
        parseInt(windowSec),
        parseInt(tolerancePct),
        intermediariesMap,
        abortRef.current.signal,
        addLog,
      );
      if (!abortRef.current.signal.aborted) {
        if (!res) setError("Could not fetch account creation info. Is this a valid Stellar account?");
        else {
          setResult(res);
          upsertRecent({ address: addr, network: settings.network as "public" | "testnet" });
          upsertHistory({
            type: "intermediary-trace",
            value: addr,
            network: settings.network,
            intermediaryName: res.creatorName ?? `${res.creator.slice(0, 4)}…${res.creator.slice(-4)}`,
          });
        }
      }
    } catch (e) {
      if (!abortRef.current?.signal.aborted) setError(getErrorMessage(e));
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
                  <span className="font-mono font-semibold text-foreground">
                    {entry.address.slice(0, 6)}…{entry.address.slice(-6)}
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
            <Waypoints className="h-5 w-5" />
            Trace Account Origin
          </CardTitle>
          <CardDescription>
            Enter any Stellar address to find who created it. If it was created through a
            known intermediary, we will search for the probable real funder.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="trace-addr">Stellar Address</Label>
              {activeWallet && (
                <button
                  type="button"
                  onClick={() => { setAddress(activeWallet.publicKey); setError(null); setResult(null); }}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Use my wallet
                </button>
              )}
            </div>
            <Input
              id="trace-addr"
              value={address}
              onChange={(e) => { setAddress(e.target.value); setError(null); setResult(null); }}
              placeholder="GXXXXXX…"
              className="font-mono text-xs"
              onKeyDown={(e) => { if (e.key === "Enter" && addrValid && !running) handleRun(); }}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Time Window</Label>
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
            <div className="space-y-2">
              <Label>Min Confidence</Label>
              <Select value={minConfidence} onValueChange={setMinConfidence}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="40">40%</SelectItem>
                  <SelectItem value="60">60%</SelectItem>
                  <SelectItem value="80">80%</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
        <CardFooter className="gap-3">
          <Button onClick={handleRun} disabled={running || !addrValid}>
            {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
            Trace Origin
          </Button>
          {running && (
            <Button variant="outline" onClick={() => abortRef.current?.abort()}>Stop</Button>
          )}
        </CardFooter>
      </Card>

      {error && (
        <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {/* Log panel */}
      {hasStarted && <TraceLogPanel logs={logs} running={running} />}

      {/* Result */}
      {result && (
        <div className="space-y-4">
          {/* Summary header */}
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3 flex-wrap text-sm">
                <ShortAddress address={result.targetAccount} network={settings.network as "public" | "testnet"} />
                <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex items-center gap-2">
                  <ShortAddress address={result.creator} network={settings.network as "public" | "testnet"} />
                  {result.creatorName && (
                    <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                      {result.creatorName}
                    </span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {new Date(result.createdAt).toLocaleString()} · {result.startingBalance.toFixed(2)} XLM
                </span>
              </div>

              {!result.isKnownIntermediary && (
                <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                  Creator is not a known intermediary — account was created directly.
                  {" "}
                  <button
                    className="underline text-primary"
                    onClick={() => {
                      // navigate to intermediaries tab is handled via parent tabs
                    }}
                  >
                    Add as intermediary?
                  </button>
                </p>
              )}
            </CardContent>
          </Card>

          {result.isKnownIntermediary && (
            <OriginResultCard
              result={{
                createdAccount: result.targetAccount,
                createdAt: result.createdAt,
                startingBalance: result.startingBalance,
                intermediary: result.creator,
                pagingToken: "",
                candidates: result.candidates,
                noNativeCandidates: result.noNativeCandidates,
              }}
              network={settings.network}
              intermediaryName={result.creatorName}
              minConfidence={parseInt(minConfidence)}
            />
          )}
        </div>
      )}
    </div>
  );
}
