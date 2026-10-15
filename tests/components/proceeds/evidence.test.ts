import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProceedsStatsCards } from "@/components/shared/proceeds/ProceedsStatsCards";
import { ProceedsEvidence } from "@/components/shared/proceeds/ProceedsEvidence";
import type { AssetProceedsResult } from "@/lib/proceeds-investigator/types";
vi.mock("@/components/shared/ShortAddress", () => ({ ShortAddress: ({ address }: { address: string }) => React.createElement("span", null, address) }));
vi.mock("@/components/shared/proceeds/SaveToGroupButton", () => ({ SaveToGroupButton: () => null }));
const result = (): AssetProceedsResult => ({ assetCode: "WhipSim", issuer: "issuer", accounts: ["seller-a", "relay"], totalAssetSold: 100, totalXlmProceeds: 20, totalOutgoingXlm: 7, estimatedOnHandXlm: 999, dexTradeCount: 1, pathSaleCount: 0, proceedsLedger: [], outgoingLedger: [], topDestinations: [], totalXlmSpentOnPurchases: 4, accountWideXlmSpentOnPurchases: 12, currentXlmBalance: 3.5,
  coverage: { requestedFrom: "2026-01-01T00:00:00Z", requestedTo: "2026-02-01T00:00:00Z", complete: false, warnings: ["Earlier history pruned"] },
  sellerAttributions: [ { account: "seller-a", source: "inferred", confirmedSeller: true, saleEvidenceIds: ["sale-1"], evidence: [{ kind: "claimable_balance", from: "relay", to: "seller-a", amount: "100", operationId: "create-1", claimOperationId: "claim-1", claimTransactionHash: "confirmed-claim", balanceId: "balance-1" }] }, { account: "relay", source: "inferred", confirmedSeller: false, evidence: [] } ],
});
beforeEach(() => vi.stubGlobal("React", React));
describe("proceeds presentation", () => {
  it("separates gross sales, target purchases, turnover, transfers and actual balance", () => {
    const html = renderToStaticMarkup(React.createElement(ProceedsStatsCards, { result: result(), assetCode: "WhipSim" }));
    for (const label of ["Gross XLM sale output", "XLM spent buying WhipSim", "All-asset XLM purchases", "External XLM transfers", "XLM balance at scan"]) expect(html).toContain(label);
    expect(html).not.toContain("999");
    expect(html).not.toContain("Est. Proceeds Remaining");
    expect(html).toContain("not profit");
  });
  it("labels contract conversions separately while retaining gross receipts", () => {
    const html = renderToStaticMarkup(React.createElement(ProceedsStatsCards, { result: { ...result(), contractSaleCount: 1 }, assetCode: "USDC" }));
    expect(html).toContain("1 contract conversion(s)");
    expect(html).toContain("not profit");
  });
  it("exposes proof, confirmed seller distinction, dates and incomplete history", () => {
    const html = renderToStaticMarkup(React.createElement(ProceedsEvidence, { result: result(), network: "public" }));
    expect(html).toContain("Confirmed asset → XLM seller");
    expect(html).toContain("no confirmed sale in covered records");
    expect(html).toContain("confirmed-claim");
    expect(html).toContain("claim-1");
    expect(html).toContain("2026-01-01T00:00:00Z");
    expect(html).toContain("Earlier history pruned");
    expect(html).toContain("Funding evidence alone does not prove selling");
  });
  it("does not invent balance or coverage for older saved snapshots", () => {
    const old = result();delete old.coverage;delete old.currentXlmBalance;delete old.totalXlmSpentOnPurchases;
    delete old.accountWideXlmSpentOnPurchases;
    const stats = renderToStaticMarkup(React.createElement(ProceedsStatsCards, { result: old, assetCode: "WhipSim" }));
    expect(stats).toContain("Unknown");
    expect(stats).toContain("Legacy outgoing XLM");
    expect(stats).not.toContain("External XLM transfers");
    expect(renderToStaticMarkup(React.createElement(ProceedsEvidence, { result: old, network: "public" }))).toContain("older snapshot did not store its coverage");
  });
  it("states the account lifetime bound and links creation proof without claiming asset-wide completeness", () => {
    const data = result();
    data.coverage = { requestedFrom: null, requestedTo: "2026-10-15T00:00:00Z", complete: true, warnings: [],
      accountHistoryStarts: [{ account: "seller-a", createdAt: "2026-09-22T18:32:23Z", operationId: "creation", txHash: "creation-tx" }] };
    const html = renderToStaticMarkup(React.createElement(ProceedsEvidence, { result: data, network: "public" }));
    expect(html).toContain("History covered since observed account creation");
    expect(html).toContain("2026-09-22T18:32:23Z");
    expect(html).toContain("/tx/creation-tx");
    expect(html).toContain("Selected accounts only; earlier account incarnations are unverified");
    expect(html).not.toContain("History coverage is incomplete or unproven");
  });
});
