import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearAllCaches, setDbAuthToken } from "@/lib/db-client";
import { getSavedAnalysesSnapshot, loadSavedAnalysis, useSavedAnalyses, type SavedAnalysis } from "@/hooks/use-saved-analyses";

const snapshot: SavedAnalysis = {
  id: "old-id", name: "Old snapshot", assetCode: "wUSDC", issuer: "issuer", distribAddresses: ["sender"], network: "public", timestamp: 1,
  result: { assetCode: "wUSDC", issuer: "issuer", accounts: ["sender"], totalAssetSold: 10, totalXlmProceeds: 20, totalOutgoingXlm: 8, estimatedOnHandXlm: 12, dexTradeCount: 1, pathSaleCount: 0, proceedsLedger: [], outgoingLedger: [], topDestinations: [] },
};
afterEach(() => { vi.unstubAllGlobals(); clearAllCaches(); setDbAuthToken(null); });

describe("saved-analysis client loading", () => {
  it("save-only usage sends a write without fetching or marking history loaded", async () => {
    setDbAuthToken("owner-token");
    const fetch = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetch);
    const capture = vi.fn();
    function Saver() { const actions = useSavedAnalyses({ load: false }); capture(actions); return null; }
    renderToStaticMarkup(React.createElement(Saver));
    const actions = capture.mock.calls[0][0] as ReturnType<typeof useSavedAnalyses>;
    const { id: _id, timestamp: _timestamp, ...entry } = snapshot;
    actions.saveAnalysis(entry);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(fetch.mock.calls[0]).toEqual(["/api/db/saved-analyses", expect.objectContaining({ method: "POST" })]);
    expect(getSavedAnalysesSnapshot()).toEqual([]);
    expect(actions.isLoaded).toBe(false);
  });

  it("fetches complete detail only through the explicit loader with auth and abort support", async () => {
    setDbAuthToken("owner-token");
    const fetch = vi.fn(async () => Response.json(snapshot));
    vi.stubGlobal("fetch", fetch);
    expect(getSavedAnalysesSnapshot()).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    const controller = new AbortController();
    expect(await loadSavedAnalysis("old-id", controller.signal)).toEqual(snapshot);
    expect(getSavedAnalysesSnapshot()).toEqual([]);
    expect(fetch.mock.calls[0]).toEqual(["/api/db/saved-analyses?id=old-id", { headers: { Authorization: "Bearer owner-token" }, signal: controller.signal }]);
  });

  it("rejects detail returned after the authenticated session changes", async () => {
    setDbAuthToken("owner-token");
    let release: (response: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => { release = resolve; });
    const fetch = vi.fn(() => pending);
    vi.stubGlobal("fetch", fetch);
    const detail = loadSavedAnalysis("old-id");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    setDbAuthToken("new-owner-token");
    release(Response.json(snapshot));
    await expect(detail).rejects.toThrow("no longer current");
    expect(getSavedAnalysesSnapshot()).toEqual([]);
  });

  it("surfaces failed detail loads", async () => {
    setDbAuthToken("owner-token");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "failed" }, { status: 500 })));
    await expect(loadSavedAnalysis("old-id")).rejects.toThrow("Loading saved analysis failed: 500");
  });
});
