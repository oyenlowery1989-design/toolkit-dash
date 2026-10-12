"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle, Check, Plus } from "lucide-react";
import { assetLabel } from "@/lib/payments/helpers";
import type { PaymentsController } from "./usePaymentsController";

type PaymentsErrorProps = Pick<PaymentsController,
  | "txStatus"
  | "txError"
  | "trustlinePrompt"
  | "handleAddTrustlinesAndRetry"
  | "trustlineAdding"
  | "setTrustlinePrompt"
  | "setTrustlinePromptTab"
  | "trustlineStatus"
>;

export function PaymentsError({
  txStatus,
  txError,
  trustlinePrompt,
  handleAddTrustlinesAndRetry,
  trustlineAdding,
  setTrustlinePrompt,
  setTrustlinePromptTab,
  trustlineStatus,
}: PaymentsErrorProps) {
  return (
    txStatus === "error" && txError && (
      <Card className={trustlinePrompt ? "border-amber-500/40 bg-amber-500/5" : "border-destructive/50 bg-destructive/5"}>
        <CardContent className="pt-6 space-y-3">
          <div className={`flex items-start gap-3 ${trustlinePrompt ? "text-amber-700 dark:text-amber-400" : "text-destructive"}`}>
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-medium">{trustlinePrompt ? "Trustline Required" : "Transaction Failed"}</p>
              <p className="text-xs">{txError}</p>
            </div>
          </div>

          {trustlinePrompt && (
            <div className="space-y-3 pl-7">
              <div className="space-y-1.5">
                {trustlinePrompt.map((fix) => (
                  <div key={fix.leg.id} className="flex items-center gap-2 text-xs">
                    <Check className="h-3 w-3 text-green-500 shrink-0" />
                    <span className="text-muted-foreground">
                      <span className="font-medium text-foreground">{fix.walletName}</span>
                      {" — add "}
                      <span className="font-mono font-medium">{assetLabel(fix.leg.assetKey)}</span>
                      {" trustline"}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleAddTrustlinesAndRetry}
                  disabled={trustlineAdding}
                  className="gap-2"
                >
                  {trustlineAdding
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Plus className="h-3.5 w-3.5" />}
                  {trustlineAdding ? "Adding trustline…" : "Add trustline & retry"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setTrustlinePrompt(null);
                    setTrustlinePromptTab(null);
                  }}
                  disabled={trustlineAdding}
                >
                  Dismiss
                </Button>
              </div>
              {trustlineAdding && trustlineStatus && (
                <p className="text-xs text-muted-foreground flex items-center gap-1.5 pl-7">
                  <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                  {trustlineStatus}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    )
  );
}
