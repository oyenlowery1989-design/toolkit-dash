import { describe, expect, it } from "vitest";
import { summarizeAdPayments } from "@/lib/saved-analyses/payment-review";
import type { AssetProceedsResult, ProceedsLedgerEntry } from "@/lib/proceeds-investigator/types";

const recipient = "GAMMBVZRMZE33O46HKLXOTOV5GOL5Y5RRC4SCMR53SSNQJXLJ6LNVCNJ";
const ledger = (id: string): ProceedsLedgerEntry => ({ id, account: "GDIST", category: "payment", amountXlm: 25, txHash: id, createdAt: "2026-01-01", to: recipient, successful: true });
const result = (outgoingLedger: ProceedsLedgerEntry[] = []): AssetProceedsResult => ({ assetCode: "A", issuer: "GI", accounts: [], totalAssetSold: 1, totalXlmProceeds: 100, totalOutgoingXlm: 0, estimatedOnHandXlm: 0, dexTradeCount: 0, pathSaleCount: 0, proceedsLedger: [], outgoingLedger, topDestinations: [] });
const analysis = (id: string, assetCode: string, timestamp: number, outgoingLedger: ProceedsLedgerEntry[] = []) => ({ id, assetCode, issuer: "GI", network: "public", timestamp, result: result(outgoingLedger) });

describe("summarizeAdPayments", () => {
  it("uses the newest snapshot per asset and flags evidence shared across assets", () => {
    const review = summarizeAdPayments([
      analysis("old", "A", 1, [ledger("old")]),
      analysis("new", "A", 2),
      analysis("b", "B", 1, [ledger("shared")]),
      analysis("c", "C", 1, [ledger("shared")]),
    ], recipient);

    expect(review.items.map((item) => item.id)).toEqual(["new", "b", "c"]);
    expect(review.items.find((item) => item.id === "new")?.classification.status).toBe("unpaid");
    expect(review.items.filter((item) => item.sharedEvidence).map((item) => item.id)).toEqual(["b", "c"]);
    expect(review.uniquePaidXlm).toBe(25);
  });
});
