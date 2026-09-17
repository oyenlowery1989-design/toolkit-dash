import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SavedAnalysis } from "@/hooks/use-saved-analyses";

const mocks = vi.hoisted(() => ({ analyses: [] as SavedAnalysis[], recipient: "GAMMBVZRMZE33O46HKLXOTOV5GOL5Y5RRC4SCMR53SSNQJXLJ6LNVCNJ" }));
vi.mock("@/hooks/use-saved-analyses", () => ({ useSavedAnalyses: () => ({ analyses: mocks.analyses, isLoaded: true, error: null }) }));
vi.mock("@/lib/settings", () => ({ useSettings: () => ({ settings: { adPaymentRecipient: mocks.recipient } }) }));

import { AdPaymentsPanel } from "@/components/ad-payments/AdPaymentsPanel";

const analysis = (id: string, assetCode: string, amount = 0): SavedAnalysis => ({
  id, name: assetCode, assetCode, issuer: "GI", distribAddresses: [], network: "public", timestamp: 1,
  result: { assetCode, issuer: "GI", accounts: [], totalAssetSold: 1, totalXlmProceeds: 100, totalOutgoingXlm: amount, estimatedOnHandXlm: 0, dexTradeCount: 0, pathSaleCount: 0, proceedsLedger: [], outgoingLedger: amount ? [{ id, account: "GD", category: "payment", amountXlm: amount, txHash: id, createdAt: "2026-01-01", to: mocks.recipient, successful: true }] : [], topDestinations: [] },
});

describe("AdPaymentsPanel", () => {
  it("puts unpaid assets in the review queue and links to Asset Sales", () => {
    mocks.analyses = [analysis("paid", "PAID", 25), analysis("unpaid", "UNPAID")];
    const html = renderToStaticMarkup(React.createElement(AdPaymentsPanel));
    expect(html).toContain("Needs review (1)");
    expect(html).toContain("UNPAID");
    expect(html).toContain('href="/asset-sales?asset=UNPAID&amp;issuer=GI&amp;network=public"');
  });
});
