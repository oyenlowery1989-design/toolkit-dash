"use client";

import { useRef, useState } from "react";
import {
  CheckCircle2,
  Download,
  ExternalLink,
  Loader2,
  Lock,
  LockOpen,
  Minus,
} from "lucide-react";
import { StrKey } from "stellar-sdk";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSettings, resolveHorizonUrl } from "@/lib/settings";
import { useAssetGroups } from "@/hooks/use-asset-groups";
import { useActiveWallet } from "@/hooks/use-active-wallet";
import { shortAddr } from "@/lib/format";
import { ShortAddress } from "@/components/asset-lookup";
import { downloadCSV } from "@/lib/csv-export";
import {
  fetchTrustlineHolders,
  setTrustlineAuthorization,
  type TrustlineHolder,
  type TrustlineAction,
} from "@/lib/asset-manager";

const STATUS_LABELS: Record<TrustlineHolder["status"], string> = {
  authorized: "Authorized",
  maintain_liabilities: "Maintain Only",
  frozen: "Frozen",
};

const STATUS_STYLES: Record<TrustlineHolder["status"], string> = {
  authorized: "text-green-500 bg-green-500/10 border-green-500/30",
  maintain_liabilities: "text-amber-500 bg-amber-500/10 border-amber-500/30",
  frozen: "text-destructive bg-destructive/10 border-destructive/30",
};

export function TrustlinesTab() {
  const { settings } = useSettings();
  const { groups } = useAssetGroups();
  const { activeWallet } = useActiveWallet();

  const [assetCode, setAssetCode] = useState("");
  const [issuer, setIssuer] = useState("");
  const [secretKey, setSecretKey] = useState("");

  const [holders, setHolders] = useState<TrustlineHolder[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanDone, setScanDone] = useState(false);

  const [pendingAddress, setPendingAddress] = useState<string | null>(null);
  const [actionResults, setActionResults] = useState<
    Record<string, { hash: string; error?: string }>
  >({});

  const abortRef = useRef<AbortController | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const logBoxRef = useRef<HTMLDivElement | null>(null);
  const userScrolledUp = useRef(false);

  const horizonUrl = resolveHorizonUrl(settings);
  const effectiveSecretKey = activeWallet?.secretKey ?? secretKey.trim();
  const issuerAddress = issuer.trim();
  const canScan =
    assetCode.trim().length > 0 &&
    StrKey.isValidEd25519PublicKey(issuerAddress);

  const explorerBase =
    settings.network === "public"
      ? "https://stellar.expert/explorer/public"
      : settings.network === "testnet"
        ? "https://stellar.expert/explorer/testnet"
        : null;

  function onLog(msg: string) {
    setLogs((prev) => [...prev, msg]);
    if (!userScrolledUp.current) {
      setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: "smooth" }), 10);
    }
  }

  function handleLoadFromGroup(groupId: string) {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    if (group.assetCode) setAssetCode(group.assetCode);
    if (group.issuer) setIssuer(group.issuer);
  }

  async function handleScan() {
    if (!canScan) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setHolders([]);
    setLogs([]);
    setScanning(true);
    setScanDone(false);
    setActionResults({});
    userScrolledUp.current = false;

    try {
      await fetchTrustlineHolders(
        horizonUrl,
        assetCode.trim(),
        issuerAddress,
        abortRef.current.signal,
        (newHolders) => {
          setHolders((prev) => {
            const map = new Map(prev.map((h) => [h.address, h]));
            for (const h of newHolders) map.set(h.address, h);
            return Array.from(map.values());
          });
        },
        onLog,
      );
    } finally {
      setScanning(false);
      setScanDone(true);
    }
  }

  function handleStop() {
    abortRef.current?.abort();
    setScanning(false);
  }

  async function handleAction(address: string, action: TrustlineAction) {
    if (!effectiveSecretKey) return;
    setPendingAddress(address);
    try {
      const hash = await setTrustlineAuthorization(
        horizonUrl,
        effectiveSecretKey,
        address,
        assetCode.trim(),
        issuerAddress,
        action,
        settings.network,
      );
      setActionResults((prev) => ({ ...prev, [address]: { hash } }));
      // Update holder status optimistically
      const newStatus =
        action === "authorize"
          ? "authorized"
          : action === "freeze"
            ? "frozen"
            : "maintain_liabilities";
      setHolders((prev) =>
        prev.map((h) =>
          h.address === address ? { ...h, status: newStatus } : h,
        ),
      );
    } catch (e) {
      setActionResults((prev) => ({
        ...prev,
        [address]: { hash: "", error: e instanceof Error ? e.message : String(e) },
      }));
    } finally {
      setPendingAddress(null);
    }
  }

  function handleExport() {
    downloadCSV(
      `trustlines-${assetCode}.csv`,
      ["Address", "Balance", "Limit", "Status"],
      holders.map((h) => [h.address, h.balance, h.limit, STATUS_LABELS[h.status]]),
    );
  }

  const frozen = holders.filter((h) => h.status === "frozen").length;
  const authorized = holders.filter((h) => h.status === "authorized").length;
  const maintainOnly = holders.filter(
    (h) => h.status === "maintain_liabilities",
  ).length;

  return (
    <div className="space-y-6">
      {/* Asset input */}
      <Card>
        <CardHeader>
          <CardTitle>Asset</CardTitle>
          <CardDescription>
            Scan all accounts holding your token. Then freeze, unfreeze, or
            restrict individual holders. Requires AUTH_REVOCABLE on your issuer
            account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {groups.length > 0 && (
            <div>
              <Label className="text-xs">Load from Asset Group</Label>
              <Select onValueChange={handleLoadFromGroup}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select a group…" />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                      {g.assetCode ? ` (${g.assetCode})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="tl-code">Asset Code</Label>
              <Input
                id="tl-code"
                placeholder="e.g. MYTOKEN"
                value={assetCode}
                onChange={(e) => setAssetCode(e.target.value)}
                className="mt-1 font-mono"
              />
            </div>
            <div>
              <Label htmlFor="tl-issuer">Issuer Address</Label>
              <Input
                id="tl-issuer"
                placeholder="G…"
                value={issuer}
                onChange={(e) => setIssuer(e.target.value)}
                className="mt-1 font-mono text-xs"
              />
            </div>
          </div>

          {/* Signing key for actions */}
          {activeWallet ? (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Actions signed by:</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-green-500/30 bg-green-500/10 px-2.5 py-0.5 font-medium text-green-500">
                {activeWallet.name} · {shortAddr(activeWallet.publicKey)}
              </span>
            </div>
          ) : (
            <div>
              <Label htmlFor="tl-sk">Issuer Secret Key (for actions)</Label>
              <Input
                id="tl-sk"
                type="password"
                placeholder="S… (only needed to freeze/unfreeze)"
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
                className="mt-1 font-mono text-xs"
              />
            </div>
          )}

          <div className="flex gap-2">
            {!scanning ? (
              <Button onClick={handleScan} disabled={!canScan}>
                Scan Holders
              </Button>
            ) : (
              <Button variant="outline" onClick={handleStop}>
                Stop
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Activity log */}
      {logs.length > 0 && (
        <div
          ref={logBoxRef}
          onScroll={() => {
            const el = logBoxRef.current;
            if (!el) return;
            userScrolledUp.current =
              el.scrollTop < el.scrollHeight - el.clientHeight - 8;
          }}
          className="h-28 overflow-y-auto rounded border bg-muted/30 p-2 font-mono text-xs"
        >
          {logs.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
          <div ref={logEndRef} />
        </div>
      )}

      {/* Results */}
      {holders.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>
                  Holders
                  {scanning && (
                    <Loader2 className="ml-2 inline h-4 w-4 animate-spin" />
                  )}
                </CardTitle>
                <CardDescription className="mt-1 flex gap-3 text-xs">
                  <span className="text-green-500">{authorized} authorized</span>
                  {maintainOnly > 0 && (
                    <span className="text-amber-500">{maintainOnly} maintain only</span>
                  )}
                  {frozen > 0 && (
                    <span className="text-destructive">{frozen} frozen</span>
                  )}
                </CardDescription>
              </div>
              {scanDone && (
                <Button variant="outline" size="sm" onClick={handleExport}>
                  <Download className="mr-2 h-3.5 w-3.5" />
                  Export CSV
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="px-3 py-2 text-left">Holder</th>
                    <th className="px-3 py-2 text-right">Balance</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {holders.map((holder) => {
                    const isPending = pendingAddress === holder.address;
                    const result = actionResults[holder.address];
                    return (
                      <tr key={holder.address} className="border-b last:border-0">
                        <td className="px-3 py-2 text-xs">
                          <ShortAddress
                            address={holder.address}
                            network={settings.network}
                          />
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {parseFloat(holder.balance).toLocaleString(undefined, {
                            minimumFractionDigits: 0,
                            maximumFractionDigits: 7,
                          })}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLES[holder.status]}`}
                          >
                            {STATUS_LABELS[holder.status]}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-1.5">
                            {isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                            ) : (
                              <>
                                {holder.status !== "authorized" && (
                                  <button
                                    title="Authorize"
                                    onClick={() =>
                                      handleAction(holder.address, "authorize")
                                    }
                                    disabled={!effectiveSecretKey}
                                    className="inline-flex items-center gap-1 rounded border border-green-500/40 bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-500 hover:bg-green-500/20 disabled:opacity-40"
                                  >
                                    <LockOpen className="h-3 w-3" />
                                    Unfreeze
                                  </button>
                                )}
                                {holder.status !== "maintain_liabilities" && (
                                  <button
                                    title="Authorize to maintain liabilities only"
                                    onClick={() =>
                                      handleAction(holder.address, "maintain_only")
                                    }
                                    disabled={!effectiveSecretKey}
                                    className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-500 hover:bg-amber-500/20 disabled:opacity-40"
                                  >
                                    <Minus className="h-3 w-3" />
                                    Restrict
                                  </button>
                                )}
                                {holder.status !== "frozen" && (
                                  <button
                                    title="Freeze"
                                    onClick={() =>
                                      handleAction(holder.address, "freeze")
                                    }
                                    disabled={!effectiveSecretKey}
                                    className="inline-flex items-center gap-1 rounded border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive hover:bg-destructive/20 disabled:opacity-40"
                                  >
                                    <Lock className="h-3 w-3" />
                                    Freeze
                                  </button>
                                )}
                              </>
                            )}
                            {result && (
                              result.error ? (
                                <span className="text-[10px] text-destructive" title={result.error}>
                                  Error
                                </span>
                              ) : (
                                <a
                                  href={explorerBase ? `${explorerBase}/tx/${result.hash}` : "#"}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-0.5 text-[10px] text-green-500"
                                  title={result.hash}
                                >
                                  <CheckCircle2 className="h-3 w-3" />
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              )
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
