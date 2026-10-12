"use client";

import { StrKey } from "stellar-sdk";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { TabsContent } from "@/components/ui/tabs";
import { AlertTriangle, Check, Plus, Trash2, Coins } from "lucide-react";
import { ShortAddress } from "@/components/shared/ShortAddress";
import { makeClaimant, nativeMaxSpendable } from "@/lib/payments/helpers";
import type { PaymentsController } from "./usePaymentsController";

type ClaimableBalanceTabProps = Pick<PaymentsController,
  | "accountBalances"
  | "claimAssetKey"
  | "setClaimAssetKey"
  | "balancesLoading"
  | "claimAmount"
  | "setClaimAmount"
  | "fee"
  | "claimants"
  | "setClaimants"
  | "updateClaimant"
  | "removeClaimant"
  | "network"
>;

export function ClaimableBalanceTab({
  accountBalances,
  claimAssetKey,
  setClaimAssetKey,
  balancesLoading,
  claimAmount,
  setClaimAmount,
  fee,
  claimants,
  setClaimants,
  updateClaimant,
  removeClaimant,
  network,
}: ClaimableBalanceTabProps) {
  return (
    <TabsContent value="claimable" className="space-y-3 mt-3">
      <p className="text-sm text-muted-foreground">
        Create a claimable balance that claimants can claim at any time (unconditional predicate).
        The asset is locked from your account until claimed or reclaimed.
      </p>

      {/* Asset picker */}
      <div className="space-y-2">
        <Label>Asset</Label>
        {accountBalances.length > 0 ? (
          <Select
            value={claimAssetKey}
            onValueChange={setClaimAssetKey}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select asset…" />
            </SelectTrigger>
            <SelectContent>
              {accountBalances.map((b) => (
                <SelectItem key={b.key} value={b.key}>
                  <div className="flex items-center gap-3">
                    <span className="font-medium">{b.assetCode}</span>
                    <span className="text-xs text-muted-foreground font-mono">
                      {parseFloat(b.balance).toLocaleString(undefined, { maximumFractionDigits: 7 })}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
            <Coins className="h-4 w-4 shrink-0" />
            {balancesLoading ? "Loading assets…" : "Connect a wallet or enter signing key to load assets"}
          </div>
        )}
      </div>

      {/* Amount */}
      <div className="space-y-2">
        <Label htmlFor="claim-amount">Amount</Label>
        <div className="flex gap-2">
          <Input
            id="claim-amount"
            type="number"
            placeholder="0.00"
            min="0"
            step="any"
            value={claimAmount}
            onChange={(e) => setClaimAmount(e.target.value)}
            className="flex-1"
          />
          {(() => {
            const bal = accountBalances.find((b) => b.key === claimAssetKey);
            if (!bal) return null;
            const maxAmt = claimAssetKey === "native"
              ? nativeMaxSpendable(bal, Number(fee) || 100, 1, 0.5 * claimants.length)
              : Math.max(0, parseFloat(bal.balance) - parseFloat(bal.sellingLiabilities || "0")).toFixed(7);
            return (
              <Button
                variant="outline"
                size="sm"
                className="h-9 px-2 text-xs shrink-0"
                onClick={() => setClaimAmount(maxAmt)}
              >
                Max
              </Button>
            );
          })()}
        </div>
        {claimAmount && Number(claimAmount) <= 0 && (
          <p className="text-xs text-destructive flex items-center gap-1">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            Amount must be greater than 0.
          </p>
        )}
        {(() => {
          const bal = accountBalances.find((b) => b.key === claimAssetKey);
          if (!bal || !claimAmount || Number(claimAmount) <= 0) return null;
          if (Number(claimAmount) <= parseFloat(bal.balance)) return null;
          return (
            <p className="text-xs text-amber-500 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              Amount exceeds your available balance ({bal.balance}).
            </p>
          );
        })()}
      </div>

      {/* Claimants */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Label>Claimants</Label>
            {claimants.length >= 10 && (
              <span className="text-xs text-muted-foreground">(protocol max 10 claimants)</span>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs gap-1"
            disabled={claimants.length >= 10}
            onClick={() => setClaimants((prev) => [...prev, makeClaimant()])}
          >
            <Plus className="h-3 w-3" />
            Add
          </Button>
        </div>
        {claimants.map((c, idx) => (
          <div key={c.id} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Input
                placeholder="G... (claimant address)"
                value={c.destination}
                onChange={(e) => updateClaimant(c.id, e.target.value)}
                className="font-mono text-sm flex-1"
              />
              {claimants.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => removeClaimant(c.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            {c.destination.trim() &&
              StrKey.isValidEd25519PublicKey(c.destination.trim()) &&
              claimants.findIndex((x) => x.destination.trim() === c.destination.trim()) === idx && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground pl-1">
                  <Check className="h-3 w-3 text-green-500 shrink-0" />
                  <ShortAddress address={c.destination.trim()} network={network} />
                </div>
              )}
            {c.destination.trim() &&
              StrKey.isValidEd25519PublicKey(c.destination.trim()) &&
              claimants.findIndex((x) => x.destination.trim() === c.destination.trim()) !== idx && (
                <p className="text-xs text-destructive flex items-center gap-1 pl-1">
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  Duplicate claimant address.
                </p>
              )}
            {c.destination.trim() && !StrKey.isValidEd25519PublicKey(c.destination.trim()) && (
              <p className="text-xs text-destructive flex items-center gap-1 pl-1">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                Invalid Stellar public key.
              </p>
            )}
          </div>
        ))}
        <p className="text-xs text-muted-foreground">
          All claimants use an unconditional predicate — they can claim at any time.
          The creator (you) is also implicitly able to reclaim via clawback if AUTH_CLAWBACK is set.
        </p>
        <p className="text-xs text-muted-foreground">
          Creating this locks {(claimants.length * 0.5).toFixed(1)} XLM of additional reserve in your account until claimed or reclaimed.
        </p>
      </div>
    </TabsContent>
  );
}
