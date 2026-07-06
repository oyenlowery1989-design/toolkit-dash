"use client";

import React, { useRef, useState } from "react";
import { Keypair } from "stellar-sdk";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Square,
  Trash2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useSettings, resolveHorizonUrl } from "@/lib/settings";
import { shortAddr } from "@/lib/format";
import { StrKey } from "stellar-sdk";
import {
  addTrustlineBulk,
  drainAndRemoveBulk,
  parseBulkAssets,
  MAX_TRUST_LIMIT,
  type BulkResult,
  type ParsedAssetLine,
} from "@/lib/trustline-manager";

interface ParsedSecret {
  raw: string;
  pubkey?: string;
  error?: string;
}

function parseSecrets(text: string): ParsedSecret[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((raw) => {
      try {
        const kp = Keypair.fromSecret(raw);
        return { raw, pubkey: kp.publicKey() };
      } catch {
        return { raw, error: "Invalid secret key" };
      }
    });
}

type CellStatus = "pending" | "success" | "error" | "idle";

interface CellData {
  status: CellStatus;
  txHash?: string;
  error?: string;
}

function cellKey(pubkey: string, code: string, issuer: string) {
  return `${pubkey}|${code}|${issuer}`;
}

export function BulkTrustlineTab() {
  const { settings } = useSettings();

  const [assetText, setAssetText] = useState("");
  const [secretText, setSecretText] = useState("");
  const [limit, setLimit] = useState(MAX_TRUST_LIMIT);

  const [autoDelete, setAutoDelete] = useState(false);
  const [drainFirst, setDrainFirst] = useState(false);
  const [drainDestination, setDrainDestination] = useState("");
  const [running, setRunning] = useState(false);
  const [runMode, setRunMode] = useState<"add" | "remove">("add");
  const [cells, setCells] = useState<Record<string, CellData>>({});
  const [logs, setLogs] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const parsedAssets: ParsedAssetLine[] = parseBulkAssets(assetText);
  const parsedSecrets: ParsedSecret[] = parseSecrets(secretText);

  const validAssets = parsedAssets.filter((a) => !a.error && a.code && a.issuer);
  const validSecrets = parsedSecrets.filter((s) => !s.error && s.pubkey);
  const invalidAssets = parsedAssets.filter((a) => a.error);
  const invalidSecrets = parsedSecrets.filter((s) => s.error);

  const totalTrustlines = validAssets.length * validSecrets.length;
  const drainDestValid = StrKey.isValidEd25519PublicKey(drainDestination.trim());
  const canRun = validAssets.length > 0 && validSecrets.length > 0 && !running;
  const canRemove = canRun && (!drainFirst || drainDestValid);

  function handleResult(result: BulkResult) {
    const key = cellKey(result.accountPubkey, result.assetCode, result.issuer);
    setCells((prev) => ({
      ...prev,
      [key]: {
        status: result.status,
        txHash: result.txHash,
        error: result.error,
      },
    }));
  }

  async function handleRun(mode: "add" | "remove") {
    if (!canRun) return;

    setRunMode(mode);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    // Set all cells to pending
    const initial: Record<string, CellData> = {};
    for (const s of validSecrets) {
      for (const a of validAssets) {
        initial[cellKey(s.pubkey!, a.code!, a.issuer!)] = { status: "pending" };
      }
    }
    setCells(initial);
    setLogs([]);
    setRunning(true);

    const bulkAssets = validAssets.map((a) => ({ code: a.code!, issuer: a.issuer! }));
    const bulkSecrets = validSecrets.map((s) => s.raw);
    const horizonUrl = resolveHorizonUrl(settings);

    try {
      if (mode === "remove" && drainFirst && drainDestination.trim()) {
        await drainAndRemoveBulk({
          assets: bulkAssets,
          signingSecrets: bulkSecrets,
          destination: drainDestination.trim(),
          horizonUrl,
          network: settings.network,
          onResult: handleResult,
          onLog: (msg) => setLogs((prev) => [...prev, msg]),
          signal: ctrl.signal,
        });
      } else {
        await addTrustlineBulk({
          assets: bulkAssets,
          signingSecrets: bulkSecrets,
          remove: mode === "remove",
          limit: mode === "remove" ? "0" : (limit.trim() || MAX_TRUST_LIMIT),
          horizonUrl,
          network: settings.network,
          onResult: handleResult,
          onLog: (msg) => setLogs((prev) => [...prev, msg]),
          signal: ctrl.signal,
        });
      }

      // Auto-delete: run a second pass removing all trustlines just added
      if (mode === "add" && autoDelete && !ctrl.signal.aborted) {
        setLogs((prev) => [...prev, "— Auto-delete pass starting…"]);
        await addTrustlineBulk({
          assets: bulkAssets,
          signingSecrets: bulkSecrets,
          remove: true,
          horizonUrl,
          network: settings.network,
          onResult: (result) =>
            handleResult({ ...result, assetCode: result.assetCode, issuer: result.issuer }),
          onLog: (msg) => setLogs((prev) => [...prev, `[delete] ${msg}`]),
          signal: ctrl.signal,
        });
      }
    } finally {
      setRunning(false);
    }
  }

  function handleStop() {
    abortRef.current?.abort();
  }

  const doneCount = Object.values(cells).filter(
    (c) => c.status === "success" || c.status === "error"
  ).length;
  const successCount = Object.values(cells).filter((c) => c.status === "success").length;
  const errorCount = Object.values(cells).filter((c) => c.status === "error").length;

  return (
    <div className="space-y-6">
      {/* Limit */}
      <div className="max-w-xs">
        <Label htmlFor="bulk-limit">Trust Limit (all assets)</Label>
        <Input
          id="bulk-limit"
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          placeholder={MAX_TRUST_LIMIT}
          className="mt-1 font-mono text-xs"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Asset list */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <Label htmlFor="bulk-assets">Assets (CODE:ISSUER, one per line)</Label>
            {parsedAssets.length > 0 && (
              <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                {validAssets.length} valid
              </span>
            )}
          </div>
          <textarea
            id="bulk-assets"
            value={assetText}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setAssetText(e.target.value)}
            placeholder={"USDC:GA5ZSE…\nUSDT:GB3JLY…"}
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-mono text-xs min-h-[160px] mt-1 resize-y"
          />
          {invalidAssets.length > 0 && (
            <div className="mt-2 space-y-1">
              {invalidAssets.map((a, i) => (
                <div key={i} className="flex items-center gap-1.5 text-xs text-destructive">
                  <XCircle className="h-3 w-3 shrink-0" />
                  <span className="font-mono truncate">{a.raw}</span>
                  <span className="text-muted-foreground">— {a.error}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Secret key list */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <Label htmlFor="bulk-secrets">Account Secret Keys (one per line)</Label>
            {parsedSecrets.length > 0 && (
              <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                {validSecrets.length} accounts
              </span>
            )}
          </div>
          <textarea
            id="bulk-secrets"
            value={secretText}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setSecretText(e.target.value)}
            placeholder={"SCZANGBA…\nSCZANGB…"}
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-mono text-xs min-h-[160px] mt-1 resize-y"
          />
          {invalidSecrets.length > 0 && (
            <div className="mt-2 space-y-1">
              {invalidSecrets.map((s, i) => (
                <div key={i} className="flex items-center gap-1.5 text-xs text-destructive">
                  <XCircle className="h-3 w-3 shrink-0" />
                  <span className="font-mono">{s.raw.slice(0, 8)}…</span>
                  <span className="text-muted-foreground">— {s.error}</span>
                </div>
              ))}
            </div>
          )}
          {/* Derived pubkeys preview */}
          {validSecrets.length > 0 && (
            <div className="mt-2 space-y-1">
              {validSecrets.slice(0, 5).map((s, i) => (
                <div key={i} className="text-xs font-mono text-muted-foreground">
                  → {shortAddr(s.pubkey!)}
                </div>
              ))}
              {validSecrets.length > 5 && (
                <div className="text-xs text-muted-foreground">
                  +{validSecrets.length - 5} more
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Remove mode: offer warning note */}
      <div className="flex items-start gap-2 px-3 py-2.5 rounded-md bg-amber-500/10 border border-amber-500/30 text-xs">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
        <span className="text-amber-700 dark:text-amber-400">
          <strong>Before removing:</strong> each account must have <strong>zero balance</strong> and <strong>no open offers</strong> for the asset. Use the <em>Single</em> tab to check and cancel offers per account first.
        </span>
      </div>

      {/* Auto-delete toggle */}
      {!running && (
        <label className="flex items-start gap-3 cursor-pointer group w-fit">
          <input
            type="checkbox"
            checked={autoDelete}
            onChange={(e) => setAutoDelete(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-border accent-primary cursor-pointer"
          />
          <div>
            <span className="text-sm font-medium group-hover:text-foreground transition-colors">
              Auto-delete after adding
            </span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Removes all trustlines immediately after the add pass completes.
            </p>
          </div>
        </label>
      )}

      {/* Preview + controls */}
      {totalTrustlines > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-muted-foreground">
              {validAssets.length} asset{validAssets.length !== 1 ? "s" : ""} ×{" "}
              {validSecrets.length} account{validSecrets.length !== 1 ? "s" : ""} ={" "}
              <strong className="text-foreground">{totalTrustlines}</strong> trustlines
            </span>
            {!running && (
              <>
                <Button onClick={() => handleRun("add")} disabled={!canRun}>
                  Add Trustlines
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleRun("remove")}
                  disabled={!canRemove}
                  className="border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  Remove Trustlines
                </Button>
              </>
            )}
            {running && (
              <>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {runMode === "remove" ? "Removing" : autoDelete ? "Add → Delete" : "Adding"} — {doneCount}/{totalTrustlines} done
                </div>
                <Button variant="destructive" size="sm" onClick={handleStop}>
                  <Square className="h-3.5 w-3.5 mr-1.5" />
                  Stop
                </Button>
              </>
            )}
          </div>
          {/* Drain option + remove warning */}
          {!running && (
            <div className="space-y-3">
              <label className="flex items-start gap-3 cursor-pointer group w-fit">
                <input
                  type="checkbox"
                  checked={drainFirst}
                  onChange={(e) => setDrainFirst(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-border accent-primary cursor-pointer"
                />
                <div>
                  <span className="text-sm font-medium group-hover:text-foreground transition-colors">
                    Send all balance to destination first
                  </span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Custom assets: sends balance then removes trustline. XLM: Account Merge.
                  </p>
                </div>
              </label>

              {drainFirst && (
                <div className="max-w-sm">
                  <Label htmlFor="bulk-drain-dest">Destination Address</Label>
                  <Input
                    id="bulk-drain-dest"
                    value={drainDestination}
                    onChange={(e) => setDrainDestination(e.target.value)}
                    placeholder="G…"
                    className={`mt-1 font-mono text-xs ${
                      drainDestination && !StrKey.isValidEd25519PublicKey(drainDestination)
                        ? "border-destructive"
                        : ""
                    }`}
                  />
                </div>
              )}

              {!drainFirst && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-destructive/10 border border-destructive/30 text-xs">
                  <AlertTriangle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
                  <span className="text-destructive">
                    Remove requires each account to have <strong>zero balance</strong> of the asset
                    and no open sell offers.
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Summary bar (after run) */}
      {doneCount > 0 && !running && (
        <div className="flex items-center gap-4 text-sm">
          <span className="text-muted-foreground">
            {runMode === "remove" ? "Removed" : "Added"}:
          </span>
          <span className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
            <CheckCircle2 className="h-4 w-4" />
            {successCount} succeeded
          </span>
          {errorCount > 0 && (
            <span className="flex items-center gap-1.5 text-destructive">
              <XCircle className="h-4 w-4" />
              {errorCount} failed
            </span>
          )}
        </div>
      )}

      {/* Progress table */}
      {Object.keys(cells).length > 0 && validAssets.length > 0 && validSecrets.length > 0 && (
        <div className="overflow-auto rounded-md border border-border">
          <table className="text-xs w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground sticky left-0 bg-muted/50">
                  Account
                </th>
                {validAssets.map((a) => (
                  <th
                    key={`${a.code}:${a.issuer}`}
                    className="text-center px-3 py-2 font-medium text-muted-foreground whitespace-nowrap"
                  >
                    {a.code}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {validSecrets.map((s) => (
                <tr key={s.pubkey} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="px-3 py-2 font-mono sticky left-0 bg-background">
                    {shortAddr(s.pubkey!)}
                  </td>
                  {validAssets.map((a) => {
                    const key = cellKey(s.pubkey!, a.code!, a.issuer!);
                    const cell = cells[key] ?? { status: "idle" };
                    return (
                      <td key={key} className="px-3 py-2 text-center">
                        <CellIcon cell={cell} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Logs */}
      {logs.length > 0 && (
        <details className="rounded-md border border-border">
          <summary className="px-3 py-2 text-xs text-muted-foreground cursor-pointer select-none">
            Activity log ({logs.length} lines)
          </summary>
          <div className="px-3 pb-3 space-y-0.5 font-mono text-xs text-muted-foreground max-h-48 overflow-y-auto">
            {logs.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function CellIcon({ cell }: { cell: CellData }) {
  switch (cell.status) {
    case "pending":
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground mx-auto" />;
    case "success":
      return (
        <span title={cell.txHash}>
          <CheckCircle2 className="h-3.5 w-3.5 text-green-500 mx-auto" />
        </span>
      );
    case "error":
      return (
        <span title={cell.error}>
          <XCircle className="h-3.5 w-3.5 text-destructive mx-auto" />
        </span>
      );
    default:
      return <span className="text-muted-foreground">—</span>;
  }
}
