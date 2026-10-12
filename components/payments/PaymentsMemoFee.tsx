"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { AlertTriangle } from "lucide-react";
import type { PaymentsController } from "./usePaymentsController";

type PaymentsMemoFeeProps = Pick<PaymentsController,
  | "activeTab"
  | "memoValue"
  | "setMemoValue"
  | "memoSkipped"
  | "setMemoSkipped"
  | "fee"
  | "setFee"
>;

export function PaymentsMemoFee({
  activeTab,
  memoValue,
  setMemoValue,
  memoSkipped,
  setMemoSkipped,
  fee,
  setFee,
}: PaymentsMemoFeeProps) {
  return (
    activeTab !== "feebump" && activeTab !== "sponsorship" && (
      <Card>
        <CardContent className="grid grid-cols-2 gap-4 px-4 py-3">
          {/* Memo — required to submit unless explicitly skipped */}
          <div className="space-y-2">
            <Label className="text-sm">Memo</Label>
            <div className="flex gap-2">
              <Input
                className="h-8 text-sm"
                placeholder="Memo text…"
                value={memoValue}
                onChange={(e) => setMemoValue(e.target.value)}
              />
              <Button
                type="button"
                variant={memoSkipped ? "default" : "outline"}
                size="sm"
                className="h-8 px-2 text-xs shrink-0"
                onClick={() => setMemoSkipped((v) => !v)}
              >
                {memoSkipped ? "Memo skipped" : "Skip memo"}
              </Button>
            </div>
            {!memoValue.trim() && !memoSkipped && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                Memo required — enter one or press &quot;Skip memo&quot; to continue without.
              </p>
            )}
          </div>

          {/* Fee */}
          <div className="space-y-2">
            <Label htmlFor="fee" className="text-sm">Fee <span className="text-muted-foreground font-normal">(stroops/op)</span></Label>
            <Input
              id="fee"
              type="number"
              min="100"
              step="1"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              className="h-8 text-sm"
            />
          </div>
        </CardContent>
      </Card>
    )
  );
}
