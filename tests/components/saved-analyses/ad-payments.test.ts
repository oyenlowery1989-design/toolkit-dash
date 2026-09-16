import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SavedAnalysis } from "@/hooks/use-saved-analyses";
import type { AssetProceedsResult, ProceedsLedgerEntry } from "@/lib/proceeds-investigator/types";
import type { Settings } from "@/lib/settings";
import type { AddressBookEntry } from "@/hooks/use-address-book";

const mocks = vi.hoisted(() => ({ analyses: [] as SavedAnalysis[], entries: [] as AddressBookEntry[], settings: null as Settings | null, saveAnalysis: vi.fn(), fetchAssetXlmProceeds: vi.fn() }));

vi.mock("@/hooks/use-saved-analyses", () => ({ useSavedAnalyses: () => ({ analyses: mocks.analyses, isLoaded: true, error: null, saveAnalysis: mocks.saveAnalysis }) }));
vi.mock("@/hooks/use-address-book", async (importOriginal) => ({ ...await importOriginal<typeof import("@/hooks/use-address-book")>(), useAddressBook: () => ({ entries: mocks.entries }) }));
vi.mock("@/hooks/use-xlm-usd-price", () => ({ useXlmUsdPrice: () => ({ price: null, ensure: vi.fn() }) }));
vi.mock("@/lib/settings", () => ({ NETWORK_LABELS: { public: "Mainnet" }, resolveHorizonUrl: () => "https://horizon.test", useSettings: () => ({ settings: mocks.settings, updateSettings: vi.fn() }) }));
vi.mock("@/lib/proceeds-investigator/fetchers", () => ({ fetchAssetXlmProceeds: mocks.fetchAssetXlmProceeds }));
vi.mock("@/components/shared/ShortAddress", () => ({ ShortAddress: () => null }));
vi.mock("@/components/shared/proceeds/ProceedsDestinationsTable", () => ({ ProceedsDestinationsTable: () => null }));
vi.mock("@/components/shared/proceeds/WindowedSalesStats", () => ({ WindowedSalesStats: () => null }));
vi.mock("@/components/saved-analyses/SnapshotCompare", () => ({ SnapshotCompare: () => null }));

import { SavedAnalysesPanel, rerunAnalysis } from "@/components/saved-analyses/SavedAnalysesPanel";

const RECIPIENT = "GAMMBVZRMZE33O46HKLXOTOV5GOL5Y5RRC4SCMR53SSNQJXLJ6LNVCNJ";
const OTHER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
function ledger(overrides: Partial<ProceedsLedgerEntry> = {}): ProceedsLedgerEntry { return { id: "payment", account: "GDIST", category: "payment", amountXlm: 25, txHash: "tx", createdAt: "2026-01-01", to: RECIPIENT, successful: true, ...overrides }; }
function result(overrides: Partial<AssetProceedsResult> = {}): AssetProceedsResult { return { assetCode: "FOO", issuer: "GISSUER", accounts: ["GDIST"], totalAssetSold: 1, totalXlmProceeds: 100, totalOutgoingXlm: 0, estimatedOnHandXlm: 0, dexTradeCount: 1, pathSaleCount: 0, proceedsLedger: [], outgoingLedger: [], topDestinations: [], ...overrides }; }
function analysis(overrides: Partial<SavedAnalysis> = {}): SavedAnalysis { return { id: "id", name: "snapshot", assetCode: "FOO", issuer: "GISSUER", distribAddresses: ["GDIST"], network: "public", timestamp: 1, result: result(), ...overrides }; }
function settings(recipient = RECIPIENT): Settings { return { network: "public", localHorizonUrl: "http://localhost:8000", workerThreads: 4, notifications: false, adPaymentRecipient: recipient }; }
function panelMarkup(analyses: SavedAnalysis[], recipient = RECIPIENT): string { mocks.analyses = analyses; mocks.settings = settings(recipient); vi.stubGlobal("React", React); return renderToStaticMarkup(React.createElement(SavedAnalysesPanel)); }

describe("SavedAnalysesPanel ad payments", () => {
  it("renders all classifier statuses from real snapshot results", () => {
    const html = panelMarkup([analysis({ id: "compliant", assetCode: "COMPLIANT", result: result({ outgoingLedger: [ledger()] }) }), analysis({ id: "underpaid", assetCode: "UNDERPAID", result: result({ outgoingLedger: [ledger({ amountXlm: 1 })] }) }), analysis({ id: "unpaid", assetCode: "UNPAID" }), analysis({ id: "unknown", assetCode: "UNKNOWN", result: null as unknown as AssetProceedsResult })]);
    for (const status of ["Compliant", "Underpaid", "Unpaid", "Unknown"]) expect(html).toContain(status);
  });
  it("orders latest assets by payment status", () => {
    const html = panelMarkup([
      analysis({ id: "unknown", assetCode: "UNKNOWN", result: null as unknown as AssetProceedsResult }),
      analysis({ id: "underpaid", assetCode: "UNDERPAID", result: result({ outgoingLedger: [ledger({ amountXlm: 1 })] }) }),
      analysis({ id: "unpaid", assetCode: "UNPAID" }),
      analysis({ id: "compliant", assetCode: "COMPLIANT", result: result({ outgoingLedger: [ledger()] }) }),
    ]);
    expect(html.indexOf("COMPLIANT")).toBeLessThan(html.indexOf("UNPAID"));
    expect(html.indexOf("UNPAID")).toBeLessThan(html.indexOf("UNDERPAID"));
    expect(html.indexOf("UNDERPAID")).toBeLessThan(html.indexOf("UNKNOWN"));
  });
  it("uses only the newest snapshot per asset identity", () => {
    const html = panelMarkup([analysis({ id: "old", name: "old paid", timestamp: 1, result: result({ outgoingLedger: [ledger()] }) }), analysis({ id: "new", name: "new unpaid", timestamp: 2, result: result() })]);
    expect(html).toContain("Unpaid (1)"); expect(html).toContain("Compliant (0)");
    const rows = html.split('aria-label="Ad payment assets"')[1].split("</section>")[0];
    expect(rows).toContain("Unpaid"); expect(rows).not.toContain("Compliant");
  });
  it("keeps malformed results visible as Unknown and gates rows without a configured recipient", () => {
    expect(panelMarkup([analysis({ result: null as unknown as AssetProceedsResult })])).toContain("Unknown");
    const html = panelMarkup([analysis({ result: result({ outgoingLedger: [ledger({ to: OTHER })] }) })], "not-a-recipient");
    expect(html).toContain("Configure a valid recipient to classify ad payments."); expect(html).not.toContain("Unpaid");
  });
  it("shows the current persisted recipient in the form", () => { expect(panelMarkup([], RECIPIENT)).toContain(`value="${RECIPIENT}"`); });
  it("links a matching Address Book contact and keeps its address after the contact is removed", () => {
    mocks.entries = [{ publicKey: RECIPIENT, label: "Ad manager", color: "purple", timestamp: 1 }];
    const linked = panelMarkup([analysis()]);
    expect(linked).toContain("Linked to Ad manager");
    expect(linked).toContain("bg-purple-400");
    expect(linked).toContain('href="/address-book"');
    mocks.entries = [];
    const removed = panelMarkup([analysis()]);
    expect(removed).toContain("Its saved address is still used.");
    expect(removed).toContain(`value="${RECIPIENT}"`);
    expect(removed).toContain("Unpaid (1)");
  });
  it("counts latest snapshots once and shows network-specific totals excluding unknown results", () => {
    const html = panelMarkup([
      analysis({ id: "old", timestamp: 1, result: result({ outgoingLedger: [ledger({ amountXlm: 90 })] }) }),
      analysis({ id: "new", timestamp: 2, result: result({ outgoingLedger: [ledger({ amountXlm: 10 })] }) }),
      analysis({ id: "unknown", assetCode: "UNKNOWN", result: null as unknown as AssetProceedsResult }),
      analysis({ id: "testnet", network: "testnet", result: result({ outgoingLedger: [ledger({ amountXlm: 40 })] }) }),
    ]);
    expect(html).toContain("4 saved snapshots · 3 assets");
    expect(html).toContain("All (3)");
    expect(html).toContain("Underpaid (1)");
    expect(html).toContain("Unknown (1)");
    const totals = html.split('aria-label="Ad payment snapshot totals"')[1].split('aria-label="Ad payment assets"')[0];
    expect(totals).toContain("Observed total: 10 XLM");
    expect(totals).toContain("Observed total: 40 XLM");
    expect(totals).toContain("Shortfall total: 15 XLM");
    expect(totals).not.toContain("90 XLM");
    expect(totals).toContain("Unknown results are excluded");
    expect(html).toContain('aria-label="Filter ad payments by status"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Snapshot saved");
  });
});

describe("rerunAnalysis", () => {
  it("fetches and saves a fresh result with the selected analysis metadata", async () => {
    const selected = analysis({ assetCode: "ONLY", issuer: "GONLY", distribAddresses: ["GA", "GB"], notes: "note", tags: ["tag"] }); const fresh = result({ assetCode: "ONLY", issuer: "GONLY" }); const save = vi.fn(); mocks.fetchAssetXlmProceeds.mockResolvedValueOnce(fresh);
    await rerunAnalysis(selected, settings(), save, new AbortController().signal);
    expect(mocks.fetchAssetXlmProceeds).toHaveBeenCalledWith("https://horizon.test", "ONLY", "GONLY", ["GA", "GB"], expect.any(AbortSignal));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: "snapshot", assetCode: "ONLY", issuer: "GONLY", distribAddresses: ["GA", "GB"], notes: "note", tags: ["tag"], result: fresh }));
  });
  it("does not save when the fetch throws or the signal aborts before its result resolves", async () => {
    const save = vi.fn(); mocks.fetchAssetXlmProceeds.mockRejectedValueOnce(new Error("nope")); await expect(rerunAnalysis(analysis(), settings(), save, new AbortController().signal)).rejects.toThrow("nope"); expect(save).not.toHaveBeenCalled();
    let resolve!: (value: AssetProceedsResult) => void; mocks.fetchAssetXlmProceeds.mockReturnValueOnce(new Promise<AssetProceedsResult>((done) => { resolve = done; })); const controller = new AbortController(); const pending = rerunAnalysis(analysis(), settings(), save, controller.signal); controller.abort(); resolve(result()); await pending; expect(save).not.toHaveBeenCalled();
  });
});
