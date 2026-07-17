"use client";

import { formatXlm } from "@/lib/format";
import type { AssetProceedsResult } from "@/lib/proceeds-investigator/types";

interface ProceedsStatsCardsProps {
  result: AssetProceedsResult;
  assetCode: string;
  xlmUsdPrice?: number | null;
  showAssetSold?: boolean;
}

export function StatCard({
  label,
  value,
  usdValue,
  subLabel,
}: {
  label: string;
  value: string;
  usdValue?: string;
  subLabel?: string;
}) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide">
        {label}
      </p>
      <p className="text-lg font-bold font-mono tabular-nums mt-0.5">{value}</p>
      {usdValue && <p className="text-[11px] text-muted-foreground">≈ ${usdValue}</p>}
      {subLabel && <p className="text-[11px] text-muted-foreground">{subLabel}</p>}
    </div>
  );
}

/** Standard 4-up stats grid for an AssetProceedsResult: proceeds, asset sold, outgoing, on-hand. */
export function ProceedsStatsCards({ result, assetCode, xlmUsdPrice, showAssetSold = true }: ProceedsStatsCardsProps) {
  const fmtUsd = (n: number) =>
    (n * (xlmUsdPrice ?? 0)).toLocaleString(undefined, { maximumFractionDigits: 0 });

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <StatCard
        label="Total XLM Proceeds"
        value={formatXlm(result.totalXlmProceeds)}
        usdValue={xlmUsdPrice != null ? fmtUsd(result.totalXlmProceeds) : undefined}
      />
      {showAssetSold && (
        <StatCard label={`${assetCode} Sold`} value={formatXlm(result.totalAssetSold)} />
      )}
      <StatCard label="Total Outgoing XLM" value={formatXlm(result.totalOutgoingXlm)} />
      <StatCard
        label="Estimated On-Hand"
        value={formatXlm(result.estimatedOnHandXlm)}
        usdValue={xlmUsdPrice != null ? fmtUsd(result.estimatedOnHandXlm) : undefined}
      />
    </div>
  );
}
