"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, GitCompareArrows } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ShortAddress } from "@/components/shared/ShortAddress";
import { formatXlm, formatUsdEstimate } from "@/lib/format";
import { comparableGroups, diffSnapshots, type DestinationDeltaKind } from "@/lib/saved-analyses/diff";
import type { SavedAnalysis } from "@/hooks/use-saved-analyses";
import { useXlmUsdPrice } from "@/hooks/use-xlm-usd-price";

export function DeltaBadge({ kind }: { kind: DestinationDeltaKind }) {
  const map: Record<DestinationDeltaKind, { label: string; className: string }> = {
    new: { label: "NEW", className: "bg-green-500/15 text-green-500 border-green-500/30" },
    increased: { label: "↑ increased", className: "bg-green-500/10 text-green-500 border-green-500/20" },
    decreased: { label: "↓ decreased", className: "bg-red-500/10 text-red-500 border-red-500/20" },
    dropped: { label: "left top 50", className: "bg-muted text-muted-foreground border-border" },
  };
  const { label, className } = map[kind];
  return (
    <span className={`text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded border ${className}`}>
      {label}
    </span>
  );
}

export function FieldDeltaCard({
  label,
  before,
  after,
  delta,
  xlmUsdPrice,
  isXlmAmount = true,
}: {
  label: string;
  before: number;
  after: number;
  delta: number;
  xlmUsdPrice?: number | null;
  isXlmAmount?: boolean;
}) {
  const sign = delta > 0 ? "+" : delta < 0 ? "" : "±";
  const color = delta > 0 ? "text-green-500" : delta < 0 ? "text-red-500" : "text-muted-foreground";
  const showUsd = isXlmAmount && xlmUsdPrice != null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-mono mt-0.5">
        {formatXlm(before)} → {formatXlm(after)}
      </p>
      {showUsd && (
        <p className="text-[10px] text-muted-foreground tabular-nums">
          {formatUsdEstimate(before, xlmUsdPrice!)} → {formatUsdEstimate(after, xlmUsdPrice!)}
        </p>
      )}
      <p className={`text-xs font-mono font-semibold mt-0.5 ${color}`}>
        {sign}{formatXlm(Math.abs(delta))}
        {showUsd && (
          <span className="font-normal text-muted-foreground ml-1">
            ({sign}{formatUsdEstimate(Math.abs(delta), xlmUsdPrice!)})
          </span>
        )}
      </p>
    </div>
  );
}

export function SnapshotCompare({ analyses }: { analyses: SavedAnalysis[] }) {
  const { price: xlmUsdPrice, ensure: ensureXlmUsdPrice } = useXlmUsdPrice();
  const [show, setShow] = useState(false);
  const groups = useMemo(() => comparableGroups(analyses), [analyses]);
  const [groupKey, setGroupKey] = useState<string>("");
  const [compareId, setCompareId] = useState<string>("");
  const [baselineId, setBaselineId] = useState<string>("");

  useEffect(() => {
    if (show) ensureXlmUsdPrice();
  }, [show, ensureXlmUsdPrice]);

  const activeGroup = groups.find((g) => g.key === groupKey) ?? groups[0];
  const snapshots = activeGroup?.snapshots ?? [];
  const compare = snapshots.find((s) => s.id === compareId) ?? snapshots[0];
  const baseline = snapshots.find((s) => s.id === baselineId) ?? snapshots[1];

  const diff = compare && baseline ? diffSnapshots(baseline, compare) : null;

  if (groups.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <GitCompareArrows className="h-4 w-4" />
              Compare Snapshots
            </CardTitle>
            <CardDescription className="text-xs mt-0.5">
              {groups.length} asset{groups.length > 1 ? "s" : ""} with 2+ saved snapshots — spot what changed between runs.
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setShow((v) => !v)}>
            {show ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>
      {show && activeGroup && (
        <CardContent className="pt-0 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Asset</label>
              <Select
                value={activeGroup.key}
                onValueChange={(v) => {
                  setGroupKey(v);
                  setCompareId("");
                  setBaselineId("");
                }}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((g) => (
                    <SelectItem key={g.key} value={g.key}>
                      {g.snapshots[0].assetCode} · {g.snapshots.length} snapshots
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Baseline (older)</label>
              <Select value={baseline?.id ?? ""} onValueChange={setBaselineId}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {snapshots.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {new Date(s.timestamp).toLocaleString()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Compare (newer)</label>
              <Select value={compare?.id ?? ""} onValueChange={setCompareId}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {snapshots.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {new Date(s.timestamp).toLocaleString()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {diff && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {diff.fields.map((f) => (
                  <FieldDeltaCard
                    key={f.key}
                    label={f.label}
                    before={f.before}
                    after={f.after}
                    delta={f.delta}
                    xlmUsdPrice={xlmUsdPrice}
                    isXlmAmount={f.key !== "totalAssetSold"}
                  />
                ))}
              </div>

              <div>
                <h4 className="text-sm font-semibold mb-1">Destination Changes</h4>
                {diff.destinations.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-3">No destination changes between these two snapshots.</p>
                ) : (
                  <div className="overflow-x-auto border rounded-md">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b bg-muted/40 text-muted-foreground">
                          <th className="px-3 py-2 text-left font-medium">Destination</th>
                          <th className="px-3 py-2 text-left font-medium"></th>
                          <th className="px-3 py-2 text-right font-medium">Before</th>
                          <th className="px-3 py-2 text-right font-medium">After</th>
                          <th className="px-3 py-2 text-right font-medium">Δ XLM</th>
                        </tr>
                      </thead>
                      <tbody>
                        {diff.destinations.map((d) => (
                          <tr key={d.address} className="border-b last:border-0">
                            <td className="px-3 py-2">
                              <ShortAddress address={d.address} network={activeGroup.snapshots[0].network as "public" | "testnet"} />
                            </td>
                            <td className="px-3 py-2">
                              <DeltaBadge kind={d.kind} />
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums font-mono">
                              {formatXlm(d.beforeXlm)}
                              {xlmUsdPrice != null && (
                                <div className="text-[10px] font-normal text-muted-foreground">{formatUsdEstimate(d.beforeXlm, xlmUsdPrice)}</div>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums font-mono">
                              {formatXlm(d.afterXlm)}
                              {xlmUsdPrice != null && (
                                <div className="text-[10px] font-normal text-muted-foreground">{formatUsdEstimate(d.afterXlm, xlmUsdPrice)}</div>
                              )}
                            </td>
                            <td className={`px-3 py-2 text-right tabular-nums font-mono font-semibold ${d.deltaXlm > 0 ? "text-green-500" : d.deltaXlm < 0 ? "text-red-500" : ""}`}>
                              {d.deltaXlm > 0 ? "+" : ""}{formatXlm(d.deltaXlm)}
                              {xlmUsdPrice != null && (
                                <div className="text-[10px] font-normal text-muted-foreground">
                                  {d.deltaXlm > 0 ? "+" : ""}{formatUsdEstimate(d.deltaXlm, xlmUsdPrice)}
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="text-xs text-muted-foreground mt-1.5">
                  &ldquo;left top 50&rdquo; means the address fell out of the top 50 destinations — not proven to be empty.
                </p>
              </div>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}
