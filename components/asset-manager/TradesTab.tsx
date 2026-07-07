"use client";

import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Keypair } from "stellar-sdk";
import { useSettings, resolveHorizonUrl } from "@/lib/settings";
import { useActiveWallet } from "@/hooks/use-active-wallet";
import { shortAddr } from "@/lib/format";
import { ShortAddress } from "@/components/shared/ShortAddress";
import {
  fetchMyOffers,
  createSellOffer,
  deleteOffer,
  createBatchOffers,
  type MyOffer,
  type BatchOfferResult,
  type BatchMode,
  type OfferSide,
} from "@/lib/asset-manager";

interface Props {
  assetCode: string;
  issuer: string;
}

export function TradesTab({ assetCode, issuer }: Props) {
  const { settings } = useSettings();
  const { activeWallet } = useActiveWallet();
  const horizonUrl = resolveHorizonUrl(settings);

  const [distribSecretKey, setDistribSecretKey] = useState("");

  const effectiveSecretKey = activeWallet?.secretKey ?? distribSecretKey.trim();
  const signerPublicKey = activeWallet?.publicKey ?? (() => {
    try {
      return effectiveSecretKey ? Keypair.fromSecret(effectiveSecretKey).publicKey() : "";
    } catch { return ""; }
  })();

  const [offers, setOffers] = useState<MyOffer[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Create form
  const [amount, setAmount] = useState("");
  const [price, setPrice] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createHash, setCreateHash] = useState<string | null>(null);

  // Per-offer delete state
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteResults, setDeleteResults] = useState<
    Record<string, { hash?: string; error?: string }>
  >({});

  // Batch offers
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchSide, setBatchSide] = useState<OfferSide>("sell");
  const [batchMode, setBatchMode] = useState<BatchMode>("repeat");
  const [batchCount, setBatchCount] = useState("3");
  const [batchAmount, setBatchAmount] = useState("");
  const [batchPriceFrom, setBatchPriceFrom] = useState("");
  const [batchPriceTo, setBatchPriceTo] = useState("");
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchResults, setBatchResults] = useState<BatchOfferResult[]>([]);
  const [batchDone, setBatchDone] = useState(0);
  const batchAbortRef = useRef<AbortController | null>(null);

  const explorerBase =
    settings.network === "public"
      ? "https://stellar.expert/explorer/public"
      : settings.network === "testnet"
        ? "https://stellar.expert/explorer/testnet"
        : null;

  async function handleBatch() {
    if (!effectiveSecretKey) return;
    const n = Math.min(50, Math.max(1, parseInt(batchCount) || 1));
    const confirmed = window.confirm(
      `Place ${n} ${batchSide.toUpperCase()} offer(s) for ${assetCode}, ${batchAmount} ${assetCode} each, price ${batchPriceFrom}${batchMode === "ladder" ? ` → ${batchPriceTo}` : ""} XLM per ${assetCode}?`
    );
    if (!confirmed) return;
    batchAbortRef.current?.abort();
    batchAbortRef.current = new AbortController();
    setBatchResults([]);
    setBatchDone(0);
    setBatchRunning(true);
    await createBatchOffers({
      horizonUrl,
      secretKey: effectiveSecretKey,
      assetCode,
      issuerAddress: issuer,
      side: batchSide,
      mode: batchMode,
      count: n,
      amount: batchAmount,
      priceFrom: batchPriceFrom,
      priceTo: batchMode === "ladder" ? batchPriceTo : undefined,
      network: settings.network,
      signal: batchAbortRef.current.signal,
      onProgress: (done, _total, last) => {
        setBatchDone(done);
        setBatchResults((prev) => [...prev, last]);
      },
    });
    setBatchRunning(false);
  }

  function handleBatchStop() {
    batchAbortRef.current?.abort();
    setBatchRunning(false);
  }

  const canBatch =
    !!effectiveSecretKey &&
    parseFloat(batchAmount) > 0 &&
    parseFloat(batchPriceFrom) > 0 &&
    parseInt(batchCount) > 0 &&
    (batchMode === "repeat" || parseFloat(batchPriceTo) > 0);

  // Preview prices for ladder/repeat
  const previewPrices: number[] = (() => {
    const n = Math.min(50, Math.max(1, parseInt(batchCount) || 1));
    const from = parseFloat(batchPriceFrom) || 0;
    const to = batchMode === "ladder" ? (parseFloat(batchPriceTo) || from) : from;
    return Array.from({ length: Math.min(n, 5) }, (_, i) =>
      n === 1 ? from : from + (to - from) * (i / (n - 1))
    );
  })();

  async function handleLoad() {
    setLoading(true);
    setLoadError(null);
    setDeleteResults({});
    try {
      const result = await fetchMyOffers(horizonUrl, signerPublicKey, assetCode, issuer);
      setOffers(result);
      setLoaded(true);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    if (!effectiveSecretKey || !amount || !price) return;
    const confirmed = window.confirm(
      `Place a SELL offer: ${parseFloat(amount).toLocaleString()} ${assetCode} for ${(parseFloat(amount) * parseFloat(price)).toLocaleString(undefined, { maximumFractionDigits: 7 })} XLM total (price ${price} XLM per ${assetCode})?`
    );
    if (!confirmed) return;
    setCreating(true);
    setCreateError(null);
    setCreateHash(null);
    try {
      const hash = await createSellOffer(
        horizonUrl,
        effectiveSecretKey,
        assetCode,
        issuer,
        amount,
        price,
        settings.network,
      );
      setCreateHash(hash);
      setAmount("");
      setPrice("");
      // Reload offers
      const updated = await fetchMyOffers(horizonUrl, signerPublicKey, assetCode, issuer);
      setOffers(updated);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(offer: MyOffer) {
    if (!effectiveSecretKey) return;
    const confirmed = window.confirm(
      `Cancel offer #${offer.id} (${offer.side === "sell" ? "SELL" : "BUY"}, ${offer.amount} ${assetCode} @ ${offer.price} XLM)?`
    );
    if (!confirmed) return;
    setDeletingId(offer.id);
    try {
      const hash = await deleteOffer(
        horizonUrl,
        effectiveSecretKey,
        assetCode,
        issuer,
        offer.id,
        offer.price,
        offer.side,
        settings.network,
      );
      setDeleteResults((prev) => ({ ...prev, [offer.id]: { hash } }));
      setOffers((prev) => prev.filter((o) => o.id !== offer.id));
    } catch (e) {
      setDeleteResults((prev) => ({
        ...prev,
        [offer.id]: { error: e instanceof Error ? e.message : String(e) },
      }));
    } finally {
      setDeletingId(null);
    }
  }

  const canCreate =
    !!effectiveSecretKey &&
    amount.trim().length > 0 &&
    parseFloat(amount) > 0 &&
    price.trim().length > 0 &&
    parseFloat(price) > 0;

  // Reset stale offer rows whenever the asset identity changes — prevents
  // handleDelete from firing a cancel for the previous asset's offer id/price
  // against the newly-selected assetCode/issuer.
  useEffect(() => {
    setOffers([]);
    setLoaded(false);
    setLoadError(null);
    setDeleteResults({});
  }, [assetCode, issuer]);

  // Only one write action (place / batch / cancel) may be in flight at a
  // time — they all sign with the same distributor account and would
  // otherwise race its sequence number.
  const anyActionInFlight = creating || batchRunning || !!deletingId;

  return (
    <div className="space-y-6">
      {/* Distributor signing key */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Distributor Account</CardTitle>
          <CardDescription>
            Sell offers are placed by the distributor — the account that holds
            the tokens, not the issuer.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {activeWallet ? (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Signing with:</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-green-500/30 bg-green-500/10 px-2.5 py-0.5 font-medium text-green-500">
                {activeWallet.name} · {shortAddr(activeWallet.publicKey)}
              </span>
            </div>
          ) : (
            <div>
              <Label htmlFor="trades-distrib-sk">Distributor Secret Key</Label>
              <Input
                id="trades-distrib-sk"
                type="password"
                placeholder="S…"
                value={distribSecretKey}
                onChange={(e) => setDistribSecretKey(e.target.value)}
                className="mt-1 font-mono text-xs"
              />
              {signerPublicKey && (
                <p className="mt-1 text-xs text-muted-foreground font-mono">
                  <ShortAddress address={signerPublicKey} network={settings.network} />
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create offer */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            Place Sell Offer
          </CardTitle>
          <CardDescription>
            Sell {assetCode} for XLM on the Stellar DEX. The offer stays open
            until filled or cancelled.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="trades-amount">
                Amount{" "}
                <span className="text-muted-foreground">({assetCode})</span>
              </Label>
              <Input
                id="trades-amount"
                placeholder="e.g. 1000"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-1 font-mono"
                type="number"
                min="0"
                step="any"
              />
            </div>
            <div>
              <Label htmlFor="trades-price">
                Price{" "}
                <span className="text-muted-foreground">(XLM per {assetCode})</span>
              </Label>
              <Input
                id="trades-price"
                placeholder="e.g. 0.5"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="mt-1 font-mono"
                type="number"
                min="0"
                step="any"
              />
            </div>
          </div>

          {amount && price && parseFloat(amount) > 0 && parseFloat(price) > 0 && (
            <p className="text-xs text-muted-foreground">
              Selling{" "}
              <span className="font-medium text-foreground">
                {parseFloat(amount).toLocaleString()} {assetCode}
              </span>{" "}
              for{" "}
              <span className="font-medium text-foreground">
                {(parseFloat(amount) * parseFloat(price)).toLocaleString(undefined, {
                  maximumFractionDigits: 7,
                })}{" "}
                XLM
              </span>{" "}
              total
            </p>
          )}

          {!effectiveSecretKey && (
            <p className="text-xs text-muted-foreground">
              Enter the distributor secret key above to place offers.
            </p>
          )}

          <Button onClick={handleCreate} disabled={!canCreate || anyActionInFlight}>
            {creating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Placing…
              </>
            ) : (
              <>
                <Plus className="mr-2 h-4 w-4" />
                Place Offer
              </>
            )}
          </Button>

          {createError && (
            <p className="text-sm text-destructive">{createError}</p>
          )}

          {createHash && (
            <div className="flex items-center gap-2 text-xs text-green-500">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>Offer placed.</span>
              {explorerBase && (
                <a
                  href={`${explorerBase}/tx/${createHash}`}
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

      {/* Batch offers */}
      <Card>
        <CardHeader className="pb-3">
          <Button
            variant="ghost"
            onClick={() => setBatchOpen((v) => !v)}
            className="flex h-auto w-full items-center justify-between gap-2 p-0 text-left font-normal hover:bg-transparent"
          >
            <div className="flex items-center gap-2">
              <Layers className="h-5 w-5" />
              <div>
                <CardTitle className="text-base">Batch Offers</CardTitle>
                <CardDescription className="mt-0.5">
                  Place multiple identical offers or a price ladder at once.
                </CardDescription>
              </div>
            </div>
            {batchOpen ? <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
          </Button>
        </CardHeader>

        {batchOpen && (
          <CardContent className="space-y-4">
            {/* Side + Mode toggles */}
            <div className="flex flex-wrap gap-4">
              <div>
                <Label className="text-xs mb-1 block">Side</Label>
                <div className="flex gap-1">
                  {(["sell", "buy"] as OfferSide[]).map((s) => (
                    <Button
                      key={s}
                      variant="ghost"
                      onClick={() => setBatchSide(s)}
                      className={`h-auto rounded-full border px-3 py-0.5 text-xs font-medium transition-colors ${
                        batchSide === s
                          ? s === "sell"
                            ? "border-destructive bg-destructive text-destructive-foreground hover:bg-destructive hover:text-destructive-foreground"
                            : "border-green-500 bg-green-500 text-white hover:bg-green-500 hover:text-white"
                          : "border-muted-foreground/30 text-muted-foreground hover:border-foreground hover:bg-transparent hover:text-muted-foreground"
                      }`}
                    >
                      {s === "sell" ? "Sell" : "Buy"}
                    </Button>
                  ))}
                </div>
              </div>
              <div>
                <Label className="text-xs mb-1 block">Mode</Label>
                <div className="flex gap-1">
                  {(["repeat", "ladder"] as BatchMode[]).map((m) => (
                    <Button
                      key={m}
                      variant="ghost"
                      onClick={() => setBatchMode(m)}
                      className={`h-auto rounded-full border px-3 py-0.5 text-xs font-medium transition-colors ${
                        batchMode === m
                          ? "border-primary bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
                          : "border-muted-foreground/30 text-muted-foreground hover:border-foreground hover:bg-transparent hover:text-muted-foreground"
                      }`}
                    >
                      {m === "repeat" ? "Repeat" : "Ladder"}
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="batch-count">Number of Offers</Label>
                <Input
                  id="batch-count"
                  type="number"
                  min="1"
                  max="50"
                  value={batchCount}
                  onChange={(e) => setBatchCount(e.target.value)}
                  className="mt-1 font-mono"
                />
              </div>
              <div>
                <Label htmlFor="batch-amount">
                  Amount per Offer{" "}
                  <span className="text-muted-foreground">({assetCode})</span>
                </Label>
                <Input
                  id="batch-amount"
                  type="number"
                  min="0"
                  step="any"
                  placeholder="e.g. 100"
                  value={batchAmount}
                  onChange={(e) => setBatchAmount(e.target.value)}
                  className="mt-1 font-mono"
                />
                {batchSide === "buy" && (
                  <p className="text-xs text-muted-foreground mt-1">
                    This is how many {assetCode} tokens you want to acquire — not an XLM budget.
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="batch-price-from">
                  {batchMode === "ladder" ? "Price From (XLM)" : "Price (XLM)"}
                </Label>
                <Input
                  id="batch-price-from"
                  type="number"
                  min="0"
                  step="any"
                  placeholder="e.g. 0.50"
                  value={batchPriceFrom}
                  onChange={(e) => setBatchPriceFrom(e.target.value)}
                  className="mt-1 font-mono"
                />
              </div>
              {batchMode === "ladder" && (
                <div>
                  <Label htmlFor="batch-price-to">Price To (XLM)</Label>
                  <Input
                    id="batch-price-to"
                    type="number"
                    min="0"
                    step="any"
                    placeholder="e.g. 1.00"
                    value={batchPriceTo}
                    onChange={(e) => setBatchPriceTo(e.target.value)}
                    className="mt-1 font-mono"
                  />
                </div>
              )}
            </div>

            {/* Price preview */}
            {parseFloat(batchPriceFrom) > 0 && parseInt(batchCount) > 0 && (
              <div className="rounded-md border bg-muted/30 p-2 text-xs">
                <span className="text-muted-foreground">Price preview: </span>
                {previewPrices.map((p, i) => (
                  <span key={i} className="font-mono">
                    {p.toFixed(7)}{i < previewPrices.length - 1 ? " → " : ""}
                  </span>
                ))}
                {parseInt(batchCount) > 5 && <span className="text-muted-foreground"> … ({batchCount} total)</span>}
              </div>
            )}

            {batchSide === "buy" && parseFloat(batchAmount) > 0 && parseFloat(batchPriceFrom) > 0 && (
              <p className="text-xs text-muted-foreground">
                Buying up to{" "}
                <span className="font-medium text-foreground">
                  {parseFloat(batchAmount).toLocaleString()} {assetCode}
                </span>{" "}
                per offer — up to{" "}
                <span className="font-medium text-foreground">
                  {(
                    parseFloat(batchAmount) *
                    (batchMode === "ladder"
                      ? Math.max(parseFloat(batchPriceFrom) || 0, parseFloat(batchPriceTo) || 0)
                      : parseFloat(batchPriceFrom))
                  ).toLocaleString(undefined, { maximumFractionDigits: 7 })}{" "}
                  XLM
                </span>{" "}
                real XLM committed per offer at the highest price in this batch.
              </p>
            )}

            <div className="flex gap-2">
              {!batchRunning ? (
                <Button onClick={handleBatch} disabled={!canBatch || anyActionInFlight}>
                  <Layers className="mr-2 h-4 w-4" />
                  Place {Math.min(50, Math.max(1, parseInt(batchCount) || 1))} Offers
                </Button>
              ) : (
                <Button variant="outline" onClick={handleBatchStop}>
                  Stop
                </Button>
              )}
            </div>

            {/* Batch progress */}
            {batchResults.length > 0 && (
              <div className="space-y-1 rounded-md border p-2">
                {batchRunning && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {batchDone} / {batchCount} placed…
                  </div>
                )}
                {batchResults.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    {r.error ? (
                      <XCircle className="h-3 w-3 shrink-0 text-destructive" />
                    ) : (
                      <CheckCircle2 className="h-3 w-3 shrink-0 text-green-500" />
                    )}
                    <span className="font-mono text-muted-foreground w-24 shrink-0">
                      {r.price} XLM
                    </span>
                    <span className="font-mono text-muted-foreground w-24 shrink-0">
                      {parseFloat(r.amount).toLocaleString()} {assetCode}
                    </span>
                    {!r.error && (
                      <span className="font-mono text-muted-foreground w-28 shrink-0">
                        {(parseFloat(r.amount) * parseFloat(r.price)).toLocaleString(undefined, {
                          maximumFractionDigits: 7,
                        })}{" "}
                        XLM total
                      </span>
                    )}
                    {r.error ? (
                      <span className="text-destructive truncate" title={r.error}>{r.error}</span>
                    ) : explorerBase && r.hash ? (
                      <a
                        href={`${explorerBase}/tx/${r.hash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-0.5 text-green-500 underline underline-offset-2"
                      >
                        TX <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* Open offers */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>My Open Offers</CardTitle>
              <CardDescription>
                Open sell offers from{" "}
                <ShortAddress address={signerPublicKey} network={settings.network} />{" "}
                for {assetCode}.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleLoad}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <RefreshCw className="mr-2 h-3.5 w-3.5" />
                  {loaded ? "Refresh" : "Load"}
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loadError && (
            <p className="text-sm text-destructive">{loadError}</p>
          )}

          {loaded && offers.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No open sell offers found for this account and asset.
            </p>
          )}

          {offers.length > 0 && (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="px-3 py-2 text-left">Offer ID</th>
                    <th className="px-3 py-2 text-left">Side</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2 text-right">Price (XLM)</th>
                    <th className="px-3 py-2 text-right">Total XLM</th>
                    <th className="px-3 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {offers.map((offer) => {
                    const isDeleting = deletingId === offer.id;
                    const result = deleteResults[offer.id];
                    const total = parseFloat(offer.amount) * parseFloat(offer.price);

                    return (
                      <tr key={offer.id} className="border-b last:border-0">
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                          #{offer.id}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                            offer.side === "sell"
                              ? "border-destructive/30 bg-destructive/10 text-destructive"
                              : "border-green-500/30 bg-green-500/10 text-green-500"
                          }`}>
                            {offer.side === "sell" ? "SELL" : "BUY"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {parseFloat(offer.amount).toLocaleString(undefined, {
                            maximumFractionDigits: 7,
                          })}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium">
                          {parseFloat(offer.price).toFixed(7)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {total.toLocaleString(undefined, { maximumFractionDigits: 7 })}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {isDeleting ? (
                              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                            ) : result?.hash ? (
                              <span className="flex items-center gap-1 text-[10px] text-green-500">
                                <CheckCircle2 className="h-3 w-3" />
                                Deleted
                                {explorerBase && (
                                  <a
                                    href={`${explorerBase}/tx/${result.hash}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                )}
                              </span>
                            ) : result?.error ? (
                              <span
                                className="text-[10px] text-destructive"
                                title={result.error}
                              >
                                Error
                              </span>
                            ) : (
                              <Button
                                variant="ghost"
                                onClick={() => handleDelete(offer)}
                                disabled={!effectiveSecretKey || anyActionInFlight}
                                className="h-auto inline-flex items-center gap-1 rounded border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive hover:bg-destructive/20 hover:text-destructive disabled:opacity-40"
                              >
                                <Trash2 className="h-3 w-3" />
                                Cancel
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
