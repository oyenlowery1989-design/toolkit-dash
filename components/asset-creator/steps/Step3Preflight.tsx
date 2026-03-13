// components/asset-creator/steps/Step3Preflight.tsx
"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Horizon } from "stellar-sdk";
import { CheckCircle2, XCircle, AlertTriangle, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resolveHorizonUrl, resolveNetworkPassphrase } from "@/lib/settings";
import {
  checkAccountExists,
  checkBalance,
  checkAssetExists,
  estimateFees,
} from "@/lib/asset-creator/preflight";
import { runAssetCreation } from "@/lib/asset-creator/runner";
import { StandardStrategy } from "@/lib/asset-creator/builder";
import type { AssetCreatorForm, PreflightCheck, StepResult } from "@/lib/asset-creator/types";

interface Props {
  form: AssetCreatorForm;
  completedSteps: Set<string>;
  onBack: () => void;
  onComplete: (results: StepResult[]) => void;
}

export function Step3Preflight({ form, completedSteps, onBack, onComplete }: Props) {
  const [checks, setChecks] = useState<PreflightCheck[]>([]);
  const [feesXlm, setFeesXlm] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [running, setRunning] = useState(false);
  const [warningAcked, setWarningAcked] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);

  const onLog = useCallback((msg: string) => {
    setLogs((prev) => [...prev, msg]);
  }, []);

  // Auto-scroll log only when at bottom
  useEffect(() => {
    if (!userScrolledUp.current) {
      logEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  const runPreflight = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    setChecking(true);
    setChecks([]);
    setFeesXlm(null);
    setWarningAcked(false);

    const horizonUrl = resolveHorizonUrl({ network: form.network, localHorizonUrl: "" });
    const server = new Horizon.Server(horizonUrl);

    const allChecks: PreflightCheck[] = [];
    const push = (c: PreflightCheck) => {
      allChecks.push(c);
      setChecks([...allChecks]);
    };

    try {
      push(await checkAccountExists(form.issuerPublicKey, server, onLog, signal, horizonUrl));
      push(await checkBalance(form.issuerPublicKey, 1.5, server, onLog, signal, horizonUrl));
      push(await checkAccountExists(form.distributorPublicKey, server, onLog, signal, horizonUrl));
      push(await checkBalance(form.distributorPublicKey, 1.5, server, onLog, signal, horizonUrl));
      push(await checkAssetExists(form.assetCode, form.issuerPublicKey, server, onLog, signal, horizonUrl));
      const fees = await estimateFees(server);
      setFeesXlm(fees);
    } catch {
      // aborted
    } finally {
      setChecking(false);
    }
  }, [form, onLog]);

  // Run preflight on mount
  useEffect(() => { runPreflight(); return () => abortRef.current?.abort(); }, [runPreflight]);

  const hasBlockingFail = checks.some((c) => c.blocking && c.status === "fail");
  const hasWarning = checks.some((c) => !c.blocking && c.status === "warning");
  const canExecute = !checking && !running && !hasBlockingFail && (!hasWarning || warningAcked);

  const handleExecute = async () => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    setRunning(true);
    setLogOpen(true);

    const server = new Horizon.Server(resolveHorizonUrl({ network: form.network, localHorizonUrl: "" }));
    const networkPassphrase = resolveNetworkPassphrase(form.network);

    const results = await runAssetCreation(form, completedSteps as Set<"fund-accounts" | "set-home-domain" | "trustline" | "issuance">, {
      strategy: StandardStrategy,
      server,
      networkPassphrase,
      signal,
      onLog,
      onStep: () => {},
    });

    setRunning(false);
    onComplete(results);
  };

  const statusIcon = (status: PreflightCheck["status"]) => {
    if (status === "loading") return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
    if (status === "pass") return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    if (status === "fail") return <XCircle className="h-4 w-4 text-destructive" />;
    return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
  };

  return (
    <div className="space-y-6">
      {/* Checklist */}
      <div className="space-y-2">
        {checks.map((c) => (
          <div key={c.id} className="flex items-start gap-3 py-2 border-b border-border/50 last:border-0">
            <div className="mt-0.5">{statusIcon(c.status)}</div>
            <div>
              <p className="text-sm">{c.label}</p>
              {c.message && <p className="text-xs text-muted-foreground mt-0.5">{c.message}</p>}
            </div>
          </div>
        ))}
        {checking && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Running preflight checks…
          </div>
        )}
      </div>

      {feesXlm && (
        <p className="text-sm text-muted-foreground">Estimated fees: ~{feesXlm} XLM</p>
      )}

      {/* Warning acknowledgement */}
      {hasWarning && (
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={warningAcked}
            onChange={(e) => setWarningAcked(e.target.checked)}
            className="rounded"
          />
          Proceed anyway (I understand the warnings above)
        </label>
      )}

      {/* Activity log */}
      {logs.length > 0 && (
        <div className="space-y-1">
          <button
            type="button"
            onClick={() => setLogOpen((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {logOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            Activity log ({logs.length} entries)
          </button>
          {logOpen && (
            <div
              className="bg-muted rounded-md p-3 h-40 overflow-y-auto font-mono text-xs space-y-0.5"
              onScroll={(e) => {
                const el = e.currentTarget;
                userScrolledUp.current = el.scrollTop + el.clientHeight < el.scrollHeight - 10;
              }}
            >
              {logs.map((line, i) => <div key={i}>{line}</div>)}
              <div ref={logEndRef} />
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="outline" onClick={onBack} disabled={running}>← Back</Button>
        <Button variant="outline" onClick={runPreflight} disabled={checking || running}>Re-check</Button>
        <Button onClick={handleExecute} disabled={!canExecute}>
          {running ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Executing…</> : "Execute →"}
        </Button>
      </div>
    </div>
  );
}
