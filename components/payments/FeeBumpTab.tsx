"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TabsContent } from "@/components/ui/tabs";
import { AlertTriangle, Check } from "lucide-react";
import { NETWORK_LABELS } from "@/lib/settings";
import type { PaymentsController } from "./usePaymentsController";

type FeeBumpTabProps = Pick<PaymentsController,
  | "innerTxXdr"
  | "setInnerTxXdr"
  | "innerTxParseError"
  | "parsedInnerTxOps"
  | "parsedInnerTxFee"
  | "parsedInnerTxSigs"
  | "network"
  | "feeBumpBaseFee"
  | "setFeeBumpBaseFee"
  | "innerPerOpFee"
>;

export function FeeBumpTab({
  innerTxXdr,
  setInnerTxXdr,
  innerTxParseError,
  parsedInnerTxOps,
  parsedInnerTxFee,
  parsedInnerTxSigs,
  network,
  feeBumpBaseFee,
  setFeeBumpBaseFee,
  innerPerOpFee,
}: FeeBumpTabProps) {
  return (
    <TabsContent value="feebump" className="space-y-3 mt-3">
      <p className="text-sm text-muted-foreground">
        Wrap a signed transaction with a higher fee. Useful when the original fee is too low
        and the transaction is stuck. The fee account pays the difference.
      </p>

      {/* Inner transaction XDR */}
      <div className="space-y-2">
        <Label htmlFor="inner-xdr">Inner Transaction XDR</Label>
        <textarea
          id="inner-xdr"
          rows={4}
          placeholder="Paste the signed transaction XDR here…"
          value={innerTxXdr}
          onChange={(e) => setInnerTxXdr(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono resize-y min-h-[80px] focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {innerTxXdr.trim() && innerTxParseError && (
          <p className="text-xs text-destructive flex items-center gap-1">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            {innerTxParseError}
          </p>
        )}
        {innerTxXdr.trim() && !innerTxParseError && parsedInnerTxOps !== null && (
          <>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <Check className="h-3 w-3 text-green-500 shrink-0" />
              <span>Valid transaction</span>
              <span className="text-muted-foreground/60">·</span>
              <span>{parsedInnerTxOps} op{parsedInnerTxOps !== 1 ? "s" : ""}</span>
              <span className="text-muted-foreground/60">·</span>
              <span>current fee: {parsedInnerTxFee} stroops</span>
              <span className="text-muted-foreground/60">·</span>
              <span className={parsedInnerTxSigs === 0 ? "text-amber-500 font-medium" : ""}>
                {parsedInnerTxSigs} signature{parsedInnerTxSigs !== 1 ? "s" : ""}
              </span>
            </div>
            {parsedInnerTxSigs === 0 && (
              <p className="text-xs text-amber-500 flex items-center gap-1 mt-1">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                Unsigned inner transaction — submission will fail with tx_bad_auth.
              </p>
            )}
            <p className="text-xs text-amber-500 flex items-center gap-1 mt-1">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              XDR does not encode its network — verify this transaction was signed for{" "}
              <span className="font-medium">{NETWORK_LABELS[network]}</span>. A mismatch fails with tx_bad_auth.
            </p>
          </>
        )}
      </div>

      {/* Base fee for fee bump */}
      <div className="space-y-2 max-w-xs">
        <Label htmlFor="feebump-fee">New Base Fee (stroops per op)</Label>
        <Input
          id="feebump-fee"
          type="number"
          min="100"
          step="1"
          value={feeBumpBaseFee}
          onChange={(e) => setFeeBumpBaseFee(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Must be ≥ 100 stroops and ≥ the inner tx's fee per op.
          The fee account (your signing wallet) pays the difference.
        </p>
        {innerPerOpFee !== null && Number(feeBumpBaseFee) < innerPerOpFee && (
          <p className="text-xs text-destructive flex items-center gap-1">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            Base fee must be at least {innerPerOpFee} stroops/op (the inner transaction&apos;s own rate).
          </p>
        )}
      </div>
    </TabsContent>
  );
}
