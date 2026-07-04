"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, ExternalLink, Globe, Loader2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ShortAddress } from "@/components/asset-lookup";
import { useKnownCreators } from "@/hooks/use-known-creators";
import { useCreatorChildren } from "@/hooks/use-creator-children";
import { useSettings, resolveHorizonUrl } from "@/lib/settings";
import { shortAddr } from "@/lib/format";
import type { CreatorChild } from "@/lib/intermediary-tracer/types";

export function CreatorTreeTab() {
  const router = useRouter();
  const { entries: creators, upsert: upsertCreator } = useKnownCreators();
  const { all, forCreator, saveChildren, removeChild, removeAllForCreator } = useCreatorChildren();
  const { settings } = useSettings();
  const network = settings.network;
  const horizonUrl = resolveHorizonUrl(settings);

  const [expandedCreators, setExpandedCreators] = useState<Set<string>>(new Set());
  const [enrichingCreators, setEnrichingCreators] = useState<Set<string>>(new Set());
  const [enrichProgress, setEnrichProgress] = useState<Record<string, { done: number; total: number }>>({});
  const [parentInputs, setParentInputs] = useState<Record<string, string>>({});
  const [editingParent, setEditingParent] = useState<Set<string>>(new Set());
  const [confirmClear, setConfirmClear] = useState<string | null>(null);
  const abortRefs = useRef<Map<string, AbortController>>(new Map());

  // Sort creators by child count descending
  const sortedCreators = useMemo(() => {
    return [...creators].sort((a, b) => {
      const aCount = forCreator(a.address, network).length;
      const bCount = forCreator(b.address, network).length;
      return bCount - aCount;
    });
  }, [creators, forCreator, network]);

  const toggleExpand = useCallback((addr: string) => {
    setExpandedCreators((prev) => {
      const next = new Set(prev);
      if (next.has(addr)) {
        next.delete(addr);
        // Abort any ongoing enrichment
        const ac = abortRefs.current.get(addr);
        if (ac) { ac.abort(); abortRefs.current.delete(addr); }
      } else {
        next.add(addr);
      }
      return next;
    });
  }, []);

  const enrichChildren = useCallback(
    async (creatorAddr: string, children: CreatorChild[]) => {
      const unenriched = children.filter((c) => c.issuedAssets === undefined);
      if (unenriched.length === 0) return;

      const ac = new AbortController();
      abortRefs.current.set(creatorAddr, ac);
      setEnrichingCreators((prev) => new Set(prev).add(creatorAddr));
      setEnrichProgress((prev) => ({ ...prev, [creatorAddr]: { done: 0, total: unenriched.length } }));

      let done = 0;
      for (const child of unenriched) {
        if (ac.signal.aborted) break;
        try {
          // Fetch issued assets
          let issuedAssets: { code: string; supply: string }[] = [];
          try {
            const assetsRes = await fetch(
              `${horizonUrl}/assets?asset_issuer=${child.childAddress}&limit=10`,
              { signal: ac.signal },
            );
            if (assetsRes.ok) {
              const assetsData = await assetsRes.json() as {
                _embedded?: { records?: { asset_code: string; amount: string }[] };
              };
              const recs = assetsData._embedded?.records ?? [];
              issuedAssets = recs.map((r) => ({ code: r.asset_code, supply: r.amount }));
            }
          } catch { /* ignore per-child errors */ }

          // Fetch distributed assets (non-native balances > 100 where child is not issuer)
          let distributedAssets: { code: string; issuer: string }[] = [];
          try {
            const accRes = await fetch(
              `${horizonUrl}/accounts/${child.childAddress}`,
              { signal: ac.signal },
            );
            if (accRes.ok) {
              const accData = await accRes.json() as {
                balances: { asset_type: string; asset_code?: string; asset_issuer?: string; balance: string }[];
              };
              distributedAssets = accData.balances
                .filter(
                  (b) =>
                    b.asset_type !== "native" &&
                    parseFloat(b.balance) > 100 &&
                    b.asset_issuer !== child.childAddress,
                )
                .map((b) => ({ code: b.asset_code!, issuer: b.asset_issuer! }));
            }
          } catch { /* ignore */ }

          const updated: CreatorChild = { ...child, issuedAssets, distributedAssets };
          await saveChildren([updated]);
        } catch {
          // skip on abort or network error
        }
        done++;
        setEnrichProgress((prev) => ({ ...prev, [creatorAddr]: { done, total: unenriched.length } }));
      }

      setEnrichingCreators((prev) => {
        const next = new Set(prev);
        next.delete(creatorAddr);
        return next;
      });
      abortRefs.current.delete(creatorAddr);
    },
    [horizonUrl, saveChildren],
  );

  const handleClearChildren = useCallback(
    (addr: string) => {
      removeAllForCreator(addr, network);
      setConfirmClear(null);
    },
    [removeAllForCreator, network],
  );

  const handleSaveParent = useCallback(
    (creatorAddr: string) => {
      const parent = parentInputs[creatorAddr]?.trim();
      if (!parent) return;
      const creator = creators.find((c) => c.address === creatorAddr);
      if (!creator) return;
      upsertCreator({ ...creator, parentAddress: parent });
      setEditingParent((prev) => {
        const next = new Set(prev);
        next.delete(creatorAddr);
        return next;
      });
      setParentInputs((prev) => {
        const next = { ...prev };
        delete next[creatorAddr];
        return next;
      });
    },
    [parentInputs, creators, upsertCreator],
  );

  // Count unique intermediaries used by a creator's children
  const intermediaryCount = useCallback(
    (children: CreatorChild[]) => {
      const set = new Set(children.map((c) => c.viaIntermediary).filter(Boolean));
      return set.size;
    },
    [],
  );

  if (creators.length === 0) {
    return (
      <Card className="p-8 text-center">
        <p className="text-muted-foreground">
          No known creators yet. Add creators in the{" "}
          <span className="text-primary font-medium">Known Creators</span> tab.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Showing <span className="font-medium">{network}</span> data
      </p>

      {sortedCreators.map((creator) => {
        const children = forCreator(creator.address, network);
        const childCount = children.length;
        const isExpanded = expandedCreators.has(creator.address);
        const isEnriching = enrichingCreators.has(creator.address);
        const progress = enrichProgress[creator.address];
        const hasZero = childCount === 0;
        const intCount = intermediaryCount(children);
        const unenrichedCount = children.filter((c) => c.issuedAssets === undefined).length;

        return (
          <Card
            key={creator.address}
            className={`overflow-hidden ${hasZero ? "opacity-50" : ""}`}
          >
            {/* Header */}
            <button
              className="w-full flex items-center gap-3 p-4 text-left hover:bg-muted/50 transition-colors"
              onClick={() => toggleExpand(creator.address)}
            >
              <ChevronRight
                className={`h-4 w-4 shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-sm">{creator.name}</span>
                  <span className="bg-purple-500/10 text-purple-500 border border-purple-500/30 rounded-full px-2 py-0.5 text-xs">
                    CREATOR
                  </span>
                  {childCount > 0 && (
                    <>
                      <span className="bg-blue-500/10 text-blue-500 border border-blue-500/30 rounded-full px-2 py-0.5 text-xs">
                        {childCount} children
                      </span>
                      {intCount > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {intCount} intermediar{intCount === 1 ? "y" : "ies"} used
                        </span>
                      )}
                    </>
                  )}
                  {hasZero && (
                    <span className="text-xs text-muted-foreground">No children saved</span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  <ShortAddress address={creator.address} network={network === "futurenet" ? "testnet" : network as "public" | "testnet"} />
                </div>
              </div>
            </button>

            {/* Expanded content */}
            {isExpanded && (
              <div className="border-t px-4 pb-4">
                {/* Parent link */}
                <div className="py-3 border-b mb-3">
                  {creator.parentAddress ? (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">Parent:</span>
                      <ShortAddress
                        address={creator.parentAddress}
                        network={network === "futurenet" ? "testnet" : network as "public" | "testnet"}
                      />
                    </div>
                  ) : editingParent.has(creator.address) ? (
                    <div className="flex items-center gap-2">
                      <Input
                        className="h-7 text-xs font-mono flex-1"
                        placeholder="Paste parent address (G...)"
                        value={parentInputs[creator.address] ?? ""}
                        onChange={(e) =>
                          setParentInputs((prev) => ({ ...prev, [creator.address]: e.target.value }))
                        }
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => handleSaveParent(creator.address)}
                      >
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() =>
                          setEditingParent((prev) => {
                            const next = new Set(prev);
                            next.delete(creator.address);
                            return next;
                          })
                        }
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <button
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() =>
                        setEditingParent((prev) => new Set(prev).add(creator.address))
                      }
                    >
                      + Set parent
                    </button>
                  )}
                </div>

                {/* Actions bar */}
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  {unenrichedCount > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={isEnriching}
                      onClick={() => enrichChildren(creator.address, children)}
                    >
                      {isEnriching && progress ? (
                        <>
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                          Enriching {progress.done}/{progress.total}...
                        </>
                      ) : (
                        `Enrich all (${unenrichedCount})`
                      )}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() =>
                      router.push("/intermediary-tracer?scanCreator=" + creator.address)
                    }
                  >
                    Scan for more
                  </Button>
                  {childCount > 0 && (
                    confirmClear === creator.address ? (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-red-400">Clear all children?</span>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-7 text-xs"
                          onClick={() => handleClearChildren(creator.address)}
                        >
                          Yes, clear
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => setConfirmClear(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-red-400 hover:text-red-300"
                        onClick={() => setConfirmClear(creator.address)}
                      >
                        <Trash2 className="h-3 w-3 mr-1" />
                        Clear children
                      </Button>
                    )
                  )}
                </div>

                {/* Children table */}
                {childCount === 0 ? (
                  <p className="text-xs text-muted-foreground py-4 text-center">
                    No children saved for this creator on {network}.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-xs text-muted-foreground">
                          <th className="text-left py-2 pr-3 font-medium">Address</th>
                          <th className="text-left py-2 pr-3 font-medium">Created</th>
                          <th className="text-left py-2 pr-3 font-medium">Via</th>
                          <th className="text-left py-2 pr-3 font-medium">Confidence</th>
                          <th className="text-left py-2 pr-3 font-medium">Home Domain</th>
                          <th className="text-left py-2 pr-3 font-medium">Issued</th>
                          <th className="text-left py-2 pr-3 font-medium">Distrib</th>
                          <th className="text-right py-2 font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {children.map((child) => (
                          <ChildRow
                            key={child.id}
                            child={child}
                            network={network}
                            horizonUrl={horizonUrl}
                            onRemove={() => removeChild(child.id)}
                            onEnrich={async (updated) => { await saveChildren([updated]); }}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Child row component
// ---------------------------------------------------------------------------

function ChildRow({
  child,
  network,
  horizonUrl,
  onRemove,
  onEnrich,
}: {
  child: CreatorChild;
  network: string;
  horizonUrl: string;
  onRemove: () => void;
  onEnrich: (updated: CreatorChild) => Promise<void>;
}) {
  const [enriching, setEnriching] = useState(false);

  const enrichSingle = useCallback(async () => {
    setEnriching(true);
    try {
      let issuedAssets: { code: string; supply: string }[] = [];
      try {
        const res = await fetch(`${horizonUrl}/assets?asset_issuer=${child.childAddress}&limit=10`);
        if (res.ok) {
          const data = await res.json() as {
            _embedded?: { records?: { asset_code: string; amount: string }[] };
          };
          issuedAssets = (data._embedded?.records ?? []).map((r) => ({
            code: r.asset_code,
            supply: r.amount,
          }));
        }
      } catch { /* ignore */ }

      let distributedAssets: { code: string; issuer: string }[] = [];
      try {
        const res = await fetch(`${horizonUrl}/accounts/${child.childAddress}`);
        if (res.ok) {
          const data = await res.json() as {
            balances: { asset_type: string; asset_code?: string; asset_issuer?: string; balance: string }[];
          };
          distributedAssets = data.balances
            .filter(
              (b) =>
                b.asset_type !== "native" &&
                parseFloat(b.balance) > 100 &&
                b.asset_issuer !== child.childAddress,
            )
            .map((b) => ({ code: b.asset_code!, issuer: b.asset_issuer! }));
        }
      } catch { /* ignore */ }

      await onEnrich({ ...child, issuedAssets, distributedAssets });
    } finally {
      setEnriching(false);
    }
  }, [child, horizonUrl, onEnrich]);

  const shortNetwork = network === "futurenet" ? "testnet" : (network as "public" | "testnet");

  return (
    <tr className="border-b last:border-0 hover:bg-muted/30">
      {/* Address */}
      <td className="py-2 pr-3">
        <ShortAddress address={child.childAddress} network={shortNetwork} />
      </td>
      {/* Created */}
      <td className="py-2 pr-3 text-xs text-muted-foreground">
        {child.createdOnChain ? new Date(child.createdOnChain).toLocaleDateString() : "\u2014"}
      </td>
      {/* Via */}
      <td className="py-2 pr-3 text-xs font-mono text-muted-foreground">
        {child.viaIntermediary ? shortAddr(child.viaIntermediary) : "\u2014"}
      </td>
      {/* Confidence */}
      <td className="py-2 pr-3 text-xs">
        {child.confidence != null ? (
          <span
            className={
              child.confidence >= 80
                ? "text-green-500"
                : child.confidence >= 60
                  ? "text-yellow-500"
                  : "text-red-400"
            }
          >
            {child.confidence}
          </span>
        ) : (
          "\u2014"
        )}
      </td>
      {/* Home Domain */}
      <td className="py-2 pr-3 text-xs">
        {child.homeDomain ? (
          <a
            href={`https://${child.homeDomain}/.well-known/stellar.toml`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:underline inline-flex items-center gap-1"
          >
            <Globe className="h-3 w-3" />
            {child.homeDomain}
            <ExternalLink className="h-3 w-3" />
          </a>
        ) : (
          "\u2014"
        )}
      </td>
      {/* Issued */}
      <td className="py-2 pr-3">
        {child.issuedAssets === undefined ? (
          <button
            className="text-xs text-muted-foreground hover:text-foreground border border-dashed border-muted-foreground/30 rounded px-1.5 py-0.5"
            onClick={enrichSingle}
            disabled={enriching}
          >
            {enriching ? <Loader2 className="h-3 w-3 animate-spin" /> : "?"}
          </button>
        ) : child.issuedAssets.length === 0 ? (
          <span className="text-xs text-muted-foreground">{"\u2014"}</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {child.issuedAssets.slice(0, 2).map((a) => (
              <span
                key={a.code}
                className="bg-amber-500/10 text-amber-500 border border-amber-500/30 rounded-full px-2 py-0.5 text-xs"
              >
                {a.code}
              </span>
            ))}
            {child.issuedAssets.length > 2 && (
              <span className="text-xs text-muted-foreground">
                +{child.issuedAssets.length - 2} more
              </span>
            )}
          </div>
        )}
      </td>
      {/* Distrib */}
      <td className="py-2 pr-3">
        {child.distributedAssets === undefined ? (
          <button
            className="text-xs text-muted-foreground hover:text-foreground border border-dashed border-muted-foreground/30 rounded px-1.5 py-0.5"
            onClick={enrichSingle}
            disabled={enriching}
          >
            {enriching ? <Loader2 className="h-3 w-3 animate-spin" /> : "?"}
          </button>
        ) : child.distributedAssets.length === 0 ? (
          <span className="text-xs text-muted-foreground">{"\u2014"}</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {child.distributedAssets.slice(0, 2).map((a) => (
              <span
                key={`${a.code}:${a.issuer}`}
                className="bg-green-500/10 text-green-500 border border-green-500/30 rounded-full px-2 py-0.5 text-xs"
              >
                {a.code}
              </span>
            ))}
            {child.distributedAssets.length > 2 && (
              <span className="text-xs text-muted-foreground">
                +{child.distributedAssets.length - 2} more
              </span>
            )}
          </div>
        )}
      </td>
      {/* Actions */}
      <td className="py-2 text-right">
        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={onRemove}>
          <X className="h-3 w-3" />
        </Button>
      </td>
    </tr>
  );
}
