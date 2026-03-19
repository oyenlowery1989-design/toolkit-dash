// components/asset-creator/steps/Step1Accounts.tsx
"use client";

import { useState } from "react";
import { Keypair } from "stellar-sdk";
import { Eye, EyeOff, RefreshCw, Wallet } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { WalletSelect } from "@/components/ui/wallet-select";
import type { AssetCreatorForm } from "@/lib/asset-creator/types";

interface Props {
  form: AssetCreatorForm;
  onChange: (patch: Partial<AssetCreatorForm>) => void;
  activeWalletName?: string;
  activeWalletKey?: string;
  onNext: () => void;
}

/** Try to derive public key from secret. Returns "" if invalid. */
function derivePublicKey(secret: string): string {
  try {
    return Keypair.fromSecret(secret).publicKey();
  } catch {
    return "";
  }
}

function KeypairField({
  label,
  secretKey,
  derivedPublicKey,
  onSecretChange,
  onGenerate,
}: {
  label: string;
  secretKey: string;
  derivedPublicKey: string;
  onSecretChange: (secret: string, publicKey: string) => void;
  onGenerate: () => void;
}) {
  const [showSecret, setShowSecret] = useState(false);

  const handleSecretChange = (raw: string) => {
    const trimmed = raw.trim();
    onSecretChange(trimmed, derivePublicKey(trimmed));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold">{label}</Label>
        <div className="flex items-center gap-1">
          <WalletSelect
            currentValue={secretKey}
            onPick={(w) => onSecretChange(w.secretKey, w.publicKey)}
            triggerClassName="h-7"
          />
          <Button type="button" variant="ghost" size="sm" onClick={onGenerate} className="h-7 text-xs gap-1">
            <RefreshCw className="h-3 w-3" /> Generate new
          </Button>
        </div>
      </div>
      <div className="relative">
        <Input
          type={showSecret ? "text" : "password"}
          placeholder="Secret key (S…)"
          value={secretKey}
          onChange={(e) => handleSecretChange(e.target.value)}
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
      {derivedPublicKey && (
        <p className="text-xs font-mono text-muted-foreground break-all">
          {derivedPublicKey}
        </p>
      )}
      {secretKey && !derivedPublicKey && (
        <p className="text-xs text-destructive">Invalid secret key</p>
      )}
    </div>
  );
}

function validateStep1(form: AssetCreatorForm): string | null {
  if (!form.issuerSecretKey) return "Issuer secret key is required";
  if (!form.issuerPublicKey) return "Invalid issuer secret key";
  if (!form.distributorSecretKey) return "Distributor secret key is required";
  if (!form.distributorPublicKey) return "Invalid distributor secret key";
  if (form.issuerPublicKey === form.distributorPublicKey) return "Issuer and distributor must be different keypairs";
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

  return (
    <div className="space-y-6">
      {/* Funding source — only relevant on mainnet/futurenet */}
      {form.network !== "testnet" && (
        <div className="space-y-2">
          <Label className="text-sm font-semibold">Funding Source</Label>
          <p className="text-xs text-muted-foreground">
            Account that will pay to create the issuer and distributor on-chain (~4.1 XLM + fees).
          </p>
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
                  placeholder="Funding secret key (S…)"
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
      )}
      {form.network === "testnet" && (
        <div className="px-3 py-2 rounded-md bg-muted text-xs text-muted-foreground">
          Testnet: accounts will be funded automatically via Friendbot — no funding source needed.
        </div>
      )}

      {/* Issuer keypair */}
      <KeypairField
        label="Issuer Keypair"
        secretKey={form.issuerSecretKey}
        derivedPublicKey={form.issuerPublicKey}
        onSecretChange={(secret, pubKey) => onChange({ issuerSecretKey: secret, issuerPublicKey: pubKey })}
        onGenerate={() => generateKeypair("issuer")}
      />

      {/* Distributor keypair */}
      <KeypairField
        label="Distributor Keypair"
        secretKey={form.distributorSecretKey}
        derivedPublicKey={form.distributorPublicKey}
        onSecretChange={(secret, pubKey) => onChange({ distributorSecretKey: secret, distributorPublicKey: pubKey })}
        onGenerate={() => generateKeypair("distributor")}
      />

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button onClick={handleNext}>Next: Asset Config →</Button>
    </div>
  );
}
