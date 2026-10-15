"use client";

import { formatXlm } from "@/lib/format";
import type { AssetProceedsResult } from "@/lib/proceeds-investigator/types";

interface ProceedsStatsCardsProps {
  result: Pick<AssetProceedsResult, "totalXlmProceeds" | "totalAssetSold" | "totalOutgoingXlm" | "estimatedOnHandXlm" | "totalXlmSpentOnPurchases" | "accountWideXlmSpentOnPurchases" | "currentXlmBalance" | "totalInternalTransferXlm" | "externalSaleDeliveryXlm" | "contractSaleCount">;
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

/** Standard stats grid for an AssetProceedsResult. */
export function ProceedsStatsCards({ result, assetCode, xlmUsdPrice, showAssetSold = true }: ProceedsStatsCardsProps) {
  const fmtUsd = (n: number) =>
    (n * (xlmUsdPrice ?? 0)).toLocaleString(undefined, { maximumFractionDigits: 0 });

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      <StatCard label="Gross XLM sale output" value={formatXlm(result.totalXlmProceeds)} usdValue={xlmUsdPrice != null ? fmtUsd(result.totalXlmProceeds) : undefined} subLabel={`Asset → XLM, including direct delivery${result.contractSaleCount ? ` and ${result.contractSaleCount} contract conversion(s)` : ""}; not profit`} />
      {showAssetSold && <StatCard label={`${assetCode} Sold`} value={formatXlm(result.totalAssetSold)} />}
      <StatCard label={`XLM spent buying ${assetCode}`} value={result.totalXlmSpentOnPurchases === undefined ? "Unknown" : formatXlm(result.totalXlmSpentOnPurchases)} />
      <StatCard label="All-asset XLM purchases" value={result.accountWideXlmSpentOnPurchases === undefined ? "Unknown" : formatXlm(result.accountWideXlmSpentOnPurchases)} subLabel="Account-wide; includes the selected asset" />
      <StatCard label={result.accountWideXlmSpentOnPurchases === undefined ? "Legacy outgoing XLM" : "External XLM transfers"} value={formatXlm(result.totalOutgoingXlm)} subLabel={result.accountWideXlmSpentOnPurchases === undefined ? "Older accounting; may include purchases or internal transfers" : "Account-wide; includes sale output delivered elsewhere"} />
      {result.totalInternalTransferXlm !== undefined && <StatCard label="Transfers within selected accounts" value={formatXlm(result.totalInternalTransferXlm)} />}
      <StatCard label="XLM balance at scan" value={result.currentXlmBalance == null ? "Unknown" : formatXlm(result.currentXlmBalance)} subLabel="Fetched during this scan; not profit" />
    </div>
  );
}
