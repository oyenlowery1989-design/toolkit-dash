import { describe, it, expect } from "vitest";
import { getWindowedSalesTotals } from "@/lib/proceeds-investigator/windowed";
import type { ProceedsLedgerEntry } from "@/lib/proceeds-investigator/types";

const NOW = new Date("2026-07-12T12:00:00Z").getTime();
const DAY_MS = 24 * 60 * 60 * 1000;

function entry(hoursAgo: number, amountXlm: number, assetSoldAmount: number, successful = true): ProceedsLedgerEntry {
  return {
    id: `${hoursAgo}`,
    account: "GACCOUNT",
    category: "dex_sale",
    amountXlm,
    assetSoldAmount,
    txHash: "hash",
    createdAt: new Date(NOW - hoursAgo * 60 * 60 * 1000).toISOString(),
    successful,
  };
}

describe("getWindowedSalesTotals", () => {
  it("buckets entries into last-24h and last-7d windows", () => {
    const ledger = [
      entry(1, 10, 100), // within 24h
      entry(30, 20, 200), // within 7d, not 24h
      entry(24 * 10, 30, 300), // outside both
    ];
    const { last24h, last7d } = getWindowedSalesTotals(ledger, NOW);
    expect(last24h).toEqual({ xlmProceeds: 10, assetSold: 100, count: 1 });
    expect(last7d).toEqual({ xlmProceeds: 30, assetSold: 300, count: 2 });
  });

  it("ignores unsuccessful entries", () => {
    const ledger = [entry(1, 10, 100, false)];
    const { last24h } = getWindowedSalesTotals(ledger, NOW);
    expect(last24h).toEqual({ xlmProceeds: 0, assetSold: 0, count: 0 });
  });

  it("handles empty ledger", () => {
    const { last24h, last7d } = getWindowedSalesTotals([], NOW);
    expect(last24h.count).toBe(0);
    expect(last7d.count).toBe(0);
  });
});
