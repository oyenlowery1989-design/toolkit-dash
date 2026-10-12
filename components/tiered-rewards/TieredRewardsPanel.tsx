"use client";

import { useState, useEffect, useRef } from "react";
import { Plus, Loader2, Wallet, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { WalletSelect } from "@/components/ui/wallet-select";
import { useTieredRewardConfigs } from "@/hooks/use-tiered-reward-configs";
import { useActiveWallet } from "@/hooks/use-active-wallet";
import { useSettings } from "@/lib/settings";
import { shortAddr } from "@/lib/format";
import { authHeaders, waitForAuth } from "@/lib/db-client";
import { TierConfigCard } from "./TierConfigCard";

const INTERVALS = [
  { label: "Manual", value: "manual" },
  { label: "Every 15m", value: "15" },
  { label: "Every 30m", value: "30" },
  { label: "Every 1h", value: "60" },
  { label: "Every 3h", value: "180" },
  { label: "Every 6h", value: "360" },
  { label: "Every 12h", value: "720" },
  { label: "Every 24h", value: "1440" },
];

export function TieredRewardsPanel() {
  const { configs, isLoaded, createConfig, updateConfig, deleteConfig, upsertTier, deleteTier, upsertRewardAsset, deleteRewardAsset } = useTieredRewardConfigs();
  const { activeWallet, connect } = useActiveWallet();
  const { settings } = useSettings();

  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAssetCode, setNewAssetCode] = useState("");
  const [newAssetIssuer, setNewAssetIssuer] = useState("");
  const [newNetwork, setNewNetwork] = useState<string>(settings.network ?? "public");
  const [newSecretKey, setNewSecretKey] = useState("");
  const [newInterval, setNewInterval] = useState("1440");
  const [isServerless, setIsServerless] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const newNetworkTouchedRef = useRef(false);

  // Re-sync default network when settings hydrate later, unless the user already picked one.
  useEffect(() => {
    if (!newNetworkTouchedRef.current) {
      setNewNetwork(settings.network ?? "public");
    }
  }, [settings.network]);

  useEffect(() => {
    waitForAuth().then(() => fetch("/api/tiered-rewards/scheduler-status", { headers: authHeaders() }))
      .then((response) => response.json())
      .then((data: { serverless: boolean }) => setIsServerless(data.serverless))
      .catch(() => {});
  }, []);

  const effectiveSecretKey = activeWallet ? "" : newSecretKey;

  function handleCreate() {
    if (!newName.trim()) { setCreateError("Name required"); return; }
    if (!newAssetCode.trim()) { setCreateError("Asset code required"); return; }
    if (!newAssetIssuer.trim()) { setCreateError("Asset issuer required"); return; }
    setCreateError(null);
    createConfig({
      name: newName.trim(),
      assetCode: newAssetCode.trim(),
      assetIssuer: newAssetIssuer.trim(),
      network: newNetwork,
      secretKey: effectiveSecretKey.trim() || null,
      walletId: activeWallet?.id ?? null,
      intervalMinutes: !isServerless && newInterval !== "manual" ? parseInt(newInterval) : null,
      enabled: false,
      minReserve: 10.0,
      minSenderThreshold: 0,
      previewOnly: !activeWallet && !effectiveSecretKey.trim(),
      batchSend: true,
      memo: null,
      feeMultiplier: 1.0,
      excludeAddresses: [],
    });
    setNewName(""); setNewAssetCode(""); setNewAssetIssuer(""); setNewSecretKey(""); setShowNew(false);
  }

  if (!isLoaded) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-16 justify-center">
        <Loader2 className="h-4 w-4 animate-spin" />Loading...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {isServerless && (
        <div className="flex items-center gap-2 rounded-lg border border-yellow-500/20 bg-yellow-500/10 px-4 py-2.5 text-xs text-yellow-500">
          <AlertTriangle className="h-4 w-4 shrink-0" />Scheduled rewards are unavailable on this deployment. Use Run Now for manual sends.
        </div>
      )}
      <div className="flex items-center justify-between">
        <Button onClick={() => setShowNew((v) => !v)}>
          <Plus className="h-4 w-4 mr-1" />New Config
        </Button>
        <span className="text-xs text-muted-foreground">
          {configs.length} config{configs.length !== 1 ? "s" : ""} &middot; {configs.filter((c) => c.enabled).length} active
        </span>
      </div>

      {showNew && (
        <div className="rounded-xl border border-border p-4 space-y-3 bg-card">
          <p className="font-medium text-sm">New Reward Config</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Config Name</Label>
              <Input placeholder="MYTOKEN Tier Rewards" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Network</Label>
              <Select value={newNetwork} onValueChange={(v) => { newNetworkTouchedRef.current = true; setNewNetwork(v); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">Mainnet</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Asset Code (to scan)</Label>
              <Input placeholder="MYTOKEN" value={newAssetCode} onChange={(e) => setNewAssetCode(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Asset Issuer</Label>
              <Input placeholder="GABC..." value={newAssetIssuer} onChange={(e) => setNewAssetIssuer(e.target.value)} />
            </div>
            {!isServerless && <div>
              <Label className="text-xs">Schedule</Label>
              <Select value={newInterval} onValueChange={setNewInterval}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INTERVALS.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Sender Secret Key <span className="text-muted-foreground">(optional)</span></Label>
                {!activeWallet && (
                  <WalletSelect
                    currentValue={newSecretKey}
                    onPick={(w) => connect(w.id)}
                    onClear={() => setNewSecretKey("")}
                  />
                )}
              </div>
              {activeWallet ? (
                <div className="flex items-center gap-2 rounded-md border border-green-500/40 bg-green-500/5 px-3 py-2 text-sm">
                  <Wallet className="h-4 w-4 shrink-0 text-green-500" />
                  <span className="flex-1 truncate font-medium">{activeWallet.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{shortAddr(activeWallet.publicKey)}</span>
                </div>
              ) : (
                <Input type="password" placeholder="S… (can be added later)" value={newSecretKey} onChange={(e) => setNewSecretKey(e.target.value)} />
              )}
            </div>
          </div>
          {createError && <p className="text-xs text-destructive">{createError}</p>}
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setShowNew(false)}>Cancel</Button>
            <Button onClick={handleCreate}>Create Config</Button>
          </div>
        </div>
      )}

      {configs.length === 0 && !showNew && (
        <div className="text-center text-muted-foreground py-16 text-sm">
          No reward configs yet. Create one to get started.
        </div>
      )}
      {configs.map((config) => (
        <TierConfigCard
          key={config.id}
          config={config}
          isServerless={isServerless}
          onUpdate={updateConfig}
          onDelete={deleteConfig}
          onUpsertTier={upsertTier}
          onDeleteTier={deleteTier}
          onUpsertAsset={upsertRewardAsset}
          onDeleteAsset={deleteRewardAsset}
        />
      ))}
    </div>
  );
}
