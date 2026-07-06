"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { authHeaders } from "@/lib/db-client";
import { useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  FileCode2,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { StrKey, Keypair } from "stellar-sdk";
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
import { useSettings } from "@/lib/settings";
import { useAssetGroups } from "@/hooks/use-asset-groups";
import { useActiveWallet } from "@/hooks/use-active-wallet";
import { useAutoSaveSigningKey } from "@/hooks/use-auto-save-signing-key";
import { WalletSelect } from "@/components/ui/wallet-select";
import { shortAddr } from "@/lib/format";
import { computeSacAddress } from "@/lib/soroban/sac";

type DeployStatus = "unknown" | "checking" | "deployed" | "not_deployed" | "error";

export function SorobanPanel() {
  const { settings } = useSettings();
  const { groups } = useAssetGroups();
  const { activeWallet } = useActiveWallet();
  const { autoSave: autoSaveSigningKey } = useAutoSaveSigningKey();
  const searchParams = useSearchParams();

  // Asset input — pre-fill from URL params if present
  const [assetCode, setAssetCode] = useState(() => searchParams.get("assetCode") ?? "");
  const [issuer, setIssuer] = useState(() => searchParams.get("issuer") ?? "");
  const [secretKey, setSecretKey] = useState("");

  // Status
  const [deployStatus, setDeployStatus] = useState<DeployStatus>("unknown");
  const [statusError, setStatusError] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [deployResult, setDeployResult] = useState<{
    contractId: string;
    txHash: string;
  } | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const logBoxRef = useRef<HTMLDivElement | null>(null);
  const userScrolledUp = useRef(false);

  // Derived: is the asset input valid enough to compute SAC address?
  const canCompute = useMemo(() => {
    const code = assetCode.trim();
    const iss = issuer.trim();
    if (!code) return false;
    if (code.toUpperCase() === "XLM") return true;
    return StrKey.isValidEd25519PublicKey(iss);
  }, [assetCode, issuer]);

  // Computed contract ID (instant, no network call)
  const contractId = useMemo(() => {
    if (!canCompute) return null;
    try {
      return computeSacAddress(assetCode.trim(), issuer.trim(), settings.network);
    } catch {
      return null;
    }
  }, [canCompute, assetCode, issuer, settings.network]);

  // Reset status when inputs change
  useEffect(() => {
    setDeployStatus("unknown");
    setStatusError(null);
    setDeployResult(null);
    setDeployError(null);
    setLogs([]);

    if (!contractId) return;
    // Auto-check deployment status whenever contractId changes
    let cancelled = false;
    fetch("/api/soroban/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contractId, network: settings.network }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.deployed !== undefined) {
          setDeployStatus(data.deployed ? "deployed" : "not_deployed");
        }
      })
      .catch(() => {
        if (!cancelled) setDeployStatus("unknown");
      });
    return () => { cancelled = true; };
  }, [contractId, settings.network]);

  // Auto-scroll log to bottom unless user scrolled up
  useEffect(() => {
    if (!userScrolledUp.current) {
      logEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  function onLog(msg: string) {
    setLogs((prev) => [...prev, msg]);
  }

  // Load asset from an Asset Group
  function handleLoadFromGroup(groupId: string) {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    if (group.assetCode) setAssetCode(group.assetCode);
    if (group.issuer) setIssuer(group.issuer);
  }

  async function handleCheckStatus() {
    if (!contractId) return;
    setDeployStatus("checking");
    setStatusError(null);
    try {
      const res = await fetch("/api/soroban/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractId, network: settings.network }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Check failed");
      setDeployStatus(data.deployed ? "deployed" : "not_deployed");
    } catch (e) {
      setDeployStatus("error");
      setStatusError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleDeploy() {
    if (!contractId) return;
    const effectiveSecretKey = activeWallet?.secretKey ?? secretKey.trim();
    if (!effectiveSecretKey) return;

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setDeploying(true);
    setDeployError(null);
    setDeployResult(null);
    setLogs([]);
    userScrolledUp.current = false;

    try {
      onLog("Submitting deployment request…");
      const res = await fetch("/api/soroban/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        signal: abortRef.current.signal,
        body: JSON.stringify({
          assetCode: assetCode.trim(),
          issuer: issuer.trim(),
          secretKey: effectiveSecretKey,
          network: settings.network,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Deploy failed");
      // replay server-side logs
      for (const line of data.logs ?? []) onLog(line);
      setDeployResult({ contractId: data.contractId, txHash: data.txHash });
      setDeployStatus("deployed");
      if (!activeWallet) {
        try { autoSaveSigningKey(Keypair.fromSecret(effectiveSecretKey).publicKey()); } catch { /* invalid key */ }
      }
    } catch (e) {
      if (!abortRef.current?.signal.aborted) {
        setDeployError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setDeploying(false);
    }
  }

  function handleCancel() {
    abortRef.current?.abort();
    setDeploying(false);
    onLog("Canceled.");
  }

  function handleCopy() {
    if (!contractId) return;
    navigator.clipboard.writeText(contractId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const explorerBase =
    settings.network === "public"
      ? "https://stellar.expert/explorer/public"
      : settings.network === "testnet"
        ? "https://stellar.expert/explorer/testnet"
        : null;

  const effectiveSecretKey = activeWallet?.secretKey ?? secretKey.trim();
  const canDeploy =
    !!contractId &&
    !!effectiveSecretKey &&
    deployStatus === "not_deployed" &&
    !deploying;

  return (
    <div className="space-y-6">
      {/* Asset Input */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileCode2 className="h-5 w-5" />
            Asset
          </CardTitle>
          <CardDescription>
            Enter your existing classic Stellar asset. The SAC address is
            computed instantly — no transaction required.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Load from group */}
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
              <Label htmlFor="asset-code">Asset Code</Label>
              <Input
                id="asset-code"
                placeholder="e.g. MYTOKEN"
                value={assetCode}
                onChange={(e) => setAssetCode(e.target.value)}
                className="mt-1 font-mono"
              />
            </div>
            <div>
              <Label htmlFor="issuer">Issuer Address</Label>
              <Input
                id="issuer"
                placeholder="G…"
                value={issuer}
                onChange={(e) => setIssuer(e.target.value)}
                className="mt-1 font-mono text-xs"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* SAC Address */}
      {contractId && (
        <Card>
          <CardHeader>
            <CardTitle>SAC Contract Address</CardTitle>
            <CardDescription>
              Deterministic — computed from your asset code, issuer, and
              network. This address is permanent and unique to your asset.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
              <code className="flex-1 break-all font-mono text-sm">
                {contractId}
              </code>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 shrink-0"
                onClick={handleCopy}
              >
                {copied ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
              {explorerBase && (
                <a
                  href={`${explorerBase}/contract/${contractId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}
            </div>

            {/* Deployment status */}
            <div className="flex items-center gap-3">
              {deployStatus === "unknown" && (
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Checking…
                </span>
              )}
              {deployStatus === "checking" && (
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Checking…
                </span>
              )}
              {deployStatus === "deployed" && (
                <span className="flex items-center gap-2 text-sm text-green-500">
                  <CheckCircle2 className="h-4 w-4" />
                  Already deployed on {settings.network}
                </span>
              )}
              {deployStatus === "not_deployed" && (
                <span className="flex items-center gap-2 text-sm text-amber-500">
                  <XCircle className="h-4 w-4" />
                  Not yet deployed on {settings.network}
                </span>
              )}
              {deployStatus === "error" && (
                <span className="text-sm text-destructive">
                  {statusError ?? "Status check failed"}
                </span>
              )}
              {deployStatus !== "checking" && (
                <Button variant="ghost" size="sm" onClick={handleCheckStatus} className="ml-auto">
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                  Recheck
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Deploy */}
      {contractId && deployStatus === "not_deployed" && (
        <Card>
          <CardHeader>
            <CardTitle>Deploy SAC</CardTitle>
            <CardDescription className="space-y-1">
              <span className="block">One transaction, ~0.1 XLM in fees. Permanent — only needs to happen once per asset.</span>
              <span className="block font-medium text-foreground/80">Who should sign?</span>
              <span className="block">• <span className="font-medium">Issuer</span> — most common. You own the asset and want it DeFi-ready.</span>
              <span className="block">• <span className="font-medium">Developer / integrator</span> — you're building a dApp that needs this asset's SAC and the issuer hasn't deployed it yet.</span>
              <span className="block">• <span className="font-medium">Anyone</span> — the SAC is permissionless. Whoever signs just pays the fee; they gain no control over the asset.</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Wallet or secret key */}
            {activeWallet ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  Signing with:
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-green-500/30 bg-green-500/10 px-2.5 py-0.5 text-xs font-medium text-green-500">
                  {activeWallet.name} · {shortAddr(activeWallet.publicKey)}
                </span>
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label htmlFor="secret-key">Secret Key (payer)</Label>
                  <WalletSelect
                    currentValue={secretKey}
                    onPick={(w) => setSecretKey(w.secretKey)}
                  />
                </div>
                <Input
                  id="secret-key"
                  type="password"
                  placeholder="S…"
                  value={secretKey}
                  onChange={(e) => setSecretKey(e.target.value)}
                  className="font-mono text-xs"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Pays the ~0.1 XLM fee. Any funded account — does not need to be the issuer.
                </p>
              </div>
            )}

            <div className="flex gap-2">
              {!deploying ? (
                <Button onClick={handleDeploy} disabled={!canDeploy}>
                  Deploy SAC
                </Button>
              ) : (
                <Button variant="outline" onClick={handleCancel}>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Cancel
                </Button>
              )}
            </div>

            {deployError && (
              <p className="text-sm text-destructive">{deployError}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Activity log */}
      {logs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Activity Log</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              ref={logBoxRef}
              onScroll={() => {
                const el = logBoxRef.current;
                if (!el) return;
                userScrolledUp.current =
                  el.scrollTop < el.scrollHeight - el.clientHeight - 8;
              }}
              className="h-40 overflow-y-auto rounded border bg-muted/30 p-2 font-mono text-xs"
            >
              {logs.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
              <div ref={logEndRef} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Success result */}
      {deployResult && (
        <Card className="border-green-500/30 bg-green-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-500">
              <CheckCircle2 className="h-5 w-5" />
              SAC Deployed
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <span className="text-muted-foreground">Contract ID:</span>
              <code className="ml-2 break-all font-mono">
                {deployResult.contractId}
              </code>
            </div>
            <div>
              <span className="text-muted-foreground">TX Hash:</span>
              <code className="ml-2 break-all font-mono text-xs">
                {deployResult.txHash}
              </code>
            </div>
            {explorerBase && (
              <div className="flex gap-3">
                <a
                  href={`${explorerBase}/contract/${deployResult.contractId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  View contract on Stellar.Expert
                  <ExternalLink className="h-3 w-3" />
                </a>
                <a
                  href={`${explorerBase}/tx/${deployResult.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
                >
                  View transaction
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
