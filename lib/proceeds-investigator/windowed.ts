import type { ProceedsLedgerEntry } from "./types";

export interface WindowedTotal {
  xlmProceeds: number;
  assetSold: number;
  count: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function sumWindow(ledger: ProceedsLedgerEntry[], sinceMs: number, nowMs: number): WindowedTotal {
  let xlmProceeds = 0;
  let assetSold = 0;
  let count = 0;
  for (const entry of ledger) {
    if (!entry.successful) continue;
    const t = new Date(entry.createdAt).getTime();
    if (Number.isNaN(t) || t < sinceMs || t > nowMs) continue;
    xlmProceeds += entry.amountXlm;
    assetSold += entry.assetSoldAmount ?? 0;
    count += 1;
  }
  return { xlmProceeds, assetSold, count };
}

/** Sums proceedsLedger sale entries (dex_sale/path_sale) into last-24h and last-7d windows, anchored to nowMs. */
export function getWindowedSalesTotals(ledger: ProceedsLedgerEntry[], nowMs: number) {
  return {
    last24h: sumWindow(ledger, nowMs - DAY_MS, nowMs),
    last7d: sumWindow(ledger, nowMs - 7 * DAY_MS, nowMs),
  };
}
