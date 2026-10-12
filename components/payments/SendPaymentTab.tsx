"use client";

import { StrKey } from "stellar-sdk";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TabsContent } from "@/components/ui/tabs";
import { Loader2, AlertTriangle, Check, BookUser, Plus, Trash2, Coins, RefreshCw } from "lucide-react";
import { ShortAddress } from "@/components/shared/ShortAddress";
import { WalletSelect } from "@/components/ui/wallet-select";
import { nativeMaxSpendable } from "@/lib/payments/helpers";
import type { PaymentsController } from "./usePaymentsController";

type SendPaymentTabProps = Pick<PaymentsController,
  | "balancesLoading"
  | "balancesError"
  | "accountBalances"
  | "loadBalancesRef"
  | "currentPublicKey"
  | "loadBalances"
  | "signerCheck"
  | "legs"
  | "removeLeg"
  | "updateLeg"
  | "fee"
  | "addressBookEntries"
  | "setAddressBookTargetLegId"
  | "setAddressBookOpen"
  | "network"
  | "addLeg"
>;

export function SendPaymentTab({
  balancesLoading,
  balancesError,
  accountBalances,
  loadBalancesRef,
  currentPublicKey,
  loadBalances,
  signerCheck,
  legs,
  removeLeg,
  updateLeg,
  fee,
  addressBookEntries,
  setAddressBookTargetLegId,
  setAddressBookOpen,
  network,
  addLeg,
}: SendPaymentTabProps) {
  return (
    <TabsContent value="send" className="space-y-3 mt-3">

      {/* Asset balance status bar — hidden entirely when there's nothing to report
                  (the Asset picker below already shows its own "no assets" placeholder) */}
      {(balancesLoading || balancesError || accountBalances.length > 0) && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {balancesLoading && (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading your account balances…
            </>
          )}
          {!balancesLoading && balancesError && (
            <>
              <AlertTriangle className="h-3 w-3 text-destructive shrink-0" />
              <span className="text-destructive">{balancesError}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-1 text-xs"
                onClick={() => {
                  loadBalancesRef.current = null;
                  if (currentPublicKey) loadBalances(currentPublicKey);
                }}
              >
                <RefreshCw className="h-3 w-3 mr-1" />
                Retry
              </Button>
            </>
          )}
          {!balancesLoading && !balancesError && accountBalances.length > 0 && (
            <>
              <Coins className="h-3 w-3" />
              {accountBalances.length} asset{accountBalances.length !== 1 ? "s" : ""} available
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-1 text-xs"
                onClick={() => {
                  loadBalancesRef.current = null;
                  if (currentPublicKey) loadBalances(currentPublicKey);
                }}
              >
                <RefreshCw className="h-3 w-3" />
              </Button>
            </>
          )}
        </div>
      )}

      {!balancesLoading && signerCheck?.locked && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
          <span>
            <strong>Account locked for this key.</strong> {signerCheck.reason}
          </span>
        </div>
      )}

      {/* Payment legs */}
      <div className="space-y-3">
        {legs.map((leg, idx) => (
          <div
            key={leg.id}
            className="rounded-md border border-border bg-muted/20 p-3 space-y-2"
          >
            {/* Leg header — only shown once there's more than one leg to distinguish */}
            {legs.length > 1 && (
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Payment {idx + 1}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-destructive"
                  onClick={() => removeLeg(leg.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              {/* Asset picker */}
              <div className="space-y-2">
                <Label className="text-sm">Asset</Label>
                {accountBalances.length > 0 ? (
                  <Select
                    value={leg.assetKey}
                    onValueChange={(val) => {
                      if (val === leg.assetKey) return;
                      // Switching assets invalidates any amount/removeTrustline state
                      // computed for the OLD asset's balance — reset to a neutral default.
                      updateLeg(leg.id, { assetKey: val, removeTrustline: false, amount: "" });
                    }}
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
                    {balancesLoading ? "Loading assets…" : "No assets loaded — connect a wallet or enter signing key"}
                  </div>
                )}
              </div>

              {/* Amount */}
              <div className="space-y-2">
                <Label className="text-sm">Amount</Label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    placeholder="0.00"
                    min="0"
                    step="any"
                    value={leg.amount}
                    onChange={(e) => updateLeg(leg.id, { amount: e.target.value })}
                    className="flex-1"
                  />
                  {(() => {
                    const bal = accountBalances.find((b) => b.key === leg.assetKey);
                    if (!bal) return null;
                    // Reserve+sponsorship-aware ceiling minus the tx fee this leg's payment
                    // (+changeTrust op, if any) will actually cost.
                    const raw = parseFloat(bal.balance);
                    const sellingLiab = parseFloat(bal.sellingLiabilities || "0");
                    const estOps = legs.length + legs.filter((l) => l.removeTrustline && l.assetKey !== "native").length;
                    const maxAmt = leg.assetKey === "native"
                      ? nativeMaxSpendable(bal, Number(fee) || 100, estOps)
                      : Math.max(0, raw - sellingLiab).toFixed(7);
                    return (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9 px-2 text-xs shrink-0"
                        onClick={() => updateLeg(leg.id, { amount: maxAmt })}
                        title={`Max spendable: ${maxAmt}`}
                      >
                        Max
                      </Button>
                    );
                  })()}
                </div>
                {(() => {
                  const bal = accountBalances.find((b) => b.key === leg.assetKey);
                  if (!bal) return null;
                  const raw = parseFloat(bal.balance);
                  const sellingLiab = parseFloat(bal.sellingLiabilities || "0");
                  const estOps = legs.length + legs.filter((l) => l.removeTrustline && l.assetKey !== "native").length;
                  const maxAmt = leg.assetKey === "native"
                    ? nativeMaxSpendable(bal, Number(fee) || 100, estOps)
                    : Math.max(0, raw - sellingLiab).toFixed(7);
                  return (
                    <p className="text-xs text-muted-foreground">
                      Max spendable: {parseFloat(maxAmt).toLocaleString(undefined, { maximumFractionDigits: 7 })} {bal.assetCode}
                    </p>
                  );
                })()}
                {leg.amount && Number(leg.amount) <= 0 && (
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    Amount must be greater than 0.
                  </p>
                )}
              </div>
            </div>

            {/* Remove trustline after sending — only for non-native */}
            {leg.assetKey !== "native" && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Switch
                    checked={!!leg.removeTrustline}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        const bal = accountBalances.find((b) => b.key === leg.assetKey);
                        const maxAmt = bal ? bal.balance : leg.amount;
                        updateLeg(leg.id, { removeTrustline: true, amount: maxAmt });
                      } else {
                        updateLeg(leg.id, { removeTrustline: false });
                      }
                    }}
                  />
                  <span>
                    Remove trustline after sending{" "}
                    <span className="text-muted-foreground/60">(send full balance first)</span>
                  </span>
                </div>
                {leg.removeTrustline && (() => {
                  const bal = accountBalances.find((b) => b.key === leg.assetKey);
                  if (!bal) return null;
                  if (parseFloat(leg.amount) < parseFloat(bal.balance)) {
                    return (
                      <p className="text-xs text-amber-500 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        Amount is less than full balance ({bal.balance}). Trustline removal will fail if balance remains.
                      </p>
                    );
                  }
                  return null;
                })()}
              </div>
            )}

            {/* Destination */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Destination Account</Label>
                <div className="flex items-center gap-1">
                  <WalletSelect
                    onPick={(w) => updateLeg(leg.id, { destination: w.publicKey })}
                    align="end"
                  />
                  {addressBookEntries.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs gap-1"
                      onClick={() => {
                        setAddressBookTargetLegId(leg.id);
                        setAddressBookOpen(true);
                      }}
                    >
                      <BookUser className="h-3 w-3" />
                      Book
                    </Button>
                  )}
                </div>
              </div>
              <Input
                placeholder="G..."
                value={leg.destination}
                onChange={(e) => updateLeg(leg.id, { destination: e.target.value })}
                className="font-mono text-sm"
              />
              {leg.destination.trim() && StrKey.isValidEd25519PublicKey(leg.destination.trim()) && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Check className="h-3 w-3 text-green-500 shrink-0" />
                  <ShortAddress address={leg.destination.trim()} network={network} />
                </div>
              )}
              {leg.destination.trim() && !StrKey.isValidEd25519PublicKey(leg.destination.trim()) && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  Invalid Stellar public key.
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add payment leg button */}
      <Button
        variant="outline"
        className="w-full gap-2"
        onClick={addLeg}
      >
        <Plus className="h-4 w-4" />
        Add Payment
      </Button>
    </TabsContent>
  );
}
