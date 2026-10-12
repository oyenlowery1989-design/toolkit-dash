"use client";

import { StrKey } from "stellar-sdk";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TabsContent } from "@/components/ui/tabs";
import { Send, Loader2, AlertTriangle, Check, BookUser, Route, ArrowLeftRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { ShortAddress } from "@/components/shared/ShortAddress";
import { WalletSelect } from "@/components/ui/wallet-select";
import { assetLabel, isValidAssetCode } from "@/lib/payments/helpers";
import type { PaymentsController } from "./usePaymentsController";

type PathPaymentTabProps = Pick<PaymentsController,
  | "pathMode"
  | "setPathMode"
  | "srcIsNative"
  | "setSrcIsNative"
  | "srcAssetCode"
  | "setSrcAssetCode"
  | "srcAssetIssuer"
  | "setSrcAssetIssuer"
  | "maxSendAmount"
  | "setMaxSendAmount"
  | "exactSendAmount"
  | "setExactSendAmount"
  | "destIsNative"
  | "setDestIsNative"
  | "destAssetCode"
  | "setDestAssetCode"
  | "destAssetIssuer"
  | "setDestAssetIssuer"
  | "destAmount"
  | "setDestAmount"
  | "minReceiveAmount"
  | "setMinReceiveAmount"
  | "pathDest"
  | "setPathDest"
  | "addressBookEntries"
  | "setAddressBookOpen"
  | "network"
  | "handleFindPaths"
  | "isFindingPaths"
  | "pathError"
  | "paths"
  | "setSelectedPathIndex"
  | "selectedPathIndex"
>;

export function PathPaymentTab({
  pathMode,
  setPathMode,
  srcIsNative,
  setSrcIsNative,
  srcAssetCode,
  setSrcAssetCode,
  srcAssetIssuer,
  setSrcAssetIssuer,
  maxSendAmount,
  setMaxSendAmount,
  exactSendAmount,
  setExactSendAmount,
  destIsNative,
  setDestIsNative,
  destAssetCode,
  setDestAssetCode,
  destAssetIssuer,
  setDestAssetIssuer,
  destAmount,
  setDestAmount,
  minReceiveAmount,
  setMinReceiveAmount,
  pathDest,
  setPathDest,
  addressBookEntries,
  setAddressBookOpen,
  network,
  handleFindPaths,
  isFindingPaths,
  pathError,
  paths,
  setSelectedPathIndex,
  selectedPathIndex,
}: PathPaymentTabProps) {
  return (
    <TabsContent value="path" className="space-y-3 mt-3">

      {/* Strict receive / strict send toggle */}
      <div className="flex items-center gap-2 rounded-md border border-border p-1">
        <Button
          type="button"
          size="sm"
          variant={pathMode === "strict-receive" ? "default" : "outline"}
          className="flex-1 gap-1.5"
          onClick={() => setPathMode("strict-receive")}
        >
          <ArrowLeftRight className="h-3.5 w-3.5" />
          Strict Receive
        </Button>
        <Button
          type="button"
          size="sm"
          variant={pathMode === "strict-send" ? "default" : "outline"}
          className="flex-1 gap-1.5"
          onClick={() => setPathMode("strict-send")}
        >
          <Send className="h-3.5 w-3.5" />
          Strict Send
        </Button>
      </div>
      <p className="text-xs text-muted-foreground -mt-2">
        {pathMode === "strict-receive"
          ? "Specify exactly how much the destination receives — you pay up to a max."
          : "Specify exactly how much you send — destination receives at least a minimum."}
      </p>

      {/* Source asset */}
      <fieldset className="space-y-2 rounded-md border border-border p-3">
        <legend className="px-2 text-sm font-medium text-muted-foreground">
          Source Asset
        </legend>
        <div className={cn(srcIsNative ? "flex items-end gap-3" : "space-y-2")}>
          <div className={cn("flex items-center gap-2", srcIsNative && "shrink-0 pb-2")}>
            <Switch checked={srcIsNative} onCheckedChange={setSrcIsNative} id="src-native" />
            <Label htmlFor="src-native" className="text-sm cursor-pointer whitespace-nowrap">
              Native (XLM)
            </Label>
          </div>
          {!srcIsNative && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="src-code">Asset Code</Label>
                <Input
                  id="src-code"
                  placeholder="USDC"
                  maxLength={12}
                  value={srcAssetCode}
                  onChange={(e) => setSrcAssetCode(e.target.value)}
                />
                {srcAssetCode.trim() && !isValidAssetCode(srcAssetCode.trim()) && (
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    1-12 alphanumeric characters.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="src-issuer">Asset Issuer</Label>
                <Input
                  id="src-issuer"
                  placeholder="G..."
                  value={srcAssetIssuer}
                  onChange={(e) => setSrcAssetIssuer(e.target.value)}
                  className="font-mono text-sm"
                />
                {srcAssetIssuer.trim() && !StrKey.isValidEd25519PublicKey(srcAssetIssuer.trim()) && (
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    Invalid issuer public key.
                  </p>
                )}
              </div>
            </div>
          )}
          {pathMode === "strict-receive" ? (
            <div className={cn("space-y-2", srcIsNative && "flex-1")}>
              <Label htmlFor="max-send">Max Send Amount</Label>
              <Input
                id="max-send"
                type="number"
                placeholder="0.00"
                min="0"
                step="any"
                value={maxSendAmount}
                onChange={(e) => setMaxSendAmount(e.target.value)}
              />
            </div>
          ) : (
            <div className={cn("space-y-2", srcIsNative && "flex-1")}>
              <Label htmlFor="exact-send">Exact Send Amount</Label>
              <Input
                id="exact-send"
                type="number"
                placeholder="0.00"
                min="0"
                step="any"
                value={exactSendAmount}
                onChange={(e) => setExactSendAmount(e.target.value)}
              />
            </div>
          )}
        </div>
      </fieldset>

      {/* Destination asset */}
      <fieldset className="space-y-2 rounded-md border border-border p-3">
        <legend className="px-2 text-sm font-medium text-muted-foreground">
          Destination Asset
        </legend>
        <div className={cn(destIsNative ? "flex items-end gap-3" : "space-y-2")}>
          <div className={cn("flex items-center gap-2", destIsNative && "shrink-0 pb-2")}>
            <Switch checked={destIsNative} onCheckedChange={setDestIsNative} id="dest-native" />
            <Label htmlFor="dest-native" className="text-sm cursor-pointer whitespace-nowrap">
              Native (XLM)
            </Label>
          </div>
          {!destIsNative && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="dest-code">Asset Code</Label>
                <Input
                  id="dest-code"
                  placeholder="USDC"
                  maxLength={12}
                  value={destAssetCode}
                  onChange={(e) => setDestAssetCode(e.target.value)}
                />
                {destAssetCode.trim() && !isValidAssetCode(destAssetCode.trim()) && (
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    1-12 alphanumeric characters.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="dest-issuer">Asset Issuer</Label>
                <Input
                  id="dest-issuer"
                  placeholder="G..."
                  value={destAssetIssuer}
                  onChange={(e) => setDestAssetIssuer(e.target.value)}
                  className="font-mono text-sm"
                />
                {destAssetIssuer.trim() && !StrKey.isValidEd25519PublicKey(destAssetIssuer.trim()) && (
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    Invalid issuer public key.
                  </p>
                )}
              </div>
            </div>
          )}
          {pathMode === "strict-receive" ? (
            <div className={cn("space-y-2", destIsNative && "flex-1")}>
              <Label htmlFor="dest-amount">Destination Amount</Label>
              <Input
                id="dest-amount"
                type="number"
                placeholder="0.00"
                min="0"
                step="any"
                value={destAmount}
                onChange={(e) => setDestAmount(e.target.value)}
              />
            </div>
          ) : (
            <div className={cn("space-y-2", destIsNative && "flex-1")}>
              <Label htmlFor="min-receive">Min Receive Amount</Label>
              <Input
                id="min-receive"
                type="number"
                placeholder="0.00"
                min="0"
                step="any"
                value={minReceiveAmount}
                onChange={(e) => setMinReceiveAmount(e.target.value)}
              />
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {pathMode === "strict-receive"
            ? "Exact amount the destination will receive."
            : "Minimum the destination must receive (tx fails if below)."}
        </p>
      </fieldset>

      {/* Destination account */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="path-dest">Destination Account</Label>
          <div className="flex items-center gap-1">
            <WalletSelect
              currentValue={pathDest}
              onPick={(w) => setPathDest(w.publicKey)}
            />
            {addressBookEntries.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs gap-1"
                onClick={() => setAddressBookOpen(true)}
              >
                <BookUser className="h-3 w-3" />
                Book
              </Button>
            )}
          </div>
        </div>
        <Input
          id="path-dest"
          placeholder="G..."
          value={pathDest}
          onChange={(e) => setPathDest(e.target.value)}
          className="font-mono text-sm"
        />
        {pathDest.trim() && StrKey.isValidEd25519PublicKey(pathDest.trim()) && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Check className="h-3 w-3 text-green-500 shrink-0" />
            <ShortAddress address={pathDest.trim()} network={network} />
          </div>
        )}
        {pathDest.trim() && !StrKey.isValidEd25519PublicKey(pathDest.trim()) && (
          <p className="text-xs text-destructive flex items-center gap-1">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            Invalid Stellar public key.
          </p>
        )}
      </div>

      {/* Find paths */}
      <Button
        onClick={handleFindPaths}
        disabled={isFindingPaths}
        variant="outline"
        className="w-full"
      >
        {isFindingPaths ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Route className="mr-2 h-4 w-4" />
        )}
        Find Paths
      </Button>

      {pathError && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          {pathError}
        </p>
      )}

      {/* Path results */}
      {paths.length > 0 && (
        <div className="space-y-2">
          <Label className="text-sm font-medium">
            Available Paths ({paths.length})
          </Label>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {paths.map((p, i) => (
              <Button
                key={p.id}
                type="button"
                variant="outline"
                onClick={() => {
                  setSelectedPathIndex(i);
                  if (pathMode === "strict-receive") setMaxSendAmount(p.sourceAmount);
                  else setMinReceiveAmount(p.destinationAmount);
                }}
                className={cn(
                  "w-full h-auto flex-col items-start whitespace-normal text-left p-3",
                  selectedPathIndex === i && "border-primary bg-primary/5 ring-1 ring-primary",
                )}
              >
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div
                      className={`h-3 w-3 rounded-full border-2 ${selectedPathIndex === i
                        ? "border-primary bg-primary"
                        : "border-muted-foreground"
                        }`}
                    />
                    <span className="font-mono font-medium">
                      {p.sourceAmount}{" "}
                      {assetLabel(p.sourceAssetType, p.sourceAssetCode)}
                    </span>
                    <span className="text-muted-foreground">→</span>
                    <span className="font-mono font-medium">
                      {p.destinationAmount}{" "}
                      {assetLabel(p.destinationAssetType, p.destinationAssetCode)}
                    </span>
                  </div>
                </div>
                {p.path.length > 0 && (
                  <div className="mt-1 text-xs text-muted-foreground ml-5">
                    via{" "}
                    {p.path
                      .map((hop) => assetLabel(hop.asset_type, hop.asset_code))
                      .join(" → ")}
                  </div>
                )}
              </Button>
            ))}
          </div>
          {selectedPathIndex !== null && paths[selectedPathIndex] && (() => {
            const sp = paths[selectedPathIndex];
            const tooTight = pathMode === "strict-receive"
              ? Number(maxSendAmount) < Number(sp.sourceAmount)
              : Number(minReceiveAmount) > Number(sp.destinationAmount);
            if (!tooTight) return null;
            return (
              <p className="text-xs text-amber-500 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                {pathMode === "strict-receive"
                  ? `Selected path needs up to ${sp.sourceAmount} — your max send is lower and the transaction will fail.`
                  : `Selected path only guarantees ${sp.destinationAmount} — your min receive is higher and the transaction will fail.`}
              </p>
            );
          })()}
        </div>
      )}
    </TabsContent>
  );
}
