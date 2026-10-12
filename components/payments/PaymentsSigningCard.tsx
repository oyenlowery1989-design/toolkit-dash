"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ShieldAlert, Eye, EyeOff, Wallet } from "lucide-react";
import { shortAddr } from "@/lib/format";
import { ShortAddress } from "@/components/shared/ShortAddress";
import { WalletSelect } from "@/components/ui/wallet-select";
import type { PaymentsController } from "./usePaymentsController";

type PaymentsSigningCardProps = Pick<PaymentsController,
  | "wallets"
  | "signingWalletId"
  | "setSigningWalletId"
  | "activeTab"
  | "hasSigningKey"
  | "showSecret"
  | "secretKeyDisplay"
  | "handleSecretKeyChange"
  | "setShowSecret"
  | "currentPublicKey"
  | "network"
>;

export function PaymentsSigningCard({
  wallets,
  signingWalletId,
  setSigningWalletId,
  activeTab,
  hasSigningKey,
  showSecret,
  secretKeyDisplay,
  handleSecretKeyChange,
  setShowSecret,
  currentPublicKey,
  network,
}: PaymentsSigningCardProps) {
  return (
    <Card>
      <CardContent className="space-y-2 px-4 py-3">
        {/* Wallet picker */}
        {wallets.length > 0 && (
          <div className="flex items-center justify-between">
            <Label>Wallet</Label>
            <WalletSelect
              currentId={signingWalletId ?? undefined}
              onPick={(w) => setSigningWalletId(w.id)}
              onClear={() => setSigningWalletId(null)}
              align="end"
            />
          </div>
        )}

        {/* Selected wallet chip */}
        {signingWalletId && (() => {
          const w = wallets.find((w) => w.id === signingWalletId);
          if (!w) return null;
          return (
            <div className="flex items-center gap-2 rounded-md border border-green-500/40 bg-green-500/5 px-3 py-2 text-sm">
              <Wallet className="h-4 w-4 shrink-0 text-green-500" />
              <span className="flex-1 truncate font-medium">{w.name}</span>
              <span className="font-mono text-xs text-muted-foreground">
                {shortAddr(w.publicKey)}
              </span>
            </div>
          );
        })()}

        {signingWalletId && activeTab !== "sponsorship" && (
          <p className={hasSigningKey ? "text-xs text-muted-foreground" : "text-xs text-amber-600 dark:text-amber-400"}>
            {hasSigningKey ? "Payments uses your saved key without asking you to enter it again." : "Watch-only wallet: save its signing key in Wallet Manager to make payments."}
          </p>
        )}

        {/* Manual key input */}
        {!signingWalletId && (
          <div className="space-y-1.5">
            <Label htmlFor="secret-key">Secret Key</Label>
            <div className="flex gap-2">
              <Input
                id="secret-key"
                type={showSecret ? "text" : "password"}
                placeholder="S..."
                value={secretKeyDisplay}
                onChange={(e) => handleSecretKeyChange(e.target.value)}
                className="font-mono text-sm flex-1"
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore
              />
              <Button
                variant="outline"
                size="icon"
                type="button"
                onClick={() => setShowSecret(!showSecret)}
                className="shrink-0"
              >
                {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            {currentPublicKey && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span>Public key:</span>
                <ShortAddress address={currentPublicKey} network={network} />
              </div>
            )}
          </div>
        )}

        {/* Security note */}
        <p className="text-xs text-muted-foreground flex items-center gap-1.5 pt-1">
          <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          {signingWalletId
            ? "Your saved key stays encrypted on the server; the transaction is sent there for signing."
            : "Manual keys sign in this browser; only the public address is saved after a successful payment."}
        </p>
      </CardContent>
    </Card>
  );
}
