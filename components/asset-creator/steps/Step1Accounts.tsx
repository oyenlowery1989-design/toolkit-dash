// components/asset-creator/steps/Step1Accounts.tsx
"use client";

import { useState } from "react";
import { Keypair, StrKey } from "stellar-sdk";
import { Eye, EyeOff, RefreshCw, Wallet } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NETWORK_LABELS, type Network } from "@/lib/settings";
import type { AssetCreatorForm } from "@/lib/asset-creator/types";

interface Props {
  form: AssetCreatorForm;
  onChange: (patch: Partial<AssetCreatorForm>) => void;
  activeWalletName?: string;
  activeWalletKey?: string;
  onNext: () => void;
}

function KeypairField({
  label,
  publicKey,
  secretKey,
  onPublicChange,
  onSecretChange,
  onGenerate,
}: {
  label: string;
  publicKey: string;
  secretKey: string;
  onPublicChange: (v: string) => void;
  onSecretChange: (v: string) => void;
  onGenerate: () => void;
}) {
  const [showSecret, setShowSecret] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold">{label}</Label>
        <Button type="button" variant="ghost" size="sm" onClick={onGenerate} className="h-7 text-xs gap-1">
          <RefreshCw className="h-3 w-3" /> Generate new
        </Button>
      </div>
      <Input
        placeholder="Public key (G…)"
        value={publicKey}
        onChange={(e) => onPublicChange(e.target.value.trim())}
        className="font-mono text-xs"
      />
      <div className="relative">
        <Input
          type={showSecret ? "text" : "password"}
          placeholder="Secret key (S…)"
          value={secretKey}
          onChange={(e) => onSecretChange(e.target.value.trim())}
          className="font-mono text-xs pr-10"
        />
        <button
          type="button"
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          onClick={() => setShowSecret((v) => !v)}
        >
          {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function validateStep1(form: AssetCreatorForm): string | null {
  if (!StrKey.isValidEd25519PublicKey(form.issuerPublicKey)) return "Invalid issuer public key";
  if (!StrKey.isValidEd25519PublicKey(form.distributorPublicKey)) return "Invalid distributor public key";
  try {
    const kp = Keypair.fromSecret(form.issuerSecretKey);
    if (kp.publicKey() !== form.issuerPublicKey) return "Issuer secret key does not match public key";
  } catch {
    return "Invalid issuer secret key";
  }
  try {
    const kp = Keypair.fromSecret(form.distributorSecretKey);
    if (kp.publicKey() !== form.distributorPublicKey) return "Distributor secret key does not match public key";
  } catch {
    return "Invalid distributor secret key";
  }
  return null;
}

export function Step1Accounts({ form, onChange, activeWalletName, activeWalletKey, onNext }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [showFundingSecret, setShowFundingSecret] = useState(false);

  const handleNext = () => {
    const err = validateStep1(form);
    if (err) { setError(err); return; }
    setError(null);
    onNext();
  };

  const generateKeypair = (which: "issuer" | "distributor") => {
    const kp = Keypair.random();
    if (which === "issuer") {
      onChange({ issuerPublicKey: kp.publicKey(), issuerSecretKey: kp.secret() });
    } else {
      onChange({ distributorPublicKey: kp.publicKey(), distributorSecretKey: kp.secret() });
    }
  };

  const networks: Network[] = ["public", "testnet", "futurenet"];

  return (
    <div className="space-y-6">
      {/* Network */}
      <div className="space-y-2">
        <Label className="text-sm font-semibold">Network</Label>
        <Select value={form.network} onValueChange={(v) => onChange({ network: v as Network })}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {networks.map((n) => (
              <SelectItem key={n} value={n}>{NETWORK_LABELS[n]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Funding source */}
      <div className="space-y-2">
        <Label className="text-sm font-semibold">Funding Source (for new accounts on mainnet)</Label>
        {activeWalletName && activeWalletKey ? (
          <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-green-500/10 border border-green-500/30 text-sm">
            <Wallet className="h-4 w-4 text-green-500" />
            <span className="font-medium text-green-600 dark:text-green-400">{activeWalletName}</span>
            <span className="text-muted-foreground font-mono text-xs">{activeWalletKey}</span>
          </div>
        ) : (
          <div className="space-y-1">
            <div className="relative">
              <Input
                type={showFundingSecret ? "text" : "password"}
                placeholder="Funding secret key (S…) — only needed if creating new accounts on mainnet"
                value={form.resolvedFundingSecretKey}
                onChange={(e) => onChange({ resolvedFundingSecretKey: e.target.value.trim() })}
                className="font-mono text-xs pr-10"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowFundingSecret((v) => !v)}
              >
                {showFundingSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">Connect a wallet in Wallet Manager to use it here automatically.</p>
          </div>
        )}
      </div>

      {/* Issuer keypair */}
      <KeypairField
        label="Issuer Keypair"
        publicKey={form.issuerPublicKey}
        secretKey={form.issuerSecretKey}
        onPublicChange={(v) => onChange({ issuerPublicKey: v })}
        onSecretChange={(v) => onChange({ issuerSecretKey: v })}
        onGenerate={() => generateKeypair("issuer")}
      />

      {/* Distributor keypair */}
      <KeypairField
        label="Distributor Keypair"
        publicKey={form.distributorPublicKey}
        secretKey={form.distributorSecretKey}
        onPublicChange={(v) => onChange({ distributorPublicKey: v })}
        onSecretChange={(v) => onChange({ distributorSecretKey: v })}
        onGenerate={() => generateKeypair("distributor")}
      />

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button onClick={handleNext}>Next: Asset Config →</Button>
    </div>
  );
}
