"use client";

import { useState, useCallback, useEffect } from "react";
import { ChevronDown, ChevronRight, AlertTriangle, Loader2, Upload, Wallet, Eye, EyeOff, History, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TierBuilder } from "./TierBuilder";
import { TierPreviewModal } from "./TierPreviewModal";
import { WalletSelect } from "@/components/ui/wallet-select";
import { shortAddr } from "@/lib/format";
import { authHeaders, waitForAuth } from "@/lib/db-client";
import { useActiveWallet } from "@/hooks/use-active-wallet";
import type { TieredRewardConfig, Tier, RewardAsset, RewardsPreview, RunLogRow } from "@/lib/tiered-rewards/types";

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

const IMPORT_EXAMPLE = JSON.stringify([
  {
    minTokens: 100,
    maxTokens: 999,
    assets: [{ assetCode: "XLM", amount: 1 }],
  },
  {
    minTokens: 1000,
    maxTokens: 9999,
    assets: [{ assetCode: "XLM", amount: 5 }, { assetCode: "MYTOKEN", assetIssuer: "GABC...ISSUER", amount: 10 }],
  },
  {
    minTokens: 10000,
    assets: [{ assetCode: "XLM", amount: 20 }],
  },
], null, 2);

interface ImportTier {
  minTokens: number;
  maxTokens?: number;
  assets: Array<{ assetCode: string; assetIssuer?: string; amount: number }>;
}

function parseImportedTiers(raw: string): { tiers: ImportTier[]; error?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { tiers: [], error: "Invalid JSON — check syntax and try again" };
  }
  if (!Array.isArray(parsed)) return { tiers: [], error: "Expected a JSON array of tiers" };
  const tiers: ImportTier[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const t = parsed[i] as Record<string, unknown>;
    const min = typeof t.minTokens === "number" ? t.minTokens : parseFloat(String(t.minTokens));
    if (isNaN(min) || min < 0) return { tiers: [], error: `Tier ${i + 1}: minTokens must be a positive number` };
    const max = t.maxTokens !== undefined && t.maxTokens !== null
      ? (typeof t.maxTokens === "number" ? t.maxTokens : parseFloat(String(t.maxTokens)))
      : undefined;
    if (max !== undefined && (isNaN(max) || max <= min)) return { tiers: [], error: `Tier ${i + 1}: maxTokens must be greater than minTokens` };
    if (!Array.isArray(t.assets) || t.assets.length === 0) return { tiers: [], error: `Tier ${i + 1}: assets must be a non-empty array` };
    const assets: ImportTier["assets"] = [];
    for (let j = 0; j < t.assets.length; j++) {
      const a = t.assets[j] as Record<string, unknown>;
      const code = typeof a.assetCode === "string" ? a.assetCode.trim() : "";
      if (!code) return { tiers: [], error: `Tier ${i + 1}, asset ${j + 1}: assetCode required` };
      const amount = typeof a.amount === "number" ? a.amount : parseFloat(String(a.amount));
      if (isNaN(amount) || amount <= 0) return { tiers: [], error: `Tier ${i + 1}, asset ${j + 1}: amount must be > 0` };
      if (code !== "XLM" && !a.assetIssuer) return { tiers: [], error: `Tier ${i + 1}, asset ${j + 1}: assetIssuer required for non-XLM assets` };
      assets.push({ assetCode: code, assetIssuer: typeof a.assetIssuer === "string" ? a.assetIssuer : undefined, amount });
    }
    tiers.push({ minTokens: min, maxTokens: max, assets });
  }
  // overlap check
  for (let i = 0; i < tiers.length; i++) {
    for (let j = i + 1; j < tiers.length; j++) {
      const a = tiers[i], b = tiers[j];
      const aMax = a.maxTokens ?? Infinity;
      const bMax = b.maxTokens ?? Infinity;
      if (a.minTokens < bMax && aMax > b.minTokens) {
        return { tiers: [], error: `Tier ${i + 1} and Tier ${j + 1} ranges overlap — fix before importing` };
      }
    }
  }
  return { tiers };
}

export function TierConfigCard({ config, onUpdate, onDelete, onUpsertTier, onDeleteTier, onUpsertAsset, onDeleteAsset }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<RewardsPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);

  // Key editing
  const [editingKey, setEditingKey] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [showKey, setShowKey] = useState(false);

  // Import tiers
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<ImportTier[] | null>(null);

  // Settings / history tabs
  const [activeTab, setActiveTab] = useState<"tiers" | "settings" | "history">("tiers");
  const [history, setHistory] = useState<RunLogRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

  // Exclude addresses local edit
  const [excludeDraft, setExcludeDraft] = useState((config.excludeAddresses ?? []).join("\n"));

  const { activeWallet } = useActiveWallet();

  useEffect(() => {
    if (activeTab === "history" && expanded) {
      setHistoryLoading(true);
      waitForAuth().then(() =>
        fetch(`/api/tiered-rewards/history?configId=${config.id}`, { headers: authHeaders() })
          .then((r) => r.json())
          .then((d) => { setHistory(Array.isArray(d) ? d : []); })
          .catch(() => {})
          .finally(() => setHistoryLoading(false))
      );
    }
  }, [activeTab, expanded, config.id, historyRefreshKey]);

  const intervalLabel = config.intervalMinutes
    ? (INTERVAL_LABELS[config.intervalMinutes] ?? `every ${config.intervalMinutes}m`)
    : "manual";

  const effectiveKey = activeWallet?.secretKey ?? "";
  // hasKey is true if active wallet is connected OR a key is saved server-side
  const hasKey = !!effectiveKey || config.hasKey === true;

  const handlePreview = useCallback(async () => {
    setPreview(null); setPreviewError(null); setPreviewLoading(true); setPreviewOpen(true);
    try {
      await waitForAuth();
      const res = await fetch("/api/tiered-rewards/run", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
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
      await waitForAuth();
      const res = await fetch("/api/tiered-rewards/run", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ mode: "run", configId: config.id }),
      });
      const data = await res.json() as { error?: string };
      if (data.error) setPreviewError(data.error);
      else {
        setPreviewOpen(false);
        onUpdate(config.id, { lastRunAt: Date.now(), lastFailureAt: undefined });
        setHistoryRefreshKey((k) => k + 1);
      }
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Run failed");
    } finally {
      setExecuting(false);
    }
  }, [config.id, onUpdate]);

  const handleRunNow = useCallback(async () => {
    setPreview(null);
    setPreviewError(null);
    setPreviewOpen(true);
    setExecuting(true);
    try {
      await waitForAuth();
      const res = await fetch("/api/tiered-rewards/run", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ mode: "run", configId: config.id }),
      });
      const data = await res.json() as { error?: string };
      if (data.error) setPreviewError(data.error);
      else {
        setPreviewOpen(false);
        onUpdate(config.id, { lastRunAt: Date.now(), lastFailureAt: undefined });
        setHistoryRefreshKey((k) => k + 1);
      }
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Run failed");
    } finally {
      setExecuting(false);
    }
  }, [config.id, onUpdate]);

  function handleSaveKey() {
    const key = keyDraft.trim();
    onUpdate(config.id, { secretKey: key || null });
    setEditingKey(false);
    setKeyDraft("");
  }

  function handleImportValidate() {
    setImportError(null);
    const { tiers, error } = parseImportedTiers(importText);
    if (error) { setImportError(error); setImportPreview(null); return; }
    setImportPreview(tiers);
  }

  function handleImportConfirm() {
    if (!importPreview) return;
    // Delete existing tiers first
    for (const tier of config.tiers) {
      onDeleteTier(config.id, tier.id);
    }
    // Insert new tiers with pre-generated IDs so we can attach assets immediately
    importPreview.forEach((t, idx) => {
      const tierId = crypto.randomUUID();
      onUpsertTier(config.id, {
        id: tierId,
        tierNumber: idx + 1,
        minTokens: t.minTokens,
        maxTokens: t.maxTokens,
        position: idx,
      });
      t.assets.forEach((a) => {
        onUpsertAsset(config.id, tierId, {
          assetCode: a.assetCode,
          assetIssuer: a.assetIssuer,
          amount: a.amount,
        });
      });
    });
    setImportOpen(false);
    setImportText("");
    setImportPreview(null);
  }

  return (
    <>
      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center gap-3 p-4">
          <button onClick={() => setExpanded((v) => !v)} className="text-muted-foreground hover:text-foreground">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          <span className="font-medium text-foreground flex-1">{config.name}</span>
          {config.lastFailureAt && (
            <AlertTriangle className="h-4 w-4 text-destructive" aria-label="Last run had failures" />
          )}
          {!hasKey && (
            <span className="text-xs px-2 py-0.5 rounded-full border border-amber-700 bg-amber-950/40 text-amber-400">no key</span>
          )}
          <span className={`text-xs px-2 py-0.5 rounded-full border ${config.enabled ? "bg-green-950 text-green-400 border-green-800" : "bg-muted text-muted-foreground border-border"}`}>
            {config.enabled ? "\u25CF active" : "\u25CB paused"}
          </span>
          <span className="text-xs px-2 py-0.5 rounded-full border border-border text-muted-foreground bg-muted">
            {intervalLabel}
          </span>
          <div className="flex gap-2 ml-2">
            <Button variant="outline" size="sm" onClick={handlePreview}>Preview</Button>
            <Button size="sm" className="bg-purple-600 hover:bg-purple-700 text-white" onClick={handleRunNow} disabled={!hasKey}>Run Now</Button>
          </div>
        </div>

        {!expanded && (
          <div className="px-4 pb-3 text-xs text-muted-foreground pl-11">
            {config.assetCode}:{shortAddr(config.assetIssuer)} &middot; {config.tiers.length} tier{config.tiers.length !== 1 ? "s" : ""}
            {config.lastRunAt ? ` \u00B7 last run ${new Date(config.lastRunAt).toLocaleDateString()}` : ""}
          </div>
        )}

        {expanded && (
          <div className="border-t border-border">
            {/* Tab bar */}
            <div className="flex border-b border-border px-4">
              {(["tiers", "settings", "history"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors ${activeTab === tab ? "border-purple-500 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                >
                  {tab === "tiers" && <Upload className="h-3.5 w-3.5" />}
                  {tab === "settings" && <Settings2 className="h-3.5 w-3.5" />}
                  {tab === "history" && <History className="h-3.5 w-3.5" />}
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>

            <div className="p-4 space-y-5">
              {config.lastFailureAt && (
                <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0" />Last scheduled run had failures.
                </div>
              )}

              {/* ── TIERS TAB ── */}
              {activeTab === "tiers" && (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Tiers</p>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => { setImportOpen(true); setImportText(""); setImportError(null); setImportPreview(null); }}>
                      <Upload className="h-3.5 w-3.5" />Import JSON
                    </Button>
                  </div>
                  <TierBuilder
                    tiers={config.tiers}
                    onUpsertTier={(tier) => onUpsertTier(config.id, tier)}
                    onDeleteTier={(tierId) => onDeleteTier(config.id, tierId)}
                    onUpsertAsset={(tierId, asset) => onUpsertAsset(config.id, tierId, asset)}
                    onDeleteAsset={(tierId, assetId) => onDeleteAsset(config.id, tierId, assetId)}
                  />
                </>
              )}

              {/* ── SETTINGS TAB ── */}
              {activeTab === "settings" && (
                <div className="space-y-5">
                  {/* Schedule + enable */}
                  <div className="flex items-center gap-3">
                    <Switch checked={config.enabled} onCheckedChange={(v) => onUpdate(config.id, { enabled: v })} />
                    <span className="text-sm">{config.enabled ? "Scheduled" : "Manual only"}</span>
                  </div>

                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Tracked Asset</p>
                    <span className="font-mono text-sm bg-muted border border-border rounded px-2 py-1">
                      {config.assetCode} &middot; {shortAddr(config.assetIssuer)}
                    </span>
                  </div>

                  {/* Sender Key */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-muted-foreground uppercase tracking-wide">Sender Key</Label>
                      {!activeWallet && (
                        <WalletSelect
                          currentValue={""}
                          onPick={(w) => onUpdate(config.id, { secretKey: w.secretKey })}
                          onClear={() => onUpdate(config.id, { secretKey: null })}
                        />
                      )}
                    </div>
                    {activeWallet ? (
                      <div className="flex items-center gap-2 rounded-md border border-green-500/40 bg-green-500/5 px-3 py-2 text-sm">
                        <Wallet className="h-4 w-4 shrink-0 text-green-500" />
                        <span className="flex-1 truncate font-medium">{activeWallet.name}</span>
                        <span className="font-mono text-xs text-muted-foreground">{shortAddr(activeWallet.publicKey)}</span>
                      </div>
                    ) : editingKey ? (
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Input type={showKey ? "text" : "password"} placeholder="S… (leave blank to clear)" value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} autoFocus />
                          <button type="button" onClick={() => setShowKey((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                        <Button size="sm" onClick={handleSaveKey}>Save</Button>
                        <Button size="sm" variant="outline" onClick={() => { setEditingKey(false); setKeyDraft(""); setShowKey(false); }}>Cancel</Button>
                      </div>
                    ) : config.hasKey ? (
                      <div className="flex items-center gap-2">
                        <Input type="password" value="••••••••••••••••" readOnly className="flex-1 text-muted-foreground" />
                        <Button size="sm" variant="outline" onClick={() => { setEditingKey(true); setKeyDraft(""); }}>Change</Button>
                        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => onUpdate(config.id, { secretKey: null })}>Clear</Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Input type="password" placeholder="S…" className="flex-1" onFocus={() => setEditingKey(true)} readOnly />
                        <span className="text-xs text-amber-400 shrink-0">not set</span>
                      </div>
                    )}
                  </div>

                  {/* Memo */}
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground uppercase tracking-wide">Transaction Memo <span className="normal-case">(max 28 chars)</span></Label>
                    <Input
                      placeholder="Tier rewards — Season 1"
                      maxLength={28}
                      value={config.memo ?? ""}
                      onChange={(e) => onUpdate(config.id, { memo: e.target.value || null })}
                    />
                  </div>

                  {/* Batch vs Separate */}
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground uppercase tracking-wide">Payment Mode</Label>
                    <div className="flex gap-2">
                      {([true, false] as const).map((batch) => (
                        <button
                          key={String(batch)}
                          onClick={() => onUpdate(config.id, { batchSend: batch })}
                          className={`flex-1 rounded-md border px-3 py-2 text-sm transition-colors ${(config.batchSend ?? true) === batch ? "border-purple-500 bg-purple-500/10 text-foreground" : "border-border text-muted-foreground hover:border-muted-foreground"}`}
                        >
                          <div className="font-medium">{batch ? "Batch" : "Separate"}</div>
                          <div className="text-xs mt-0.5 opacity-70">{batch ? "100 ops/tx — cheaper fees" : "1 op/tx — safer, isolated"}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Fee Multiplier */}
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground uppercase tracking-wide">Fee Multiplier</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={1}
                        step={0.5}
                        className="w-28"
                        value={config.feeMultiplier ?? 1}
                        onChange={(e) => onUpdate(config.id, { feeMultiplier: Math.max(1, parseFloat(e.target.value) || 1) })}
                      />
                      <span className="text-xs text-muted-foreground">× base fee (100 stroops). Use &gt;1 during congestion.</span>
                    </div>
                  </div>

                  {/* Min Reserve */}
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground uppercase tracking-wide">Min Reserve (XLM)</Label>
                    <Input
                      type="number"
                      min={1}
                      className="w-28"
                      value={config.minReserve ?? 10}
                      onChange={(e) => onUpdate(config.id, { minReserve: Math.max(1, parseFloat(e.target.value) || 10) })}
                    />
                  </div>

                  {/* Exclude Addresses */}
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground uppercase tracking-wide">Exclude Addresses <span className="normal-case">(one per line)</span></Label>
                    <textarea
                      className="w-full rounded-md border border-border bg-background text-xs font-mono p-2 resize-y min-h-[72px]"
                      placeholder={"GABC...ISSUER\nGDEF...TEAM"}
                      value={excludeDraft}
                      onChange={(e) => setExcludeDraft(e.target.value)}
                      onBlur={() => {
                        const addrs = excludeDraft.split("\n").map((s) => s.trim()).filter(Boolean);
                        onUpdate(config.id, { excludeAddresses: addrs });
                      }}
                    />
                    <p className="text-xs text-muted-foreground">Issuer, team wallets, or any address to skip during distribution.</p>
                  </div>

                  {/* Preview-only toggle */}
                  <div className="flex items-center gap-3">
                    <Switch checked={config.previewOnly} onCheckedChange={(v) => onUpdate(config.id, { previewOnly: v })} />
                    <span className="text-sm">Preview-only mode <span className="text-xs text-muted-foreground">(simulate without sending)</span></span>
                  </div>

                  <div className="pt-2 border-t border-border flex justify-end">
                    <Button variant="destructive" size="sm" onClick={() => { if (confirm(`Delete "${config.name}"?`)) onDelete(config.id); }}>
                      Delete Config
                    </Button>
                  </div>
                </div>
              )}

              {/* ── HISTORY TAB ── */}
              {activeTab === "history" && (
                <div>
                  {historyLoading ? (
                    <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
                      <Loader2 className="h-4 w-4 animate-spin" />Loading history...
                    </div>
                  ) : history.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">No runs recorded yet.</p>
                  ) : (
                    <div className="space-y-1">
                      <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-x-3 text-xs text-muted-foreground uppercase tracking-wide px-1 pb-1">
                        <span>Tier</span><span>Address</span><span>Asset</span><span>Amount</span><span>Status</span>
                      </div>
                      {history.slice(0, 100).map((row) => (
                        <div key={row.id} className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-x-3 text-xs px-1 py-0.5 rounded hover:bg-muted/40">
                          <span className="text-purple-400 font-medium">T{row.tierNumber}</span>
                          <span className="font-mono text-muted-foreground truncate">{shortAddr(row.holderAddress)}</span>
                          <span className="text-muted-foreground">{row.assetCode}</span>
                          <span className="font-mono">{row.amountSent > 0 ? row.amountSent.toFixed(2) : "—"}</span>
                          <span className={`font-medium ${row.status === "sent" ? "text-green-400" : row.status === "skipped" ? "text-amber-400" : "text-destructive"}`}>
                            {row.status}
                          </span>
                        </div>
                      ))}
                      {history.length > 100 && <p className="text-xs text-muted-foreground text-center pt-1">Showing last 100 of {history.length} entries</p>}
                    </div>
                  )}
                </div>
              )}
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
        onExclude={(addrs) => {
          const merged = [...new Set([...(config.excludeAddresses ?? []), ...addrs])];
          onUpdate(config.id, { excludeAddresses: merged });
          setExcludeDraft(merged.join("\n"));
        }}
      />

      {/* Import Tiers Dialog */}
      <Dialog open={importOpen} onOpenChange={(v) => { if (!v) setImportOpen(false); }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import Tiers from JSON</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Expected structure</p>
              <pre className="text-xs text-muted-foreground font-mono whitespace-pre-wrap">{IMPORT_EXAMPLE}</pre>
            </div>
            <div>
              <Label className="text-xs">Paste your tier JSON</Label>
              <textarea
                className="w-full mt-1 rounded-md border border-border bg-background text-sm font-mono p-3 resize-y min-h-[160px]"
                placeholder="Paste JSON array here..."
                value={importText}
                onChange={(e) => { setImportText(e.target.value); setImportPreview(null); setImportError(null); }}
              />
            </div>
            {importError && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">{importError}</div>
            )}
            {importPreview && (
              <div className="rounded-lg border border-green-700/50 bg-green-950/20 p-3 space-y-2">
                <p className="text-xs text-green-400 font-medium">✓ Valid — {importPreview.length} tier{importPreview.length !== 1 ? "s" : ""} ready to import</p>
                {importPreview.map((t, i) => (
                  <div key={i} className="text-xs text-muted-foreground">
                    Tier {i + 1}: {t.minTokens.toLocaleString()}–{t.maxTokens != null ? t.maxTokens.toLocaleString() : "∞"} tokens
                    &nbsp;→&nbsp;{t.assets.map((a) => `${a.amount} ${a.assetCode}`).join(", ")}
                  </div>
                ))}
                {config.tiers.length > 0 && (
                  <p className="text-xs text-amber-400 mt-1">⚠ This will replace the {config.tiers.length} existing tier{config.tiers.length !== 1 ? "s" : ""}.</p>
                )}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setImportOpen(false)}>Cancel</Button>
              {!importPreview ? (
                <Button onClick={handleImportValidate} disabled={!importText.trim()}>Validate</Button>
              ) : (
                <Button className="bg-purple-600 hover:bg-purple-700 text-white" onClick={handleImportConfirm}>Import & Replace</Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
