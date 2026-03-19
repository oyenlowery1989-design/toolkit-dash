"use client";

import { useState, useCallback } from "react";
import { ChevronDown, ChevronRight, AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TierBuilder } from "./TierBuilder";
import { TierPreviewModal } from "./TierPreviewModal";
import { shortAddr } from "@/lib/format";
import type { TieredRewardConfig, Tier, RewardAsset, RewardsPreview } from "@/lib/tiered-rewards/types";

interface Props {
  config: TieredRewardConfig;
  onUpdate: (id: string, updates: Partial<TieredRewardConfig>) => void;
  onDelete: (id: string) => void;
  onUpsertTier: (configId: string, tier: Omit<Tier, "id" | "configId" | "assets"> & { id?: string }) => void;
  onDeleteTier: (configId: string, tierId: string) => void;
  onUpsertAsset: (configId: string, tierId: string, asset: Omit<RewardAsset, "id" | "tierId"> & { id?: string }) => void;
  onDeleteAsset: (configId: string, tierId: string, assetId: string) => void;
}

const INTERVAL_LABELS: Record<number, string> = {
  60: "every 1h", 180: "every 3h", 360: "every 6h", 720: "every 12h", 1440: "every 24h",
};

export function TierConfigCard({ config, onUpdate, onDelete, onUpsertTier, onDeleteTier, onUpsertAsset, onDeleteAsset }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<RewardsPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);

  const intervalLabel = config.intervalMinutes
    ? (INTERVAL_LABELS[config.intervalMinutes] ?? `every ${config.intervalMinutes}m`)
    : "manual";

  const handlePreview = useCallback(async () => {
    setPreview(null); setPreviewError(null); setPreviewLoading(true); setPreviewOpen(true);
    try {
      const res = await fetch("/api/tiered-rewards/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "preview", configId: config.id }),
      });
      const data = await res.json() as RewardsPreview | { error: string };
      if ("error" in data) setPreviewError(data.error);
      else setPreview(data);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setPreviewLoading(false);
    }
  }, [config.id]);

  const handleExecute = useCallback(async () => {
    setExecuting(true);
    try {
      const res = await fetch("/api/tiered-rewards/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "run", configId: config.id }),
      });
      const data = await res.json() as { error?: string };
      if (data.error) setPreviewError(data.error);
      else {
        setPreviewOpen(false);
        onUpdate(config.id, { lastRunAt: Date.now(), lastFailureAt: undefined });
      }
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Run failed");
    } finally {
      setExecuting(false);
    }
  }, [config.id, onUpdate]);

  return (
    <>
      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center gap-3 p-4">
          <button onClick={() => setExpanded((v) => !v)} className="text-muted-foreground hover:text-foreground">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          <span className="font-medium text-foreground flex-1">{config.name}</span>
          {config.lastFailureAt && (
            <AlertTriangle className="h-4 w-4 text-destructive" title="Last run had failures" />
          )}
          <span className={`text-xs px-2 py-0.5 rounded-full border ${config.enabled ? "bg-green-950 text-green-400 border-green-800" : "bg-muted text-muted-foreground border-border"}`}>
            {config.enabled ? "\u25CF active" : "\u25CB paused"}
          </span>
          <span className="text-xs px-2 py-0.5 rounded-full border border-border text-muted-foreground bg-muted">
            {intervalLabel}
          </span>
          <div className="flex gap-2 ml-2">
            <Button variant="outline" size="sm" onClick={handlePreview}>Preview</Button>
            <Button size="sm" className="bg-purple-600 hover:bg-purple-700 text-white" onClick={handlePreview}>Run Now</Button>
          </div>
        </div>

        {!expanded && (
          <div className="px-4 pb-3 text-xs text-muted-foreground pl-11">
            {config.assetCode}:{shortAddr(config.assetIssuer)} &middot; {config.tiers.length} tier{config.tiers.length !== 1 ? "s" : ""}
            {config.lastRunAt ? ` \u00B7 last run ${new Date(config.lastRunAt).toLocaleDateString()}` : ""}
          </div>
        )}

        {expanded && (
          <div className="border-t border-border p-4 space-y-5">
            {config.lastFailureAt && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                Last scheduled run had failures.
              </div>
            )}

            <div className="flex items-center gap-3">
              <Switch
                checked={config.enabled}
                onCheckedChange={(v) => onUpdate(config.id, { enabled: v })}
              />
              <span className="text-sm">{config.enabled ? "Scheduled" : "Manual only"}</span>
            </div>

            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Tracked Asset</p>
              <span className="font-mono text-sm bg-muted border border-border rounded px-2 py-1">
                {config.assetCode} &middot; {shortAddr(config.assetIssuer)}
              </span>
            </div>

            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Tiers</p>
              <TierBuilder
                tiers={config.tiers}
                onUpsertTier={(tier) => onUpsertTier(config.id, tier)}
                onDeleteTier={(tierId) => onDeleteTier(config.id, tierId)}
                onUpsertAsset={(tierId, asset) => onUpsertAsset(config.id, tierId, asset)}
                onDeleteAsset={(tierId, assetId) => onDeleteAsset(config.id, tierId, assetId)}
              />
            </div>

            <div className="pt-2 border-t border-border flex justify-end">
              <Button variant="destructive" size="sm" onClick={() => { if (confirm(`Delete "${config.name}"?`)) onDelete(config.id); }}>
                Delete Config
              </Button>
            </div>
          </div>
        )}
      </div>

      <TierPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        preview={preview}
        loading={previewLoading}
        error={previewError}
        onExecute={handleExecute}
        executing={executing}
      />
    </>
  );
}
