"use client";

import { useState } from "react";
import { Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTieredRewardConfigs } from "@/hooks/use-tiered-reward-configs";
import { useActiveWallet } from "@/hooks/use-active-wallet";
import { TierConfigCard } from "./TierConfigCard";

const INTERVALS = [
  { label: "Manual", value: "" },
  { label: "Every 1h", value: "60" },
  { label: "Every 3h", value: "180" },
  { label: "Every 6h", value: "360" },
  { label: "Every 12h", value: "720" },
  { label: "Every 24h", value: "1440" },
];

export function TieredRewardsPanel() {
  const { configs, isLoaded, createConfig, updateConfig, deleteConfig, upsertTier, deleteTier, upsertRewardAsset, deleteRewardAsset } = useTieredRewardConfigs();
  const { activeWallet } = useActiveWallet();

  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAssetCode, setNewAssetCode] = useState("");
  const [newAssetIssuer, setNewAssetIssuer] = useState("");
  const [newNetwork, setNewNetwork] = useState("public");
  const [newSecretKey, setNewSecretKey] = useState("");
  const [newInterval, setNewInterval] = useState("1440");
  const [createError, setCreateError] = useState<string | null>(null);

  const effectiveSecretKey = activeWallet?.secretKey ?? newSecretKey;

  function handleCreate() {
    if (!newName.trim()) { setCreateError("Name required"); return; }
    if (!newAssetCode.trim()) { setCreateError("Asset code required"); return; }
    if (!newAssetIssuer.trim()) { setCreateError("Asset issuer required"); return; }
    if (!effectiveSecretKey.trim()) { setCreateError("Sender secret key required"); return; }
    setCreateError(null);
    createConfig({
      name: newName.trim(),
      assetCode: newAssetCode.trim(),
      assetIssuer: newAssetIssuer.trim(),
      network: newNetwork,
      secretKey: effectiveSecretKey.trim(),
      intervalMinutes: newInterval ? parseInt(newInterval) : null,
      enabled: false,
      minReserve: 10.0,
      minSenderThreshold: 0,
      previewOnly: false,
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
              <Select value={newNetwork} onValueChange={setNewNetwork}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">Mainnet</SelectItem>
                  <SelectItem value="testnet">Testnet</SelectItem>
                  <SelectItem value="futurenet">Futurenet</SelectItem>
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
            <div>
              <Label className="text-xs">Schedule</Label>
              <Select value={newInterval} onValueChange={setNewInterval}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INTERVALS.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Sender Secret Key</Label>
              {activeWallet ? (
                <div className="flex items-center gap-2 h-10 px-3 rounded-md border border-green-700 bg-green-950 text-green-400 text-sm">
                  <span className="h-2 w-2 rounded-full bg-green-400 shrink-0" />
                  {activeWallet.name}
                </div>
              ) : (
                <Input type="password" placeholder="S..." value={newSecretKey} onChange={(e) => setNewSecretKey(e.target.value)} />
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
