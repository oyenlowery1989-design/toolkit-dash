"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { useSettings, resolveHorizonUrl } from "@/lib/settings";
import {
  AUTH_FLAGS,
  fetchIssuerFlags,
  setIssuerFlag,
  type IssuerFlags,
} from "@/lib/asset-manager";

interface FlagDef {
  key: keyof IssuerFlags;
  label: string;
  value: number;
  description: string;
  irreversible?: boolean;
  requires?: keyof IssuerFlags;
}

const FLAG_DEFS: FlagDef[] = [
  {
    key: "authRequired",
    label: "AUTH_REQUIRED",
    value: AUTH_FLAGS.REQUIRED,
    description:
      "New accounts must be pre-approved by the issuer before they can hold this asset.",
  },
  {
    key: "authRevocable",
    label: "AUTH_REVOCABLE",
    value: AUTH_FLAGS.REVOCABLE,
    description:
      "Issuer can freeze or deauthorize any trustline at any time. Required before you can freeze holders.",
  },
  {
    key: "authClawbackEnabled",
    label: "AUTH_CLAWBACK_ENABLED",
    value: AUTH_FLAGS.CLAWBACK_ENABLED,
    description:
      "Issuer can pull tokens back from any holder. Requires AUTH_REVOCABLE to be set first.",
    requires: "authRevocable",
  },
  {
    key: "authImmutable",
    label: "AUTH_IMMUTABLE",
    value: AUTH_FLAGS.IMMUTABLE,
    description:
      "Permanently locks all flags. No further changes to account settings will ever be possible.",
    irreversible: true,
  },
];

interface Props {
  issuer: string;
  secretKey: string;
}

export function FlagsTab({ issuer, secretKey }: Props) {
  const { settings } = useSettings();
  const horizonUrl = resolveHorizonUrl(settings);

  const [flags, setFlags] = useState<IssuerFlags | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingFlag, setPendingFlag] = useState<number | null>(null);
  const [flagError, setFlagError] = useState<string | null>(null);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);

  const explorerBase =
    settings.network === "public"
      ? "https://stellar.expert/explorer/public"
      : settings.network === "testnet"
        ? "https://stellar.expert/explorer/testnet"
        : null;

  async function handleLoadFlags() {
    setLoading(true);
    setLoadError(null);
    setFlags(null);
    setLastTxHash(null);
    setFlagError(null);
    try {
      const result = await fetchIssuerFlags(horizonUrl, issuer);
      setFlags(result);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleFlag(flagDef: FlagDef, enable: boolean) {
    if (!secretKey || !flags) return;
    setPendingFlag(flagDef.value);
    setFlagError(null);
    setLastTxHash(null);
    try {
      const hash = await setIssuerFlag(
        horizonUrl,
        secretKey,
        flagDef.value,
        enable,
        settings.network,
      );
      setLastTxHash(hash);
      const updated = await fetchIssuerFlags(horizonUrl, issuer);
      setFlags(updated);
    } catch (e) {
      setFlagError(e instanceof Error ? e.message : String(e));
    } finally {
      setPendingFlag(null);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            Issuer Flags
          </CardTitle>
          <CardDescription>
            Load the current flags for your issuer account, then enable or
            disable each one with a single transaction.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={handleLoadFlags} disabled={loading}>
            {loading ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading…</>
            ) : flags ? (
              "Reload"
            ) : (
              "Load Flags"
            )}
          </Button>
          {loadError && (
            <p className="mt-2 text-xs text-destructive">{loadError}</p>
          )}
          {!secretKey && (
            <p className="mt-2 text-xs text-muted-foreground">
              Enter the issuer secret key above to enable flag changes.
            </p>
          )}
        </CardContent>
      </Card>

      {flags && (
        <Card>
          <CardHeader>
            <CardTitle>Current Flags</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {FLAG_DEFS.map((def) => {
              const isEnabled = flags[def.key];
              const isPending = pendingFlag === def.value;
              const requiresMet = !def.requires || flags[def.requires];
              const canToggle =
                !!secretKey && !flags.authImmutable && !isPending;

              return (
                <div
                  key={def.key}
                  className={`rounded-lg border p-3 ${
                    def.irreversible
                      ? "border-destructive/30 bg-destructive/5"
                      : isEnabled
                        ? "border-green-500/30 bg-green-500/5"
                        : "border-muted"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <code className="text-sm font-semibold">{def.label}</code>
                        {isEnabled && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-medium text-green-500">
                            <CheckCircle2 className="h-3 w-3" />
                            ON
                          </span>
                        )}
                        {def.irreversible && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-medium text-destructive">
                            <AlertTriangle className="h-3 w-3" />
                            IRREVERSIBLE
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {def.description}
                      </p>
                      {def.requires && !requiresMet && (
                        <p className="text-xs text-amber-500">
                          ⚠ Requires AUTH_REVOCABLE to be enabled first.
                        </p>
                      )}
                    </div>

                    <div className="shrink-0">
                      {isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : flags.authImmutable && def.key !== "authImmutable" ? (
                        <span className="text-xs text-muted-foreground">Locked</span>
                      ) : isEnabled ? (
                        !def.irreversible && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            disabled={!canToggle}
                            onClick={() => handleToggleFlag(def, false)}
                          >
                            Disable
                          </Button>
                        )
                      ) : (
                        <Button
                          size="sm"
                          variant={def.irreversible ? "destructive" : "default"}
                          className="h-7 text-xs"
                          disabled={!canToggle || !requiresMet}
                          onClick={() => handleToggleFlag(def, true)}
                        >
                          Enable
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {flagError && (
              <p className="text-sm text-destructive">{flagError}</p>
            )}

            {lastTxHash && (
              <div className="flex items-center gap-2 text-xs text-green-500">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>Flag updated.</span>
                {explorerBase && (
                  <a
                    href={`${explorerBase}/tx/${lastTxHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-0.5 underline underline-offset-2"
                  >
                    View TX
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
