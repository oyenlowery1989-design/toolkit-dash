"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Database, UserSearch, X, Clock, TrendingDown, Search, GitFork, ScanSearch, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSavedSearches } from "@/hooks/use-saved-searches";
import { formatXlm } from "@/lib/format";
import { timeAgo } from "@/lib/stellar-helpers";
import { NETWORK_LABELS } from "@/lib/settings";

export default function SearchHistoryPage() {
  const router = useRouter();
  const { history, remove } = useSavedSearches();
  const [query, setQuery] = useState("");

  const handleClick = (entry: (typeof history)[number]) => {
    if (entry.type === "address") {
      router.push(`/address-investigator?address=${encodeURIComponent(entry.value)}`);
    } else if (entry.type === "asset") {
      const [code, issuer] = entry.value.split(":");
      router.push(`/asset-lookup?code=${encodeURIComponent(code)}&issuer=${encodeURIComponent(issuer)}`);
    } else if (entry.type === "intermediary-trace") {
      router.push(`/intermediary-tracer?address=${encodeURIComponent(entry.value)}&tab=trace`);
    } else if (entry.type === "intermediary-scan") {
      router.push(`/intermediary-tracer?address=${encodeURIComponent(entry.value)}&tab=scan`);
    } else if (entry.type === "address-balances") {
      router.push(`/address-balances?addresses=${encodeURIComponent(entry.value)}`);
    }
  };

  const handleRunSales = (value: string) => {
    const [code, issuer] = value.split(":");
    router.push(
      `/asset-sales?asset=${encodeURIComponent(code)}&issuer=${encodeURIComponent(issuer)}`,
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Clock className="h-6 w-6" />
          Search History
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Recent address and asset lookups — click any entry to jump back in, or run a quick Asset Sales analysis from history.
        </p>
      </div>

      {/* Search filter */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          className="pl-9"
          placeholder="Filter by asset code, address, distrib…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {history.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No searches yet. Start by looking up an address or asset.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              All Searches
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {(query.trim()
                ? history.filter((e) => {
                    const q = query.toLowerCase();
                    return (
                      e.value.toLowerCase().includes(q) ||
                      (e.distribAddress ?? "").toLowerCase().includes(q) ||
                      (e.label ?? "").toLowerCase().includes(q)
                    );
                  })
                : history
              ).map((entry) => {
                const isAddress = entry.type === "address";
                const isAsset = entry.type === "asset";
                const isTrace = entry.type === "intermediary-trace";
                const isScan = entry.type === "intermediary-scan";
                const isBalances = entry.type === "address-balances";
                const Icon = isAddress
                  ? UserSearch
                  : isAsset
                    ? Database
                    : isTrace
                      ? GitFork
                      : isBalances
                        ? Wallet
                        : ScanSearch;
                const assetCode = isAsset ? entry.value.split(":")[0] : null;
                const issuerFull = isAsset ? entry.value.split(":")[1] : null;

                return (
                  <div
                    key={entry.timestamp}
                    className="flex items-start gap-3 px-6 py-3 hover:bg-accent/50 group transition-colors"
                  >
                    <Icon className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />

                    {/* Main info */}
                    <button
                      className="flex-1 min-w-0 text-left"
                      onClick={() => handleClick(entry)}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-medium">
                          {isBalances ? (
                            entry.label ?? `${entry.value.split(",").length} addresses`
                          ) : isAddress ? (
                            <>
                              {entry.value.slice(0, 8)}…{entry.value.slice(-6)}
                            </>
                          ) : (
                            assetCode ?? <>{entry.value.slice(0, 8)}…{entry.value.slice(-6)}</>
                          )}
                        </span>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                          {isAddress
                            ? "Address"
                            : entry.type === "asset"
                              ? "Asset"
                              : entry.type === "intermediary-trace"
                                ? "Trace"
                                : entry.type === "intermediary-scan"
                                  ? "Scan"
                                  : "Balances"}
                        </span>
                        {entry.network && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            {NETWORK_LABELS[entry.network as keyof typeof NETWORK_LABELS] ?? entry.network}
                          </span>
                        )}
                      </div>

                      {/* Issuer */}
                      {issuerFull && (
                        <p className="font-mono text-xs text-muted-foreground truncate mt-0.5">
                          {issuerFull.slice(0, 8)}…{issuerFull.slice(-6)}
                        </p>
                      )}

                      {/* Intermediary info */}
                      {(isTrace || isScan) && entry.intermediaryName && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          <span className="text-foreground/60">Via: </span>
                          <span className="font-medium">{entry.intermediaryName}</span>
                          {isScan && entry.accountsFound !== undefined && (
                            <span className="ml-2 text-foreground/60">{entry.accountsFound} accounts scanned</span>
                          )}
                        </p>
                      )}

                      {/* Distrib address */}
                      {entry.distribAddress && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          <span className="text-foreground/60">Distrib: </span>
                          <span className="font-mono">
                            {entry.distribAddress.slice(0, 8)}…{entry.distribAddress.slice(-6)}
                          </span>
                        </p>
                      )}

                      {/* Proceeds stats */}
                      {entry.totalXlmProceeds !== undefined && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          <span className="text-foreground/60">Proceeds: </span>
                          <span className="font-mono font-medium text-foreground">
                            {formatXlm(entry.totalXlmProceeds)} XLM
                          </span>
                          {entry.totalAssetSold !== undefined && (
                            <>
                              <span className="mx-1.5">·</span>
                              <span className="text-foreground/60">Sold: </span>
                              <span className="font-mono font-medium text-foreground">
                                {formatXlm(entry.totalAssetSold)} {assetCode}
                              </span>
                            </>
                          )}
                        </p>
                      )}

                      {entry.label && !isBalances && (
                        <p className="text-xs text-foreground/70 mt-0.5 italic">
                          {entry.label}
                        </p>
                      )}
                    </button>

                    {/* Right side: time + actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-xs text-muted-foreground mr-1">
                        {timeAgo(entry.timestamp)}
                      </span>
                      {isAsset && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Run Asset Sales analysis"
                          onClick={() => handleRunSales(entry.value)}
                        >
                          <TrendingDown className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                        onClick={() => remove(entry.timestamp)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
