"use client";

import { useState } from "react";
import { Plus, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Tier, RewardAsset } from "@/lib/tiered-rewards/types";

interface Props {
  tiers: Tier[];
  onUpsertTier: (tier: Omit<Tier, "id" | "configId" | "assets"> & { id?: string }) => void;
  onDeleteTier: (tierId: string) => void;
  onUpsertAsset: (tierId: string, asset: Omit<RewardAsset, "id" | "tierId"> & { id?: string }) => void;
  onDeleteAsset: (tierId: string, assetId: string) => void;
}

function detectOverlap(tiers: Tier[], excludeId?: string): string | null {
  const active = tiers.filter((t) => t.id !== excludeId);
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i], b = active[j];
      const aMax = a.maxTokens ?? Infinity;
      const bMax = b.maxTokens ?? Infinity;
      if (a.minTokens < bMax && aMax > b.minTokens) {
        return `Tier ${a.tierNumber} and Tier ${b.tierNumber} ranges overlap`;
      }
    }
  }
  return null;
}

export function TierBuilder({ tiers, onUpsertTier, onDeleteTier, onUpsertAsset, onDeleteAsset }: Props) {
  const sorted = [...tiers].sort((a, b) => a.position - b.position);
  const [expandedTier, setExpandedTier] = useState<string | null>(null);
  const [newMin, setNewMin] = useState("");
  const [newMax, setNewMax] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  function handleAddTier() {
    const min = parseFloat(newMin);
    if (isNaN(min) || min < 0) { setAddError("Min tokens must be a positive number"); return; }
    const max = newMax.trim() === "" ? undefined : parseFloat(newMax);
    if (newMax.trim() !== "" && (isNaN(max!) || max! <= min)) {
      setAddError("Max must be greater than min (or leave empty for open-ended top tier)");
      return;
    }
    const candidate: Tier = { id: "candidate", configId: "", tierNumber: sorted.length + 1, minTokens: min, maxTokens: max, position: sorted.length, assets: [] };
    const overlap = detectOverlap([...tiers, candidate], "candidate");
    if (overlap) { setAddError(overlap); return; }
    onUpsertTier({ tierNumber: sorted.length + 1, minTokens: min, maxTokens: max, position: sorted.length });
    setNewMin(""); setNewMax(""); setAddError(null);
  }

  return (
    <div className="space-y-3">
      {sorted.map((tier) => (
        <div key={tier.id} className="rounded-lg border border-border bg-muted/30">
          <div className="flex items-center gap-3 p-3">
            <span className="text-xs font-semibold text-purple-400 uppercase tracking-wide w-14">Tier {tier.tierNumber}</span>
            <span className="text-sm text-foreground flex-1">
              {tier.minTokens.toLocaleString()} &ndash; {tier.maxTokens != null ? tier.maxTokens.toLocaleString() : "\u221E"} tokens
            </span>
            <span className="text-xs text-muted-foreground">{tier.assets.length} asset{tier.assets.length !== 1 ? "s" : ""}</span>
            <Button variant="ghost" size="sm" onClick={() => setExpandedTier(expandedTier === tier.id ? null : tier.id)}>
              {expandedTier === tier.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => onDeleteTier(tier.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          {expandedTier === tier.id && (
            <div className="border-t border-border p-3 space-y-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Reward Assets</p>
              {tier.assets.map((asset) => (
                <div key={asset.id} className="flex items-center gap-2 text-sm">
                  <span className="font-mono text-foreground">{asset.amount.toFixed(7)}</span>
                  <span className="text-muted-foreground">{asset.assetCode}{asset.assetIssuer ? `:${asset.assetIssuer.slice(0, 4)}\u2026` : ""}</span>
                  <Button variant="ghost" size="sm" className="ml-auto text-destructive hover:text-destructive h-6 w-6 p-0" onClick={() => onDeleteAsset(tier.id, asset.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              <AddAssetRow tierId={tier.id} onAdd={onUpsertAsset} />
            </div>
          )}
        </div>
      ))}
      <div className="rounded-lg border border-dashed border-border p-3 space-y-2">
        <p className="text-xs text-muted-foreground uppercase tracking-wide">Add Tier</p>
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <Label className="text-xs">Min tokens</Label>
            <Input className="h-8" placeholder="100" value={newMin} onChange={(e) => setNewMin(e.target.value)} />
          </div>
          <div className="flex-1">
            <Label className="text-xs">Max tokens (empty = open)</Label>
            <Input className="h-8" placeholder="299" value={newMax} onChange={(e) => setNewMax(e.target.value)} />
          </div>
          <Button size="sm" onClick={handleAddTier}><Plus className="h-3.5 w-3.5 mr-1" />Add</Button>
        </div>
        {addError && <p className="text-xs text-destructive">{addError}</p>}
      </div>
    </div>
  );
}

function AddAssetRow({ tierId, onAdd }: { tierId: string; onAdd: Props["onUpsertAsset"] }) {
  const [code, setCode] = useState("");
  const [issuer, setIssuer] = useState("");
  const [amount, setAmount] = useState("");
  const [err, setErr] = useState<string | null>(null);

  function handleAdd() {
    const assetCode = code.trim().toUpperCase();
    if (!assetCode) { setErr("Asset code required"); return; }
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) { setErr("Amount must be > 0"); return; }
    if (assetCode !== "XLM" && !issuer.trim()) { setErr("Issuer required for non-XLM assets"); return; }
    onAdd(tierId, { assetCode, assetIssuer: assetCode === "XLM" ? undefined : issuer.trim(), amount: amt });
    setCode(""); setIssuer(""); setAmount(""); setErr(null);
  }

  return (
    <div className="space-y-1 pt-1">
      <div className="flex gap-2 items-end">
        <div>
          <Label className="text-xs">Code</Label>
          <Input className="h-7 w-20" placeholder="XLM" value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
        <div className="flex-1">
          <Label className="text-xs">Issuer (blank for XLM)</Label>
          <Input className="h-7" placeholder="GXXX\u2026" value={issuer} onChange={(e) => setIssuer(e.target.value)} />
        </div>
        <div className="w-28">
          <Label className="text-xs">Amount / holder</Label>
          <Input className="h-7" placeholder="10" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <Button size="sm" variant="outline" className="h-7" onClick={handleAdd}><Plus className="h-3 w-3" /></Button>
      </div>
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
