"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Download,
  ExternalLink,
  Loader2,
  Lock,
  Minus,
  LockOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useSettings, resolveHorizonUrl } from "@/lib/settings";
import { ShortAddress } from "@/components/shared/ShortAddress";
import { downloadCSV } from "@/lib/csv-export";
import {
  fetchTrustlineHolders,
  fetchSellOffers,
  setTrustlineAuthorization,
  type TrustlineHolder,
  type TrustlineAction,
  type SellOffer,
} from "@/lib/asset-manager";

// ---------------------------------------------------------------------------
// Merged row type
// ---------------------------------------------------------------------------

interface HolderRow extends TrustlineHolder {
  sellOffers: SellOffer[];
  lowestPrice: number | null;
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<TrustlineHolder["status"], string> = {
  authorized: "Authorized",
  maintain_liabilities: "Maintain Only",
  frozen: "Frozen",
};

const STATUS_STYLE: Record<TrustlineHolder["status"], string> = {
  authorized: "text-green-500 bg-green-500/10 border-green-500/30",
  maintain_liabilities: "text-amber-500 bg-amber-500/10 border-amber-500/30",
  frozen: "text-destructive bg-destructive/10 border-destructive/30",
};

type FilterMode = "all" | "sellers" | "frozen";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  assetCode: string;
  issuer: string;
  secretKey: string;
}

export function HoldersTab({ assetCode, issuer, secretKey }: Props) {
  const { settings } = useSettings();
  const [filterMode, setFilterMode] = useState<FilterMode>("all");

  // Raw data maps — merged on render via useMemo
  const [holdersMap, setHoldersMap] = useState<Map<string, TrustlineHolder>>(
    new Map(),
  );
  const [offersMap, setOffersMap] = useState<Map<string, SellOffer[]>>(
    new Map(),
  );

  const [logs, setLogs] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanDone, setScanDone] = useState(false);

  // Per-address action state
  const [pendingAddress, setPendingAddress] = useState<string | null>(null);
  const [actionResults, setActionResults] = useState<
    Record<string, { hash: string; error?: string }>
  >({});

  const abortRef = useRef<AbortController | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const logBoxRef = useRef<HTMLDivElement | null>(null);
  const userScrolledUp = useRef(false);

  const horizonUrl = resolveHorizonUrl(settings);

  // Reset stale scan results whenever the shared asset context changes —
  // otherwise already-rendered holder rows (and their action buttons) would
  // remain clickable against the OLD asset's addresses combined with the
  // NEW assetCode/issuer.
  useEffect(() => {
    abortRef.current?.abort();
    setHoldersMap(new Map());
    setOffersMap(new Map());
    setLogs([]);
    setScanning(false);
    setScanDone(false);
    setActionResults({});
    setPendingAddress(null);
    setFilterMode("all");
  }, [assetCode, issuer]);

  // Abort any in-flight scan on unmount so it can't keep paging in the
  // background and race a fresh scan started on re-entry.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

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

  async function handleScan() {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    setHoldersMap(new Map());
    setOffersMap(new Map());
    setLogs([]);
    setScanning(true);
    setScanDone(false);
    setActionResults({});
    setFilterMode("all");
    userScrolledUp.current = false;

    // Run both scans concurrently — each streams results independently
    await Promise.allSettled([
      fetchTrustlineHolders(
        horizonUrl,
        assetCode,
        issuer,
        signal,
        (newHolders) => {
          setHoldersMap((prev) => {
            const next = new Map(prev);
            for (const h of newHolders) next.set(h.address, h);
            return next;
          });
        },
        onLog,
      ),
      fetchSellOffers(
        horizonUrl,
        assetCode,
        issuer,
        signal,
        (newOffers) => {
          setOffersMap((prev) => {
            const next = new Map(prev);
            for (const offer of newOffers) {
              const existing = next.get(offer.seller) ?? [];
              next.set(offer.seller, [...existing, offer]);
            }
            return next;
          });
        },
        onLog,
      ),
    ]);

    setScanning(false);
    setScanDone(true);
  }

  function handleStop() {
    abortRef.current?.abort();
    setScanning(false);
  }

  // Merge holders + offers into unified rows
  const allRows: HolderRow[] = useMemo(() => {
    const rows: HolderRow[] = [];
    holdersMap.forEach((holder) => {
      const sellerOffers = offersMap.get(holder.address) ?? [];
      const prices = sellerOffers.map((o) => parseFloat(o.price));
      rows.push({
        ...holder,
        sellOffers: sellerOffers,
        lowestPrice: prices.length > 0 ? Math.min(...prices) : null,
      });
    });
    // Sort: sellers first (by lowest price), then frozen, then rest
    return rows.sort((a, b) => {
      if (a.lowestPrice !== null && b.lowestPrice !== null)
        return a.lowestPrice - b.lowestPrice;
      if (a.lowestPrice !== null) return -1;
      if (b.lowestPrice !== null) return 1;
      return 0;
    });
  }, [holdersMap, offersMap]);

  const filteredRows = useMemo(() => {
    if (filterMode === "sellers") return allRows.filter((r) => r.sellOffers.length > 0);
    if (filterMode === "frozen") return allRows.filter((r) => r.status === "frozen");
    return allRows;
  }, [allRows, filterMode]);

  const sellerCount = allRows.filter((r) => r.sellOffers.length > 0).length;
  const frozenCount = allRows.filter((r) => r.status === "frozen").length;

  async function handleAction(address: string, action: TrustlineAction) {
    if (!secretKey) return;
    setPendingAddress(address);
    try {
      const hash = await setTrustlineAuthorization(
        horizonUrl,
        secretKey,
        address,
        assetCode,
        issuer,
        action,
        settings.network,
      );
      setActionResults((prev) => ({ ...prev, [address]: { hash } }));
      // Update trustline status optimistically
      const newStatus =
        action === "authorize"
          ? "authorized"
          : action === "freeze"
            ? "frozen"
            : "maintain_liabilities";
      setHoldersMap((prev) => {
        const next = new Map(prev);
        const holder = next.get(address);
        if (holder) next.set(address, { ...holder, status: newStatus });
        return next;
      });
    } catch (e) {
      setActionResults((prev) => ({
        ...prev,
        [address]: {
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
      `holders-${assetCode}.csv`,
      ["Address", "Balance", "Status", "Offer Count", "Offer Amount", "Offer Price", "Offer Buying"],
      allRows.flatMap((r) =>
        r.sellOffers.length > 0
          ? r.sellOffers.map((o) => [
              r.address,
              r.balance,
              STATUS_LABEL[r.status],
              String(r.sellOffers.length),
              o.amount,
              o.price,
              o.buying === "native" ? "XLM" : o.buying,
            ])
          : [[r.address, r.balance, STATUS_LABEL[r.status], "0", "", "", ""]],
      ),
    );
  }

  return (
    <div className="space-y-6">
      {/* Scan control */}
      <Card>
        <CardHeader>
          <CardTitle>Holders &amp; Sell Offers</CardTitle>
          <CardDescription>
            Scans all holders and all open sell offers simultaneously. Each row
            shows trustline status and active sell offers — so you can spot and
            restrict sellers in one place.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            {!scanning ? (
              <Button onClick={handleScan}>Scan</Button>
            ) : (
              <Button variant="outline" onClick={handleStop}>Stop</Button>
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

      {/* Results */}
      {allRows.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <CardTitle className="flex items-center gap-2">
                  Holders
                  {scanning && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                </CardTitle>
                {/* Filter pills */}
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    variant="ghost"
                    onClick={() => setFilterMode("all")}
                    className={`h-auto rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                      filterMode === "all"
                        ? "border-primary bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
                        : "border-muted-foreground/30 text-muted-foreground hover:border-foreground"
                    }`}
                  >
                    All ({allRows.length})
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setFilterMode("sellers")}
                    className={`h-auto rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                      filterMode === "sellers"
                        ? "border-amber-500 bg-amber-500 text-white hover:bg-amber-500 hover:text-white"
                        : "border-amber-500/40 text-amber-500 hover:bg-amber-500/10"
                    }`}
                  >
                    Sellers ({sellerCount})
                  </Button>
                  {frozenCount > 0 && (
                    <Button
                      variant="ghost"
                      onClick={() => setFilterMode("frozen")}
                      className={`h-auto rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                        filterMode === "frozen"
                          ? "border-destructive bg-destructive text-destructive-foreground hover:bg-destructive hover:text-destructive-foreground"
                          : "border-destructive/40 text-destructive hover:bg-destructive/10"
                      }`}
                    >
                      Frozen ({frozenCount})
                    </Button>
                  )}
                </div>
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
                    <th className="px-3 py-2 text-left">Holder</th>
                    <th className="px-3 py-2 text-right">Balance</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-left">Sell Offers</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => {
                    const isPending = pendingAddress === row.address;
                    const result = actionResults[row.address];
                    const hasSellOffers = row.sellOffers.length > 0;

                    return (
                      <tr
                        key={row.address}
                        className={`border-b last:border-0 ${hasSellOffers ? "bg-amber-500/5" : ""}`}
                      >
                        <td className="px-3 py-2 text-xs">
                          <ShortAddress
                            address={row.address}
                            network={settings.network}
                          />
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-xs">
                          {parseFloat(row.balance).toLocaleString(undefined, {
                            maximumFractionDigits: 2,
                          })}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLE[row.status]}`}
                          >
                            {STATUS_LABEL[row.status]}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {hasSellOffers ? (
                            <div className="space-y-1">
                              {row.sellOffers.map((offer) => (
                                <div key={offer.id} className="flex items-center gap-1.5 text-[11px] tabular-nums">
                                  <span className="font-semibold text-amber-500">
                                    {parseFloat(offer.amount).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                  </span>
                                  <span className="text-muted-foreground">@</span>
                                  <span className="font-mono text-foreground">
                                    {parseFloat(offer.price).toFixed(7)}
                                  </span>
                                  <span className="text-muted-foreground">
                                    {offer.buying === "native" ? "XLM" : offer.buying}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-1">
                            {isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                            ) : (
                              <>
                                {row.status !== "authorized" && (
                                  <Button
                                    variant="ghost"
                                    title="Unfreeze — full authorization"
                                    onClick={() =>
                                      handleAction(row.address, "authorize")
                                    }
                                    disabled={!secretKey || pendingAddress !== null}
                                    className="h-auto inline-flex items-center gap-1 rounded border border-green-500/40 bg-green-500/10 px-1.5 py-0.5 text-[10px] font-medium text-green-500 hover:bg-green-500/20 disabled:opacity-40"
                                  >
                                    <LockOpen className="h-3 w-3" />
                                  </Button>
                                )}
                                {row.status !== "maintain_liabilities" && (
                                  <Button
                                    variant="ghost"
                                    title="Restrict — can hold but not create new offers or send"
                                    onClick={() =>
                                      handleAction(row.address, "maintain_only")
                                    }
                                    disabled={!secretKey || pendingAddress !== null}
                                    className="h-auto inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-500 hover:bg-amber-500/20 disabled:opacity-40"
                                  >
                                    <Minus className="h-3 w-3" />
                                  </Button>
                                )}
                                {row.status !== "frozen" && (
                                  <Button
                                    variant="ghost"
                                    title="Freeze — deauthorize, cancels all open offers"
                                    onClick={() =>
                                      handleAction(row.address, "freeze")
                                    }
                                    disabled={!secretKey || pendingAddress !== null}
                                    className="h-auto inline-flex items-center gap-1 rounded border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive hover:bg-destructive/20 disabled:opacity-40"
                                  >
                                    <Lock className="h-3 w-3" />
                                  </Button>
                                )}
                              </>
                            )}
                            {result && (
                              result.error ? (
                                <span
                                  className="text-[10px] text-destructive"
                                  title={result.error}
                                >
                                  Err
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
              <span className="font-medium text-amber-500">Highlighted rows</span>{" "}
              have open sell offers. Restrict = keep offers open but block new ones.
              Freeze = cancel all offers immediately.
            </p>
          </CardContent>
        </Card>
      )}

      {scanDone && allRows.length === 0 && (
        <p className="text-sm text-muted-foreground">No holders found for this asset.</p>
      )}
    </div>
  );
}
