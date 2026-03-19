"use client";

import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
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
}

export function TierPreviewModal({ open, onClose, preview, loading, error, onExecute, executing }: Props) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
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

        {error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {preview && (
          <div className="space-y-4">
            {preview.blocked && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 space-y-1">
                {preview.blockReasons.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-destructive">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    {r}
                  </div>
                ))}
              </div>
            )}

            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Total Cost</p>
              <div className="flex flex-wrap gap-2">
                {preview.costItems.map((item) => (
                  <div key={`${item.assetCode}:${item.assetIssuer ?? "native"}`}
                    className={`rounded-lg border px-3 py-2 text-sm ${item.shortfall > 0 || !item.hasTrustline ? "border-destructive/50 bg-destructive/10" : "border-border bg-muted/30"}`}>
                    <span className="font-mono font-medium">{item.totalRequired.toFixed(7)}</span>
                    <span className="text-muted-foreground ml-1">{item.assetCode}</span>
                    {item.shortfall > 0 && (
                      <span className="text-destructive ml-2 text-xs">&uarr; {item.shortfall.toFixed(7)} short</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

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
                    {a.holders.slice(0, 50).map((h) => (
                      <div key={h.address} className="flex items-center gap-2 text-xs">
                        <span className="font-mono text-muted-foreground">{shortAddr(h.address)}</span>
                        <span className="text-foreground">{h.balance.toLocaleString()} tokens</span>
                        <span className="ml-auto text-muted-foreground">
                          {a.tier.assets.map((asset) => `${asset.amount} ${asset.assetCode}`).join(" + ")}
                        </span>
                      </div>
                    ))}
                    {a.holders.length > 50 && (
                      <p className="text-xs text-muted-foreground">...and {a.holders.length - 50} more</p>
                    )}
                  </div>
                )}
              </div>
            ))}

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button variant="outline" onClick={onClose} disabled={executing}>Cancel</Button>
              <Button
                disabled={preview.blocked || executing}
                onClick={onExecute}
                className="bg-purple-600 hover:bg-purple-700 text-white"
              >
                {executing ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Sending...</> : <><CheckCircle2 className="h-4 w-4 mr-2" />Execute Distribution</>}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
