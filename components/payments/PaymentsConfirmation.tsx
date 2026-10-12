"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertTriangle } from "lucide-react";
import { NETWORK_LABELS } from "@/lib/settings";
import { ShortAddress } from "@/components/shared/ShortAddress";
import { assetLabel } from "@/lib/payments/helpers";
import type { PaymentsController } from "./usePaymentsController";

type PaymentsConfirmationProps = Pick<PaymentsController,
  | "confirmOpen"
  | "setConfirmOpen"
  | "activeTab"
  | "legs"
  | "network"
  | "fee"
  | "memoValue"
  | "pathMode"
  | "pathDest"
  | "selectedPathIndex"
  | "paths"
  | "pathsFetchedAt"
  | "destAmount"
  | "destIsNative"
  | "destAssetCode"
  | "maxSendAmount"
  | "srcIsNative"
  | "srcAssetCode"
  | "exactSendAmount"
  | "minReceiveAmount"
  | "claimAssetKey"
  | "claimAmount"
  | "claimants"
  | "parsedInnerTxOps"
  | "parsedInnerTxFee"
  | "feeBumpBaseFee"
  | "currentPublicKey"
  | "handleSubmit"
  | "isSubmitting"
>;

export function PaymentsConfirmation({
  confirmOpen,
  setConfirmOpen,
  activeTab,
  legs,
  network,
  fee,
  memoValue,
  pathMode,
  pathDest,
  selectedPathIndex,
  paths,
  pathsFetchedAt,
  destAmount,
  destIsNative,
  destAssetCode,
  maxSendAmount,
  srcIsNative,
  srcAssetCode,
  exactSendAmount,
  minReceiveAmount,
  claimAssetKey,
  claimAmount,
  claimants,
  parsedInnerTxOps,
  parsedInnerTxFee,
  feeBumpBaseFee,
  currentPublicKey,
  handleSubmit,
  isSubmitting,
}: PaymentsConfirmationProps) {
  return (
    <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm Transaction</DialogTitle>
          <DialogDescription>
            Please review the transaction details before submitting.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {activeTab === "send" ? (
            <div className="space-y-3">
              {legs.map((leg, idx) => (
                <div key={leg.id} className="rounded-md border border-border p-3 text-sm space-y-1.5">
                  {legs.length > 1 && (
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                      Payment {idx + 1}
                    </p>
                  )}
                  <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
                    <span className="text-muted-foreground">Asset:</span>
                    <span className="font-mono font-medium">{assetLabel(leg.assetKey)}</span>
                    <span className="text-muted-foreground">Amount:</span>
                    <span className="font-mono">{leg.amount} {assetLabel(leg.assetKey)}</span>
                    <span className="text-muted-foreground">To:</span>
                    <ShortAddress address={leg.destination.trim()} network={network} />
                  </div>
                </div>
              ))}
              <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm pt-1">
                <span className="text-muted-foreground">Fee:</span>
                <span className="font-mono">{fee} stroops</span>
                <span className="text-muted-foreground">Network:</span>
                <span>{NETWORK_LABELS[network]}</span>
                {memoValue.trim() && (
                  <>
                    <span className="text-muted-foreground">Memo:</span>
                    <span className="font-mono text-xs break-all">{memoValue.trim()}</span>
                  </>
                )}
              </div>
            </div>
          ) : activeTab === "path" ? (
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <span className="text-muted-foreground">Mode:</span>
              <span>{pathMode === "strict-receive" ? "Strict Receive" : "Strict Send"}</span>
              <span className="text-muted-foreground">Destination:</span>
              <ShortAddress address={pathDest.trim()} network={network} />
              {selectedPathIndex !== null && paths[selectedPathIndex] && (() => {
                const sp = paths[selectedPathIndex];
                return (
                  <>
                    <span className="text-muted-foreground">Route:</span>
                    <span className="font-mono text-xs">
                      {sp.path.length > 0 ? `via ${sp.path.map((hop) => assetLabel(hop.asset_type, hop.asset_code)).join(" → ")}` : "Direct (no intermediary hops)"}
                    </span>
                    <span className="text-muted-foreground">Quoted:</span>
                    <span className="font-mono text-xs">
                      {sp.sourceAmount} {assetLabel(sp.sourceAssetType, sp.sourceAssetCode)} → {sp.destinationAmount} {assetLabel(sp.destinationAssetType, sp.destinationAssetCode)}
                    </span>
                    {/* eslint-disable-next-line react-hooks/purity -- Preserve the existing quote-age clock refreshed by the controller timer. */}
                    {pathsFetchedAt !== null && Date.now() - pathsFetchedAt > 60000 && (
                      <div className="col-span-2">
                        <p className="text-xs text-amber-500 flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3 shrink-0" />
                          Quote is over a minute old — the order book may have moved. Consider closing this dialog and re-running Find Paths.
                        </p>
                      </div>
                    )}
                  </>
                );
              })()}
              {pathMode === "strict-receive" ? (
                <>
                  <span className="text-muted-foreground">Receive exactly:</span>
                  <span className="font-mono">{destAmount} {destIsNative ? "XLM" : destAssetCode.trim()}</span>
                  <span className="text-muted-foreground">Send at most:</span>
                  <span className="font-mono">{maxSendAmount} {srcIsNative ? "XLM" : srcAssetCode.trim()}</span>
                </>
              ) : (
                <>
                  <span className="text-muted-foreground">Send exactly:</span>
                  <span className="font-mono">{exactSendAmount} {srcIsNative ? "XLM" : srcAssetCode.trim()}</span>
                  <span className="text-muted-foreground">Receive at least:</span>
                  <span className="font-mono">{minReceiveAmount} {destIsNative ? "XLM" : destAssetCode.trim()}</span>
                </>
              )}
              <span className="text-muted-foreground">Fee:</span>
              <span className="font-mono">{fee} stroops</span>
              <span className="text-muted-foreground">Network:</span>
              <span>{NETWORK_LABELS[network]}</span>
              {memoValue.trim() && (
                <>
                  <span className="text-muted-foreground">Memo:</span>
                  <span className="font-mono text-xs break-all">{memoValue.trim()}</span>
                </>
              )}
            </div>
          ) : activeTab === "claimable" ? (
            <div className="space-y-3">
              <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <span className="text-muted-foreground">Asset:</span>
                <span className="font-mono font-medium">{assetLabel(claimAssetKey)}</span>
                <span className="text-muted-foreground">Amount:</span>
                <span className="font-mono">{claimAmount} {assetLabel(claimAssetKey)}</span>
                <span className="text-muted-foreground">Claimants:</span>
                <span>{claimants.length}</span>
                <span className="text-muted-foreground">Fee:</span>
                <span className="font-mono">{fee} stroops</span>
                <span className="text-muted-foreground">Network:</span>
                <span>{NETWORK_LABELS[network]}</span>
              </div>
              <div className="space-y-1">
                {claimants.map((c, i) => (
                  <div key={c.id} className="flex items-center gap-1 text-xs text-muted-foreground">
                    <span>{i + 1}.</span>
                    <ShortAddress address={c.destination.trim()} network={network} />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <span className="text-muted-foreground">Inner tx ops:</span>
              <span className="font-mono">{parsedInnerTxOps}</span>
              <span className="text-muted-foreground">Inner tx fee:</span>
              <span className="font-mono">{parsedInnerTxFee} stroops</span>
              <span className="text-muted-foreground">New base fee:</span>
              <span className="font-mono">{feeBumpBaseFee} stroops/op</span>
              <span className="text-muted-foreground">Fee account:</span>
              <span className="font-mono text-xs break-all">
                {currentPublicKey ?? "—"}
              </span>
              <span className="text-muted-foreground">Network:</span>
              <span>{NETWORK_LABELS[network]}</span>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setConfirmOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>Confirm & Submit</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
