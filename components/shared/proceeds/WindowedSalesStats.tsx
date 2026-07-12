"use client";

import { formatXlm } from "@/lib/format";
import { getWindowedSalesTotals } from "@/lib/proceeds-investigator/windowed";
import type { ProceedsLedgerEntry } from "@/lib/proceeds-investigator/types";
import { StatCard } from "./ProceedsStatsCards";

interface WindowedSalesStatsProps {
  ledger: ProceedsLedgerEntry[];
  assetCode: string;
  xlmUsdPrice?: number | null;
  /** Anchor timestamp for "now" — defaults to render time. Pass a fixed value (e.g. a saved analysis's timestamp) for a snapshot. */
  nowMs?: number;
}

/** Last-24h / last-7d sold totals, derived from an already-fetched proceedsLedger (dex_sale/path_sale entries carry real tx timestamps). */
export function WindowedSalesStats({ ledger, assetCode, xlmUsdPrice, nowMs }: WindowedSalesStatsProps) {
  const { last24h, last7d } = getWindowedSalesTotals(ledger, nowMs ?? Date.now());
  const fmtUsd = (n: number) =>
    xlmUsdPrice != null ? (n * xlmUsdPrice).toLocaleString(undefined, { maximumFractionDigits: 0 }) : undefined;

  return (
    <div className="grid grid-cols-2 gap-3">
      <StatCard
        label="Sold (24h)"
        value={`${formatXlm(last24h.xlmProceeds)} XLM`}
        usdValue={fmtUsd(last24h.xlmProceeds)}
        subLabel={`${formatXlm(last24h.assetSold)} ${assetCode}`}
      />
      <StatCard
        label="Sold (7d)"
        value={`${formatXlm(last7d.xlmProceeds)} XLM`}
        usdValue={fmtUsd(last7d.xlmProceeds)}
        subLabel={`${formatXlm(last7d.assetSold)} ${assetCode}`}
      />
    </div>
  );
}
