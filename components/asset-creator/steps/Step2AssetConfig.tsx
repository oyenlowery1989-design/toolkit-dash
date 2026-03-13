// components/asset-creator/steps/Step2AssetConfig.tsx
"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { generateTomlSnippet } from "@/lib/asset-creator/toml";
import type { AssetCreatorForm } from "@/lib/asset-creator/types";

const ASSET_CODE_RE = /^[A-Za-z0-9]{1,12}$/;
const DOMAIN_RE = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

function validateStep2(form: AssetCreatorForm): string | null {
  if (!ASSET_CODE_RE.test(form.assetCode)) return "Asset code must be 1–12 alphanumeric characters";
  if (form.supply <= 0) return "Supply must be a positive number";
  if (form.memo && Buffer.byteLength(form.memo, "utf8") > 28) return "Memo exceeds 28 bytes";
  if (form.homeDomain && !DOMAIN_RE.test(form.homeDomain)) return "Invalid home domain format";
  return null;
}

interface Props {
  form: AssetCreatorForm;
  onChange: (patch: Partial<AssetCreatorForm>) => void;
  onBack: () => void;
  onNext: () => void;
}

export function Step2AssetConfig({ form, onChange, onBack, onNext }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const toml = generateTomlSnippet(form);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(toml);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleNext = () => {
    const err = validateStep2(form);
    if (err) { setError(err); return; }
    setError(null);
    onNext();
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="text-sm font-semibold">Asset Code <span className="text-destructive">*</span></Label>
          <Input
            placeholder="e.g. MYTOKEN"
            value={form.assetCode}
            onChange={(e) => onChange({ assetCode: e.target.value })}
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">1–12 alphanumeric chars. Case preserved on-chain.</p>
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-semibold">Token Name</Label>
          <Input
            placeholder="e.g. My Token (optional)"
            value={form.tokenName}
            onChange={(e) => onChange({ tokenName: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">Used in stellar.toml only — not stored on-chain.</p>
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-semibold">Initial Supply <span className="text-destructive">*</span></Label>
          <Input
            type="number"
            min="1"
            value={form.supply}
            onChange={(e) => onChange({ supply: parseFloat(e.target.value) || 0 })}
            className="font-mono"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-semibold">Home Domain</Label>
          <Input
            placeholder="e.g. example.com (optional)"
            value={form.homeDomain}
            onChange={(e) => onChange({ homeDomain: e.target.value.trim() })}
            className="font-mono text-xs"
          />
        </div>

        <div className="space-y-2 md:col-span-2">
          <Label className="text-sm font-semibold">Memo (on issuance tx)</Label>
          <Input
            placeholder="Optional — max 28 bytes"
            value={form.memo}
            onChange={(e) => onChange({ memo: e.target.value })}
          />
        </div>
      </div>

      {/* TOML preview */}
      {form.assetCode && form.issuerPublicKey && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-semibold">stellar.toml Snippet</Label>
            <Button type="button" variant="ghost" size="sm" onClick={handleCopy} className="h-7 text-xs gap-1">
              {copied ? <><Check className="h-3 w-3" /> Copied!</> : <><Copy className="h-3 w-3" /> Copy</>}
            </Button>
          </div>
          <pre className="bg-muted rounded-md p-3 text-xs font-mono overflow-x-auto whitespace-pre">{toml}</pre>
          {form.homeDomain && (
            <p className="text-xs text-muted-foreground">
              Host this at <code className="font-mono">https://{form.homeDomain}/.well-known/stellar.toml</code>
            </p>
          )}
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button variant="outline" onClick={onBack}>← Back</Button>
        <Button onClick={handleNext}>Next: Preflight →</Button>
      </div>
    </div>
  );
}
