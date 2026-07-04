"use client";

import { useRef, useState } from "react";
import {
  CheckCircle2,
  Download,
  ExternalLink,
  Loader2,
  Lock,
} from "lucide-react";
import { StrKey } from "stellar-sdk";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSettings, resolveHorizonUrl } from "@/lib/settings";
import { useAssetGroups } from "@/hooks/use-asset-groups";
import { useActiveWallet } from "@/hooks/use-active-wallet";
import { shortAddr } from "@/lib/format";
import { ShortAddress } from "@/components/asset-lookup";
import { downloadCSV } from "@/lib/csv-export";
import {
  fetchSellOffers,
  setTrustlineAuthorization,
  type SellOffer,
} from "@/lib/asset-manager";

export function SellOffersTab() {
  const { settings } = useSettings();
  const { groups } = useAssetGroups();
  const { activeWallet } = useActiveWallet();

  const [assetCode, setAssetCode] = useState("");
  const [issuer, setIssuer] = useState("");
  const [secretKey, setSecretKey] = useState("");

  const [offers, setOffers] = useState<SellOffer[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanDone, setScanDone] = useState(false);

  const [pendingAddress, setPendingAddress] = useState<string | null>(null);
  const [freezeResults, setFreezeResults] = useState<
    Record<string, { hash: string; error?: string }>
  >({});
  const [frozenAddresses, setFrozenAddresses] = useState<Set<string>>(
    new Set(),
  );

  const abortRef = useRef<AbortController | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const logBoxRef = useRef<HTMLDivElement | null>(null);
  const userScrolledUp = useRef(false);

  const horizonUrl = resolveHorizonUrl(settings);
  const effectiveSecretKey = activeWallet?.secretKey ?? secretKey.trim();
  const issuerAddress = issuer.trim();
  const canScan =
    assetCode.trim().length > 0 &&
    StrKey.isValidEd25519PublicKey(issuerAddress);

  const explorerBase =
    settings.network === "public"
      ? "https://stellar.expert/explorer/public"
      : settings.network === "testnet"
        ? "https://stellar.expert/explorer/testnet"
        : null;

  function onLog(msg: string) {
    setLogs((prev) => [...prev, msg]);
    if (!userScrolledUp.current) {
      setTimeout(
        () => logEndRef.current?.scrollIntoView({ behavior: "smooth" }),
        10,
      );
    }
  }

  function handleLoadFromGroup(groupId: string) {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    if (group.assetCode) setAssetCode(group.assetCode);
    if (group.issuer) setIssuer(group.issuer);
  }

  async function handleScan() {
    if (!canScan) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setOffers([]);
    setLogs([]);
    setScanning(true);
    setScanDone(false);
    setFreezeResults({});
    setFrozenAddresses(new Set());
    userScrolledUp.current = false;

    try {
      await fetchSellOffers(
        horizonUrl,
        assetCode.trim(),
        issuerAddress,
        abortRef.current.signal,
        (newOffers) => {
          setOffers((prev) => {
            const map = new Map(prev.map((o) => [o.id, o]));
            for (const o of newOffers) map.set(o.id, o);
            return Array.from(map.values());
          });
        },
        onLog,
      );
    } finally {
      setScanning(false);
      setScanDone(true);
    }
  }

  function handleStop() {
    abortRef.current?.abort();
    setScanning(false);
  }

  async function handleFreeze(sellerAddress: string) {
    if (!effectiveSecretKey) return;
    setPendingAddress(sellerAddress);
    try {
      const hash = await setTrustlineAuthorization(
        horizonUrl,
        effectiveSecretKey,
        sellerAddress,
        assetCode.trim(),
        issuerAddress,
        "freeze",
        settings.network,
      );
      setFreezeResults((prev) => ({ ...prev, [sellerAddress]: { hash } }));
      setFrozenAddresses((prev) => new Set([...prev, sellerAddress]));
    } catch (e) {
      setFreezeResults((prev) => ({
        ...prev,
        [sellerAddress]: {
          hash: "",
          error: e instanceof Error ? e.message : String(e),
        },
      }));
    } finally {
      setPendingAddress(null);
    }
  }

  function handleExport() {
    downloadCSV(
      `sell-offers-${assetCode}.csv`,
      ["Offer ID", "Seller", "Amount", "Price", "Buying", "Last Modified"],
      offers.map((o) => [
        o.id,
        o.seller,
        o.amount,
        o.price,
        o.buying,
        o.lastModifiedTime,
      ]),
    );
  }

  // Unique sellers with their lowest price offer
  const uniqueSellers = Array.from(
    offers
      .reduce((map, offer) => {
        const existing = map.get(offer.seller);
        if (!existing || parseFloat(offer.price) < parseFloat(existing.price)) {
          map.set(offer.seller, offer);
        }
        return map;
      }, new Map<string, SellOffer>())
      .values(),
  ).sort((a, b) => parseFloat(a.price) - parseFloat(b.price));

  const totalAmount = offers.reduce(
    (sum, o) => sum + parseFloat(o.amount),
    0,
  );

  return (
    <div className="space-y-6">
      {/* Asset input */}
      <Card>
        <CardHeader>
          <CardTitle>Asset</CardTitle>
          <CardDescription>
            Find all open DEX sell offers for your token. Shows every account
            currently offering your token for sale and at what price.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {groups.length > 0 && (
            <div>
              <Label className="text-xs">Load from Asset Group</Label>
              <Select onValueChange={handleLoadFromGroup}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select a group…" />
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

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="so-code">Asset Code</Label>
              <Input
                id="so-code"
                placeholder="e.g. MYTOKEN"
                value={assetCode}
                onChange={(e) => setAssetCode(e.target.value)}
                className="mt-1 font-mono"
              />
            </div>
            <div>
              <Label htmlFor="so-issuer">Issuer Address</Label>
              <Input
                id="so-issuer"
                placeholder="G…"
                value={issuer}
                onChange={(e) => setIssuer(e.target.value)}
                className="mt-1 font-mono text-xs"
              />
            </div>
          </div>

          {/* Signing key for freeze actions */}
          {activeWallet ? (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Freeze signed by:</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-green-500/30 bg-green-500/10 px-2.5 py-0.5 font-medium text-green-500">
                {activeWallet.name} · {shortAddr(activeWallet.publicKey)}
              </span>
            </div>
          ) : (
            <div>
              <Label htmlFor="so-sk">
                Issuer Secret Key{" "}
                <span className="text-muted-foreground">(optional — only needed to freeze)</span>
              </Label>
              <Input
                id="so-sk"
                type="password"
                placeholder="S…"
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
                className="mt-1 font-mono text-xs"
              />
            </div>
          )}

          <div className="flex gap-2">
            {!scanning ? (
              <Button onClick={handleScan} disabled={!canScan}>
                Scan Sell Offers
              </Button>
            ) : (
              <Button variant="outline" onClick={handleStop}>
                Stop
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Log */}
      {logs.length > 0 && (
        <div
          ref={logBoxRef}
          onScroll={() => {
            const el = logBoxRef.current;
            if (!el) return;
            userScrolledUp.current =
              el.scrollTop < el.scrollHeight - el.clientHeight - 8;
          }}
          className="h-24 overflow-y-auto rounded border bg-muted/30 p-2 font-mono text-xs"
        >
          {logs.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
          <div ref={logEndRef} />
        </div>
      )}

      {/* Summary stats */}
      {offers.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-1 pt-3">
              <CardDescription>Total Sell Offers</CardDescription>
              <p className="text-2xl font-bold">{offers.length}</p>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-1 pt-3">
              <CardDescription>Unique Sellers</CardDescription>
              <p className="text-2xl font-bold">{uniqueSellers.length}</p>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-1 pt-3">
              <CardDescription>Total Amount for Sale</CardDescription>
              <p className="text-2xl font-bold">
                {totalAmount.toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })}{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  {assetCode}
                </span>
              </p>
            </CardHeader>
          </Card>
        </div>
      )}

      {/* Offers table — grouped by seller (lowest price shown) */}
      {uniqueSellers.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>
                  Sellers
                  {scanning && (
                    <Loader2 className="ml-2 inline h-4 w-4 animate-spin" />
                  )}
                </CardTitle>
                <CardDescription>
                  Sorted by lowest price. Multiple offers per seller are
                  collapsed — lowest price shown.
                </CardDescription>
              </div>
              {scanDone && (
                <Button variant="outline" size="sm" onClick={handleExport}>
                  <Download className="mr-2 h-3.5 w-3.5" />
                  Export CSV
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="px-3 py-2 text-left">Seller</th>
                    <th className="px-3 py-2 text-right">Offers</th>
                    <th className="px-3 py-2 text-right">
                      Lowest Price
                    </th>
                    <th className="px-3 py-2 text-left">Wants</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {uniqueSellers.map((offer) => {
                    const sellerOffers = offers.filter(
                      (o) => o.seller === offer.seller,
                    );
                    const isFrozen = frozenAddresses.has(offer.seller);
                    const isPending = pendingAddress === offer.seller;
                    const result = freezeResults[offer.seller];

                    return (
                      <tr
                        key={offer.seller}
                        className={`border-b last:border-0 ${isFrozen ? "opacity-50" : ""}`}
                      >
                        <td className="px-3 py-2 text-xs">
                          <ShortAddress
                            address={offer.seller}
                            network={settings.network}
                          />
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {sellerOffers.length}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium">
                          {parseFloat(offer.price).toFixed(7)}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {offer.buying}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                            ) : isFrozen ? (
                              <span className="text-[10px] text-muted-foreground">
                                Frozen
                              </span>
                            ) : result ? (
                              result.error ? (
                                <span
                                  className="text-[10px] text-destructive"
                                  title={result.error}
                                >
                                  Error
                                </span>
                              ) : (
                                <a
                                  href={
                                    explorerBase
                                      ? `${explorerBase}/tx/${result.hash}`
                                      : "#"
                                  }
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-0.5 text-[10px] text-green-500"
                                  title={result.hash}
                                >
                                  <CheckCircle2 className="h-3 w-3" />
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              )
                            ) : (
                              <button
                                title="Freeze this seller's trustline — cancels all their offers"
                                onClick={() => handleFreeze(offer.seller)}
                                disabled={!effectiveSecretKey}
                                className="inline-flex items-center gap-1 rounded border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive hover:bg-destructive/20 disabled:opacity-40"
                              >
                                <Lock className="h-3 w-3" />
                                Freeze
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Freezing a seller requires AUTH_REVOCABLE on the issuer account
              and cancels all their open offers instantly.
            </p>
          </CardContent>
        </Card>
      )}

      {scanDone && offers.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No open sell offers found for this asset.
        </p>
      )}
    </div>
  );
}
