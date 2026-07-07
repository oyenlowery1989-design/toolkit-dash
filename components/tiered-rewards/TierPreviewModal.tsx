"use client";

import { useState, useEffect } from "react";
import { AlertTriangle, CheckCircle2, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { shortAddr } from "@/lib/format";
import type { RewardsPreview } from "@/lib/tiered-rewards/types";

interface Props {
  open: boolean;
  onClose: () => void;
  preview: RewardsPreview | null;
  loading: boolean;
  error: string | null;
  onExecute: () => void;
  executing: boolean;
  onExclude?: (addresses: string[]) => void; // save excluded addresses to config
}

export function TierPreviewModal({ open, onClose, preview, loading, error, onExecute, executing, onExclude }: Props) {
  const [sessionExcluded, setSessionExcluded] = useState<Set<string>>(new Set());

  // Reset session exclusions each time the modal (re)opens so a stale set from a
  // previous preview doesn't carry over into a new one.
  useEffect(() => {
    if (open) setSessionExcluded(new Set());
  }, [open]);

  function handleExclude(address: string) {
    setSessionExcluded((prev) => new Set([...prev, address]));
  }

  function handleSaveExcludes() {
    if (sessionExcluded.size === 0) return;
    onExclude?.([...sessionExcluded]);
    setSessionExcluded(new Set());
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        // Ignore any close request (Escape, click-outside, the built-in X button) while a
        // run is in flight, so the in-progress send can't be dismissed/hidden mid-flight —
        // the caller re-opens this same modal on Preview/Run Now, so losing it here would
        // hide the only "Sending..." feedback and error surface for the active run.
        if (!v && executing) return;
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Distribution Preview</DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />
            Scanning holders...
          </div>
        )}

        {executing && !preview && !loading && !error && (
          <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />
            Sending distribution...
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {preview && (
          <div className="space-y-4">
            {preview.holderOnlyPreview && (
              <div className="rounded-lg border border-amber-700/50 bg-amber-950/30 p-3 text-sm text-amber-400 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                No sender key set — showing holder distribution only. Add a key to check balances and execute.
              </div>
            )}

            {preview.blocked && !preview.holderOnlyPreview && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 space-y-1">
                {preview.blockReasons.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-destructive">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    {r}
                  </div>
                ))}
              </div>
            )}

            {!preview.holderOnlyPreview && (
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Total Cost</p>
                <div className="flex flex-wrap gap-2">
                  {preview.costItems.map((item) => {
                    const isIssuer = item.senderBalance >= Number.MAX_SAFE_INTEGER - 1;
                    return (
                    <div key={`${item.assetCode}:${item.assetIssuer ?? "native"}`}
                      className={`rounded-lg border px-3 py-2 text-sm ${item.shortfall > 0 || !item.hasTrustline ? "border-destructive/50 bg-destructive/10" : "border-border bg-muted/30"}`}>
                      <span className="font-mono font-medium">{item.totalRequired.toFixed(7)}</span>
                      <span className="text-muted-foreground ml-1">{item.assetCode}</span>
                      {isIssuer && (
                        <span className="text-green-400 ml-2 text-xs">issuer (unlimited)</span>
                      )}
                      {!isIssuer && item.shortfall > 0 && (
                        <span className="text-destructive ml-2 text-xs">&uarr; {item.shortfall.toFixed(7)} short</span>
                      )}
                    </div>
                    );
                  })}
                </div>
              </div>
            )}

            {preview.assignments.some((a) => a.tier.assets.some((x) => x.assetCode.toUpperCase() !== "XLM")) && (
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                Recipients without a trustline for non-XLM reward assets will be skipped automatically.
              </div>
            )}

            {preview.assignments.map((a) => (
              <div key={a.tier.id} className="rounded-lg border border-border">
                <div className="flex items-center gap-3 p-3 border-b border-border">
                  <span className="text-xs font-semibold text-purple-400 uppercase">Tier {a.tier.tierNumber}</span>
                  <span className="text-sm text-muted-foreground">
                    {a.tier.minTokens.toLocaleString()} &ndash; {a.tier.maxTokens != null ? a.tier.maxTokens.toLocaleString() : "\u221E"}
                  </span>
                  <span className="ml-auto text-sm font-medium">{a.holders.length} holder{a.holders.length !== 1 ? "s" : ""}</span>
                </div>
                {a.holders.length === 0 ? (
                  <p className="text-xs text-muted-foreground p-3">No holders in this tier</p>
                ) : (
                  <div className="p-3 space-y-1 max-h-48 overflow-y-auto">
                    {a.holders.slice(0, 50).map((h) => {
                      const excluded = sessionExcluded.has(h.address);
                      return (
                        <div key={h.address} className={`flex items-center gap-2 text-xs rounded px-1 ${excluded ? "opacity-40 line-through" : ""}`}>
                          <span className="font-mono text-muted-foreground">{shortAddr(h.address)}</span>
                          <span className="text-foreground">{h.balance.toLocaleString()} tokens</span>
                          <span className="ml-auto text-muted-foreground">
                            {a.tier.assets.map((asset) => `${asset.amount} ${asset.assetCode}`).join(" + ")}
                          </span>
                          {!excluded && (
                            <button
                              onClick={() => handleExclude(h.address)}
                              className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                              title="Exclude from distribution"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {a.holders.length > 50 && (
                      <p className="text-xs text-muted-foreground">...and {a.holders.length - 50} more</p>
                    )}
                  </div>
                )}
              </div>
            ))}

            {sessionExcluded.size > 0 && (
              <div className="rounded-lg border border-amber-700/50 bg-amber-950/30 p-2 text-xs text-amber-400 flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                {sessionExcluded.size} exclude{sessionExcluded.size !== 1 ? "s" : ""} not saved yet — the server reloads the exclude list from the config on execute, so unsaved exclusions would still be paid. Save before executing.
              </div>
            )}

            <div className="flex justify-between gap-2 pt-2 border-t border-border">
              <div>
                {sessionExcluded.size > 0 && (
                  <Button variant="outline" size="sm" onClick={handleSaveExcludes}>
                    Save {sessionExcluded.size} exclude{sessionExcluded.size !== 1 ? "s" : ""} to config
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={onClose} disabled={executing}>Close</Button>
                {!preview.holderOnlyPreview && (
                  <Button
                    disabled={preview.blocked || executing || sessionExcluded.size > 0}
                    onClick={onExecute}
                    className="bg-purple-600 hover:bg-purple-700 text-white"
                  >
                    {executing ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Sending...</> : <><CheckCircle2 className="h-4 w-4 mr-2" />Execute Distribution</>}
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
