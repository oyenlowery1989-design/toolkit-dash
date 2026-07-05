"use client";

import { useEffect, useRef, useState } from "react";
import { StrKey } from "stellar-sdk";
import {
  AlertTriangle,
  Download,
  Loader2,
  Search,
  UserCheck,
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
import { findCreatorAccounts } from "@/lib/intermediary-tracer/fetchers";
import { useKnownCreators } from "@/hooks/use-known-creators";
import { useKnownIntermediaries } from "@/hooks/use-known-intermediaries";
import { useCreatorChildren } from "@/hooks/use-creator-children";
import type { CreatorChild, CreatorAccountResult } from "@/lib/intermediary-tracer/types";
import { useRouter } from "next/navigation";
import { LogPanel } from "./LogPanel";

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
  { label: "Last 1 hour",  value: "0.042" },
  { label: "Last 3 hours", value: "0.125" },
  { label: "Last 6 hours", value: "0.25" },
  { label: "Last 24 hours", value: "1" },
  { label: "Last 7 days",  value: "7" },
  { label: "Last 30 days", value: "30" },
  { label: "Last 90 days", value: "90" },
  { label: "All time",     value: "all" },
];

function exportCsv(results: CreatorAccountResult[], creatorAddr: string, intermediaryAddr: string) {
  const rows = [
    "created_account,created_at,starting_balance,sent_amount,time_delta_sec,amount_diff_pct,confidence",
    ...results.map((r) =>
      [
        r.createdAccount,
        r.createdAt,
        r.startingBalance.toFixed(7),
        r.sentAmount.toFixed(7),
        r.timeDeltaSec.toFixed(1),
        r.amountDiffPct.toFixed(2),
        r.confidence,
      ].join(",")
    ),
  ];
  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `creator-${creatorAddr.slice(0, 6)}-via-${intermediaryAddr.slice(0, 6)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Result row
// ---------------------------------------------------------------------------

function ResultRow({
  result,
  network,
}: {
  result: CreatorAccountResult;
  network: string;
}) {
  const router = useRouter();
  const color =
    result.confidence >= 80
      ? "text-green-500"
      : result.confidence >= 60
      ? "text-yellow-500"
      : "text-red-400";

  return (
    <div className="rounded-md border border-border bg-muted/10 p-3 space-y-2">
      <div className="flex items-center gap-3 flex-wrap">
        <ShortAddress address={result.createdAccount} network={network as "public" | "testnet"} />
        <span className={`text-xs font-semibold tabular-nums ${color}`}>
          {result.confidence}% confidence
        </span>
        {result.homeDomain && (
          <span className="text-xs text-blue-400 font-medium">{result.homeDomain}</span>
        )}
        <span className="text-xs text-muted-foreground">
          {new Date(result.createdAt).toLocaleString()}
        </span>
        <span className="text-xs text-muted-foreground font-mono">
          {result.startingBalance.toFixed(2)} XLM
        </span>
      </div>
      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
        <span>Sent {result.sentAmount.toFixed(2)} XLM · Δ{result.timeDeltaSec < 60
          ? `${Math.round(result.timeDeltaSec)}s`
          : `${Math.floor(result.timeDeltaSec / 60)}m ${Math.round(result.timeDeltaSec % 60)}s`} after payment</span>
        <span>Amount diff {result.amountDiffPct.toFixed(2)}%</span>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs"
        onClick={() => router.push(`/address-investigator?address=${result.createdAccount}`)}
      >
        <Search className="h-3 w-3 mr-1" />
        Investigate
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main tab
// ---------------------------------------------------------------------------

export function TraceCreatorTab() {
  const { settings } = useSettings();
  const { entries: knownCreators } = useKnownCreators();
  const { entries: knownIntermediaries } = useKnownIntermediaries();
  const abortRef = useRef<AbortController | null>(null);
  const prefilledRef = useRef(false);

  const [creatorAddr, setCreatorAddr] = useState("");
  const [intermediaryAddr, setIntermediaryAddr] = useState("");
  const [windowSec, setWindowSec] = useState("300");
  const [tolerancePct, setTolerancePct] = useState("2");
  const [fromDays, setFromDays] = useState("0.042");

  const { saveChildren, forCreator } = useCreatorChildren();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<CreatorAccountResult[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [hasStarted, setHasStarted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // The known-intermediaries DB cache is empty on first render, so a useState
  // initializer never catches it — prefill once it loads, only if untouched.
  useEffect(() => {
    if (prefilledRef.current || knownIntermediaries.length === 0) return;
    prefilledRef.current = true;
    setIntermediaryAddr((cur) => cur || knownIntermediaries[0].address);
  }, [knownIntermediaries]);

  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  const creatorValid = StrKey.isValidEd25519PublicKey(creatorAddr.trim());
  const intermediaryValid = StrKey.isValidEd25519PublicKey(intermediaryAddr.trim());
  const canRun = creatorValid && intermediaryValid;

  const addLog = (msg: string) => setLogs((prev) => [...prev, msg]);

  const handleRun = async () => {
    if (!canRun) return;
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

      await findCreatorAccounts(
        horizonUrl,
        creatorAddr.trim(),
        intermediaryAddr.trim(),
        fromDate,
        parseInt(windowSec),
        parseInt(tolerancePct),
        abortRef.current.signal,
        addLog,
        (result) => setResults((prev) => [...prev, result]),
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

  const resolvedCreatorName = knownCreators.find((c) => c.address === creatorAddr.trim())?.name;
  const resolvedIntermediaryName = knownIntermediaries.find((c) => c.address === intermediaryAddr.trim())?.name;

  const handleSaveAll = async () => {
    if (results.length === 0 || !creatorAddr.trim()) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const children: CreatorChild[] = results.map((r) => ({
        id: crypto.randomUUID(),
        creatorAddress: creatorAddr.trim(),
        childAddress: r.createdAccount,
        network: settings.network,
        viaIntermediary: intermediaryAddr.trim() || undefined,
        createdOnChain: r.createdAt,
        confidence: r.confidence,
        startingBalance: r.startingBalance,
        homeDomain: r.homeDomain,
        discoveredAt: Date.now(),
      }));
      const { added } = await saveChildren(children);
      const already = children.length - added;
      setSaveMsg(already > 0 ? `${added} new · ${already} already known` : `${added} saved`);
    } finally {
      setSaving(false);
    }
  };

  const existingCount = forCreator(creatorAddr.trim(), settings.network).length;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserCheck className="h-5 w-5" />
            Trace Creator's Accounts
          </CardTitle>
          <CardDescription>
            Given a known real creator and an intermediary, find all accounts
            the creator funded through that intermediary by matching their
            outgoing XLM payments to subsequent <code className="text-xs">create_account</code> ops.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Creator address */}
          <div className="space-y-2">
            <Label>Real Creator Address</Label>
            <div className="flex gap-2">
              <Input
                value={creatorAddr}
                onChange={(e) => { setCreatorAddr(e.target.value); setError(null); }}
                placeholder="GXXXXXX…"
                className="font-mono text-xs flex-1"
                onKeyDown={(e) => { if (e.key === "Enter" && canRun && !running) handleRun(); }}
              />
              {knownCreators.length > 0 && (
                <Select value="" onValueChange={(v) => { if (v) setCreatorAddr(v); }}>
                  <SelectTrigger className="w-36 shrink-0">
                    <SelectValue placeholder="Known…" />
                  </SelectTrigger>
                  <SelectContent>
                    {knownCreators.map((c) => (
                      <SelectItem key={c.address} value={c.address}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            {resolvedCreatorName && (
              <p className="text-xs text-blue-400">Known creator: <span className="font-semibold">{resolvedCreatorName}</span></p>
            )}
          </div>

          {/* Intermediary address */}
          <div className="space-y-2">
            <Label>Intermediary Address</Label>
            <div className="flex gap-2">
              <Input
                value={intermediaryAddr}
                onChange={(e) => { setIntermediaryAddr(e.target.value); setError(null); }}
                placeholder="GXXXXXX…"
                className="font-mono text-xs flex-1"
              />
              {knownIntermediaries.length > 0 && (
                <Select value="" onValueChange={(v) => { if (v) setIntermediaryAddr(v); }}>
                  <SelectTrigger className="w-36 shrink-0">
                    <SelectValue placeholder="Known…" />
                  </SelectTrigger>
                  <SelectContent>
                    {knownIntermediaries.map((c) => (
                      <SelectItem key={c.address} value={c.address}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            {resolvedIntermediaryName && (
              <p className="text-xs text-muted-foreground">Intermediary: <span className="font-semibold">{resolvedIntermediaryName}</span></p>
            )}
          </div>

          {/* Options */}
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
          </div>
        </CardContent>
        <CardFooter className="gap-3 flex-wrap">
          <Button onClick={handleRun} disabled={running || !canRun}>
            {running
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              : <UserCheck className="mr-2 h-4 w-4" />}
            Find Accounts
          </Button>
          {running && (
            <Button variant="outline" onClick={() => abortRef.current?.abort()}>Stop</Button>
          )}
          {results.length > 0 && !running && (
            <>
              <Button variant="outline" onClick={() => exportCsv(results, creatorAddr, intermediaryAddr)}>
                <Download className="mr-2 h-4 w-4" />
                Export CSV
              </Button>
              <Button
                variant="outline"
                onClick={handleSaveAll}
                disabled={saving || !creatorAddr.trim()}
                className="border-primary/40 text-primary hover:bg-primary/10"
              >
                {saving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <UserCheck className="mr-2 h-4 w-4" />
                )}
                Save {results.length} to Creator
                {existingCount > 0 && <span className="ml-1 text-muted-foreground">({existingCount} known)</span>}
              </Button>
              {saveMsg && (
                <span className="text-xs text-green-500">{saveMsg}</span>
              )}
            </>
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
        <div className="space-y-4">
          <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
            <span>
              <span className="font-semibold text-foreground">{results.length}</span>{" "}
              account{results.length !== 1 ? "s" : ""} found
              {running && <span className="ml-2 text-xs text-primary animate-pulse">live</span>}
            </span>
          </div>
          <div className="space-y-2">
            {results.map((r, i) => (
              <ResultRow
                key={`${r.createdAccount}:${r.createdAt}:${i}`}
                result={r}
                network={settings.network}
              />
            ))}
          </div>
        </div>
      )}

      {hasStarted && !running && results.length === 0 && !error && (
        <p className="text-sm text-muted-foreground">
          No accounts found. The creator may not have used this intermediary in the selected period,
          or the amounts/timing didn't match within the configured tolerance.
        </p>
      )}
    </div>
  );
}
