import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAllCaches, setDbAuthToken } from "@/lib/db-client";
import { getSavedAnalysesSnapshot, useSavedAnalyses, type SavedAnalysisSummary } from "@/hooks/use-saved-analyses";

const harness = vi.hoisted(() => ({ effects: [] as (() => void | (() => void))[], setters: [] as ReturnType<typeof vi.fn>[], dependencies: [] as unknown[][] }));
vi.mock("react", () => ({
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => void | (() => void), dependencies: unknown[]) => { harness.dependencies.push(dependencies); harness.effects.push(effect); },
  useState: (initial: unknown) => { const setter = vi.fn(); harness.setters.push(setter); return [initial, setter]; },
}));

function summary(id: string, next = false): SavedAnalysisSummary {
  return {
    id, name: id, assetCode: "wUSDC", issuer: "issuer", distribAddresses: [], network: "public", timestamp: 1,
    result: { assetCode: "wUSDC", issuer: "issuer", accounts: [], totalAssetSold: 1, totalXlmProceeds: 2, totalOutgoingXlm: 0, estimatedOnHandXlm: 2, dexTradeCount: 1, pathSaleCount: 0, topDestinations: [] },
    ...(next ? { nextCursor: { timestamp: 1, id } } : {}),
  };
}
let cleanups: (() => void)[] = [];
function mount() {
  harness.effects = [];
  harness.dependencies = [];
  // eslint-disable-next-line react-hooks/rules-of-hooks -- React is mocked to exercise the cache lifecycle without a renderer.
  const actions = useSavedAnalyses();
  for (const effect of harness.effects) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); }
  return actions;
}
beforeEach(() => {
  vi.stubGlobal("window", new EventTarget());
  setDbAuthToken("owner-one");
  harness.effects = [];
  harness.setters = [];
});
afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  cleanups = [];
  clearAllCaches();
  setDbAuthToken(null);
  vi.unstubAllGlobals();
});

async function beginPendingPage() {
  let release: (value: Response) => void = () => {};
  const pending = new Promise<Response>((resolve) => { release = resolve; });
  let initial = [summary("first", true)];
  let next = pending;
  const fetch = vi.fn(async (url: string) => url.includes("beforeTimestamp") ? next : Response.json(initial));
  vi.stubGlobal("fetch", fetch);
  mount();
  await vi.waitFor(() => expect(getSavedAnalysesSnapshot().map((entry) => entry.id)).toEqual(["first"]));
  mount();
  await vi.waitFor(() => expect(fetch.mock.calls.some(([url]) => url.includes("beforeTimestamp"))).toBe(true));
  return { fetch, release, replaceInitial: (rows: SavedAnalysisSummary[]) => { initial = rows; }, replaceNext: (response: Response) => { next = Promise.resolve(response); } };
}

describe("saved history continuation guards", () => {
  it("drops a page started before reload, even when the new first page has the same cursor", async () => {
    const pending = await beginPendingPage();
    const previousDependencies = harness.dependencies.at(-1);
    pending.replaceInitial([{ ...summary("first", true), name: "reloaded" }]);
    window.dispatchEvent(new Event("stellardb:sync"));
    await vi.waitFor(() => expect(getSavedAnalysesSnapshot()[0].name).toBe("reloaded"));
    pending.release(Response.json([summary("stale")]));
    await vi.waitFor(() => expect(pending.fetch.mock.results.every((result) => result.type === "return")).toBe(true));
    await Promise.resolve();
    expect(getSavedAnalysesSnapshot().map((entry) => entry.id)).toEqual(["first"]);
    pending.replaceNext(Response.json([summary("current")]));
    mount();
    expect(harness.dependencies.at(-1)).not.toEqual(previousDependencies);
    await vi.waitFor(() => expect(getSavedAnalysesSnapshot().map((entry) => entry.id)).toEqual(["first", "current"]));
  });

  it("drops an old user's page after cache invalidation and a new session load", async () => {
    const pending = await beginPendingPage();
    clearAllCaches();
    setDbAuthToken("owner-two");
    pending.replaceInitial([{ ...summary("first", true), name: "new-owner" }]);
    mount();
    await vi.waitFor(() => expect(getSavedAnalysesSnapshot()[0].name).toBe("new-owner"));
    pending.release(Response.json([summary("old-owner-secret")]));
    await Promise.resolve();
    await Promise.resolve();
    expect(getSavedAnalysesSnapshot().map((entry) => entry.id)).toEqual(["first"]);
  });

  it("deduplicates continuation reads from multiple consumers and keeps raw detail out of list state", async () => {
    const pending = await beginPendingPage();
    mount();
    mount();
    expect(pending.fetch.mock.calls.filter(([url]) => url.includes("beforeTimestamp"))).toHaveLength(1);
    pending.release(Response.json([summary("older")]));
    await vi.waitFor(() => expect(getSavedAnalysesSnapshot()).toHaveLength(2));
    for (const analysis of getSavedAnalysesSnapshot()) {
      expect(analysis.result.outgoingLedger).toBeUndefined();
      expect(analysis.result.proceedsLedger).toBeUndefined();
    }
  });

  it("reports a continuation failure to the consumer", async () => {
    const pending = await beginPendingPage();
    pending.release(Response.json({ error: "failed" }, { status: 500 }));
    await vi.waitFor(() => expect(harness.setters.some((setter) => setter.mock.calls.some(([value]) => typeof value === "string" && value.includes("Loading older analyses failed: 500")))).toBe(true));
  });
});
