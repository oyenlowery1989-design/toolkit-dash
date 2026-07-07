"use client";

import { useState, useEffect, useRef } from "react";
import { Keypair, StrKey } from "stellar-sdk";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Trash2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSettings, resolveHorizonUrl } from "@/lib/settings";
import { useActiveWallet } from "@/hooks/use-active-wallet";
import { useAutoSaveSigningKey } from "@/hooks/use-auto-save-signing-key";
import { WalletSelect } from "@/components/ui/wallet-select";
import { useAssetGroups } from "@/hooks/use-asset-groups";
import { shortAddr } from "@/lib/format";
import { ShortAddress } from "@/components/shared/ShortAddress";
import { Switch } from "@/components/ui/switch";
import {
  addTrustline,
  drainAndRemoveTrustline,
  fetchIssuerAuthRequired,
  fetchAccountXlmBalance,
  fetchAccountOffersForAsset,
  cancelOffersBatch,
  MAX_TRUST_LIMIT,
  type AccountOffer,
} from "@/lib/trustline-manager";

const STELLAR_EXPLORER: Record<string, string> = {
  public: "https://stellar.expert/explorer/public",
  testnet: "https://stellar.expert/explorer/testnet",
  futurenet: "https://stellar.expert/explorer/futurenet",
};

type Mode = "add" | "remove";

export function SingleTrustlineTab() {
  const { settings } = useSettings();
  const { activeWallet } = useActiveWallet();
  const { autoSave: autoSaveSigningKey } = useAutoSaveSigningKey();

  const { groups } = useAssetGroups();

  const [mode, setMode] = useState<Mode>("add");
  const [assetCode, setAssetCode] = useState("");
  const [issuer, setIssuer] = useState("");
  const [limit, setLimit] = useState(MAX_TRUST_LIMIT);
  const [secretKey, setSecretKey] = useState("");
  const [autoDelete, setAutoDelete] = useState(false);
  const [drainFirst, setDrainFirst] = useState(false);
  const [drainDestination, setDrainDestination] = useState("");
  const drainDestManuallyEdited = useRef(false);

  // Derived
  const effectiveSecret = activeWallet?.secretKey ?? secretKey.trim();
  let signingPubkey: string | null = null;
  try {
    if (effectiveSecret) signingPubkey = Keypair.fromSecret(effectiveSecret).publicKey();
  } catch {
    signingPubkey = null;
  }

  // Auto-populate drain destination from active wallet — re-fires whenever the
  // active wallet changes, unless the user has manually edited the field.
  useEffect(() => {
    if (activeWallet?.publicKey && !drainDestManuallyEdited.current) {
      setDrainDestination(activeWallet.publicKey);
    }
  }, [activeWallet?.publicKey]);

  // Warnings
  const [authRequired, setAuthRequired] = useState<boolean | null>(null);
  const [xlmBalance, setXlmBalance] = useState<number | null>(null);
  const [checkingWarnings, setCheckingWarnings] = useState(false);
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Offer detection (remove mode only)
  const [offers, setOffers] = useState<AccountOffer[]>([]);
  const [checkingOffers, setCheckingOffers] = useState(false);
  const [cancellingOffers, setCancellingOffers] = useState(false);
  const [offerCancelHashes, setOfferCancelHashes] = useState<string[]>([]);
  const offerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offerRequestIdRef = useRef(0);

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [deleteTxHash, setDeleteTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const issuerValid = StrKey.isValidEd25519PublicKey(issuer.trim());
  const drainDestValid = StrKey.isValidEd25519PublicKey(drainDestination.trim());
  const canSubmit =
    assetCode.trim().length > 0 &&
    issuerValid &&
    effectiveSecret.length > 0 &&
    !(mode === "remove" && drainFirst && !drainDestValid) &&
    !submitting &&
    !cancellingOffers;

  // Reset result when mode changes
  useEffect(() => {
    setTxHash(null);
    setError(null);
    setLogs([]);
    setOffers([]);
    setOfferCancelHashes([]);
  }, [mode]);

  // Preflight warnings (debounced)
  useEffect(() => {
    setAuthRequired(null);
    setXlmBalance(null);
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);

    if (!issuerValid && !signingPubkey) return;

    warningTimerRef.current = setTimeout(async () => {
      setCheckingWarnings(true);
      await Promise.all([
        issuerValid
          ? fetchIssuerAuthRequired(issuer.trim(), resolveHorizonUrl(settings)).then(setAuthRequired)
          : Promise.resolve(),
        signingPubkey
          ? fetchAccountXlmBalance(signingPubkey, resolveHorizonUrl(settings)).then(setXlmBalance)
          : Promise.resolve(),
      ]);
      setCheckingWarnings(false);
    }, 700);

    return () => {
      if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    };
  }, [issuer, issuerValid, signingPubkey, settings]);

  // Offer detection (remove mode, debounced)
  useEffect(() => {
    // Bump the request id immediately so any fetch already in flight from a
    // prior asset/issuer/mode is marked stale the moment inputs change again —
    // clearTimeout alone can't cancel a fetch that has already started.
    const requestId = ++offerRequestIdRef.current;

    if (offerTimerRef.current) clearTimeout(offerTimerRef.current);
    setOffers([]);

    if (mode !== "remove" || !signingPubkey || !issuerValid || !assetCode.trim()) return;

    offerTimerRef.current = setTimeout(async () => {
      setCheckingOffers(true);
      try {
        const found = await fetchAccountOffersForAsset(
          signingPubkey!,
          assetCode.trim(),
          issuer.trim(),
          resolveHorizonUrl(settings),
        );
        // Discard if a newer asset/issuer/account query has started since this fetch began
        if (requestId !== offerRequestIdRef.current) return;
        setOffers(found);
      } catch {
        // silently ignore — offer check is advisory
      } finally {
        if (requestId === offerRequestIdRef.current) setCheckingOffers(false);
      }
    }, 900);

    return () => {
      if (offerTimerRef.current) clearTimeout(offerTimerRef.current);
    };
  }, [mode, signingPubkey, assetCode, issuer, issuerValid, settings]);

  async function handleCancelOffers() {
    if (!effectiveSecret || offers.length === 0) return;
    setCancellingOffers(true);
    setLogs([]);
    try {
      const results = await cancelOffersBatch(
        offers,
        effectiveSecret,
        resolveHorizonUrl(settings),
        settings.network,
        (msg) => setLogs((prev) => [...prev, msg]),
      );
      setOfferCancelHashes(results.map((r) => r.txHash));
      setOffers([]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCancellingOffers(false);
    }
  }

  function handleLoadFromGroup(groupId: string) {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    if (group.assetCode) setAssetCode(group.assetCode);
    if (group.issuer) setIssuer(group.issuer);
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setTxHash(null);
    setDeleteTxHash(null);
    setError(null);
    setLogs([]);

    const horizonUrl = resolveHorizonUrl(settings);
    const code = assetCode.trim();
    const iss = issuer.trim();

    try {
      // Auto-cancel any remaining open offers before removing the trustline
      if (mode === "remove" && offers.length > 0) {
        setLogs((prev) => [...prev, `Auto-cancelling ${offers.length} open offer(s) first…`]);
        const cancelResults = await cancelOffersBatch(
          offers,
          effectiveSecret,
          horizonUrl,
          settings.network,
          (msg) => setLogs((prev) => [...prev, msg]),
        );
        setOfferCancelHashes(cancelResults.map((r) => r.txHash));
        setOffers([]);
      }

      let result: { txHash: string };

      if (mode === "remove" && drainFirst && drainDestination.trim()) {
        result = await drainAndRemoveTrustline({
          assetCode: code,
          issuer: iss,
          destination: drainDestination.trim(),
          signingSecret: effectiveSecret,
          horizonUrl,
          network: settings.network,
          onLog: (msg) => setLogs((prev) => [...prev, msg]),
        });
      } else {
        result = await addTrustline({
          assetCode: code,
          issuer: iss,
          limit: mode === "remove" ? "0" : (limit.trim() || MAX_TRUST_LIMIT),
          remove: mode === "remove",
          signingSecret: effectiveSecret,
          horizonUrl,
          network: settings.network,
          onLog: (msg) => setLogs((prev) => [...prev, msg]),
        });
      }
      setTxHash(result.txHash);
      if (!activeWallet) {
        try { autoSaveSigningKey(Keypair.fromSecret(effectiveSecret).publicKey()); } catch { /* invalid key */ }
      }

      // Auto-delete: immediately remove the trustline after adding
      if (mode === "add" && autoDelete) {
        const deleteResult = await addTrustline({
          assetCode: code,
          issuer: iss,
          remove: true,
          signingSecret: effectiveSecret,
          horizonUrl,
          network: settings.network,
          onLog: (msg) => setLogs((prev) => [...prev, msg]),
        });
        setDeleteTxHash(deleteResult.txHash);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  const explorerBase = STELLAR_EXPLORER[settings.network] ?? STELLAR_EXPLORER.public;
  const lowBalance = xlmBalance !== null && xlmBalance < 2;
  const isRemove = mode === "remove";

  return (
    <div className="space-y-6 max-w-xl">
      {/* Mode toggle */}
      <div className="flex gap-2">
        <Button
          variant={mode === "add" ? "default" : "outline"}
          size="sm"
          onClick={() => setMode("add")}
        >
          Add Trustline
        </Button>
        <Button
          variant={mode === "remove" ? "destructive" : "outline"}
          size="sm"
          onClick={() => setMode("remove")}
          className="gap-1.5"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Remove Trustline
        </Button>
      </div>

      {/* Remove mode — drain option */}
      {isRemove && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <span className="text-sm font-medium">
                Send all balance to destination first
              </span>
              <p className="text-xs text-muted-foreground">
                For custom assets: sends full balance then removes trustline in one tx.
                For XLM: uses <strong>Account Merge</strong> — sends all XLM and closes the account.
              </p>
            </div>
            <Switch checked={drainFirst} onCheckedChange={setDrainFirst} />
          </div>

          {drainFirst && (
            <div>
              <Label htmlFor="st-drain-dest">Send balance to</Label>
              <p className="text-xs text-muted-foreground mb-1.5">
                The full asset balance will be sent to this address before the trustline is removed.
                {activeWallet && activeWallet.publicKey === drainDestination && (
                  <> Currently matches your connected wallet (<span className="font-mono">{shortAddr(activeWallet.publicKey)}</span>).</>
                )}
                {activeWallet && activeWallet.publicKey !== drainDestination && (
                  <> This does <strong>not</strong> match your connected wallet — double-check before submitting.</>
                )}
              </p>
              <Input
                id="st-drain-dest"
                value={drainDestination}
                onChange={(e) => {
                  drainDestManuallyEdited.current = true;
                  setDrainDestination(e.target.value);
                }}
                placeholder="G…"
                className={`font-mono text-xs ${
                  drainDestination && !StrKey.isValidEd25519PublicKey(drainDestination)
                    ? "border-destructive"
                    : ""
                }`}
              />
              {drainDestination && !StrKey.isValidEd25519PublicKey(drainDestination) && (
                <p className="text-xs text-destructive mt-1">Invalid public key</p>
              )}
              {drainDestValid && (
                <div className="mt-1">
                  <ShortAddress address={drainDestination.trim()} network={settings.network} />
                </div>
              )}
            </div>
          )}

          {!drainFirst && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-destructive/10 border border-destructive/30 text-sm">
              <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              <span className="text-destructive">
                Account must have <strong>zero balance</strong> and no open sell offers before
                removal will succeed.
              </span>
            </div>
          )}
        </div>
      )}

      {/* Load from group */}
      {groups.length > 0 && (
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">Load from Asset Group</Label>
          <Select onValueChange={handleLoadFromGroup}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select group…" />
            </SelectTrigger>
            <SelectContent>
              {groups.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name}
                  {g.assetCode ? ` (${g.assetCode})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Asset fields */}
      <div className={`grid gap-4 ${isRemove ? "grid-cols-1" : "grid-cols-2"}`}>
        <div>
          <Label htmlFor="st-code">Asset Code</Label>
          <Input
            id="st-code"
            value={assetCode}
            onChange={(e) => setAssetCode(e.target.value)}
            placeholder="e.g. USDC"
            className="mt-1"
          />
        </div>
        {!isRemove && (
          <div>
            <Label htmlFor="st-limit">Trust Limit</Label>
            <Input
              id="st-limit"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              placeholder={MAX_TRUST_LIMIT}
              className="mt-1 font-mono text-xs"
            />
          </div>
        )}
      </div>

      {/* Auto-delete toggle (add mode only) */}
      {!isRemove && (
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-0.5">
            <span className="text-sm font-medium">
              Auto-delete after adding
            </span>
            <p className="text-xs text-muted-foreground">
              Immediately removes the trustline after it is confirmed — useful for testing
              eligibility without keeping the trustline open.
            </p>
          </div>
          <Switch checked={autoDelete} onCheckedChange={setAutoDelete} />
        </div>
      )}

      <div>
        <Label htmlFor="st-issuer">Issuer Public Key</Label>
        <Input
          id="st-issuer"
          value={issuer}
          onChange={(e) => setIssuer(e.target.value)}
          placeholder="G…"
          className={`mt-1 font-mono text-xs ${issuer && !issuerValid ? "border-destructive" : ""}`}
        />
        {issuer && !issuerValid && (
          <p className="text-xs text-destructive mt-1">Invalid public key</p>
        )}
      </div>

      {/* Signing key / wallet */}
      {activeWallet ? (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-green-500/10 border border-green-500/30 text-sm">
          <Wallet className="h-4 w-4 text-green-500" />
          <span className="text-green-600 dark:text-green-400 font-medium">
            {activeWallet.name}
          </span>
          <span className="text-muted-foreground font-mono text-xs">
            {shortAddr(activeWallet.publicKey)}
          </span>
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="st-secret">Signing Secret Key</Label>
          <div className="flex gap-2">
            <Input
              id="st-secret"
              type="password"
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
              placeholder="S…"
              className="font-mono text-xs"
            />
            <WalletSelect
              currentValue={secretKey}
              onPick={(w) => setSecretKey(w.secretKey)}
              triggerClassName="w-36 shrink-0 border shadow-sm"
            />
          </div>
          {signingPubkey && (
            <p className="text-xs text-muted-foreground font-mono">
              → {shortAddr(signingPubkey)}
            </p>
          )}
        </div>
      )}

      {/* Preflight warnings (add mode only) */}
      {!isRemove && (
        <>
          {checkingWarnings && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Checking preflight…
            </div>
          )}
          {authRequired === true && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-amber-500/10 border border-amber-500/30 text-sm">
              <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <span className="text-amber-700 dark:text-amber-400">
                This asset has <strong>AUTH_REQUIRED</strong> — the issuer must approve your
                trustline after you submit.
              </span>
            </div>
          )}
          {lowBalance && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-amber-500/10 border border-amber-500/30 text-sm">
              <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <span className="text-amber-700 dark:text-amber-400">
                Signing account has only{" "}
                <strong>{xlmBalance?.toFixed(2)} XLM</strong> — each trustline costs
                0.5 XLM reserve.
              </span>
            </div>
          )}
        </>
      )}

      {/* Open offers panel (remove mode) */}
      {isRemove && (
        <>
          {checkingOffers && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Checking for open offers…
            </div>
          )}
          {offers.length > 0 && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 space-y-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                    {offers.length} open offer{offers.length !== 1 ? "s" : ""} — must be cancelled before removal
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Trustline removal fails if any open offers reference this asset.
                  </p>
                </div>
              </div>
              <div className="overflow-auto rounded border border-border">
                <table className="text-xs w-full">
                  <thead>
                    <tr className="bg-muted/50 border-b border-border">
                      <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">ID</th>
                      <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">Selling</th>
                      <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">Buying</th>
                      <th className="text-right px-2 py-1.5 font-medium text-muted-foreground">Amount</th>
                      <th className="text-right px-2 py-1.5 font-medium text-muted-foreground">Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {offers.map((o) => (
                      <tr key={o.id} className="border-b border-border last:border-0">
                        <td className="px-2 py-1.5 font-mono text-muted-foreground">#{o.id}</td>
                        <td className="px-2 py-1.5 font-mono">{o.sellingLabel}</td>
                        <td className="px-2 py-1.5 font-mono">{o.buyingLabel}</td>
                        <td className="px-2 py-1.5 text-right">{o.amount}</td>
                        <td className="px-2 py-1.5 text-right">{o.price}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancelOffers}
                disabled={cancellingOffers || submitting || !effectiveSecret}
                className="border-amber-500/50 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10"
              >
                {cancellingOffers ? (
                  <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Cancelling…</>
                ) : (
                  <>Cancel {offers.length} offer{offers.length !== 1 ? "s" : ""}</>
                )}
              </Button>
            </div>
          )}
          {offerCancelHashes.length > 0 && (
            <div className="space-y-1">
              {offerCancelHashes.map((h) => (
                <div key={h} className="flex items-center gap-1.5 text-xs">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                  <span className="text-muted-foreground">Offers cancelled —</span>
                  <a
                    href={`${explorerBase}/tx/${h}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-primary hover:underline flex items-center gap-0.5"
                  >
                    {h.slice(0, 12)}…
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Submit */}
      <Button
        onClick={handleSubmit}
        disabled={!canSubmit}
        variant={isRemove ? "destructive" : "default"}
        className="w-full"
      >
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Submitting…
          </>
        ) : isRemove ? (
          <>
            <Trash2 className="h-4 w-4 mr-2" />
            Remove Trustline
          </>
        ) : (
          "Add Trustline"
        )}
      </Button>

      {/* Logs */}
      {logs.length > 0 && (
        <div className="rounded-md bg-muted p-3 space-y-1 text-xs font-mono text-muted-foreground">
          {logs.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}

      {/* Success */}
      {txHash && (
        <div className="flex items-start gap-2 px-3 py-3 rounded-md bg-green-500/10 border border-green-500/30 text-sm">
          <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
          <div className="space-y-1.5">
            <p className="text-green-700 dark:text-green-400 font-medium">
              Trustline {isRemove ? "removed" : "added"} successfully
            </p>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">{isRemove ? "Remove tx" : "Add tx"}:</span>
              <a
                href={`${explorerBase}/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-mono text-primary hover:underline flex items-center gap-1"
              >
                {txHash.slice(0, 16)}…{txHash.slice(-8)}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            {deleteTxHash && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Delete tx:</span>
                <a
                  href={`${explorerBase}/tx/${deleteTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-mono text-primary hover:underline flex items-center gap-1"
                >
                  {deleteTxHash.slice(0, 16)}…{deleteTxHash.slice(-8)}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-destructive/10 border border-destructive/30 text-sm">
          <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
          <span className="text-destructive break-all">{error}</span>
        </div>
      )}
    </div>
  );
}
