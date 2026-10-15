import { afterEach, expect, it, vi } from "vitest";
import { loadSavedDistributors } from "@/lib/proceeds-investigator/saved-distributors";

vi.mock("@/lib/db-client", () => ({ waitForAuth: async () => {}, authHeaders: () => ({ Authorization: "Bearer test" }) }));
const account = "GBHWTASVVCTOEIPWDJ7QFVKCP5XN3VRSQLD2ZARWO2GTH54GDQ4BI3EH";
const run = (signal = new AbortController().signal) => loadSavedDistributors("WhipSim", account, "public", signal);
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("preserves asset case, authentication and all unique saved sellers", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ accounts: [account, account] }));
  vi.stubGlobal("fetch", fetcher);
  expect(await run()).toEqual([account]);
  expect(fetcher.mock.calls[0][0]).toContain("assetCode=WhipSim");
  expect(fetcher.mock.calls[0][1]).toMatchObject({ headers: { Authorization: "Bearer test" }, cache: "no-store" });
});
it.each([{ accounts: [] }, { accounts: [account] }])("accepts a complete successful saved read: $accounts", async ({ accounts }) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ accounts })));
  expect(await run()).toEqual(accounts);
});
it.each([{ accounts: ["invalid"] }, { accounts: null }, {}])("rejects malformed data rather than inferring from missing evidence", async body => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body)));
  await expect(run()).rejects.toThrow("Saved distributors could not be loaded");
});
it("reports failed reads", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 502 })));
  await expect(run()).rejects.toThrow("Retry the analysis");
});
it("bounds the request and propagates cancellation", async () => {
  vi.spyOn(AbortSignal, "timeout").mockImplementation(() => AbortSignal.abort(new DOMException("Timed out", "TimeoutError")));
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => { options.signal.throwIfAborted(); throw new Error("unreachable"); }));
  await expect(run()).rejects.toThrow("Saved distributors could not be loaded");
  const controller = new AbortController(); controller.abort();
  await expect(run(controller.signal)).rejects.toThrow();
});
it("cancels an already pending saved-distributor request", async () => {
  const started = vi.fn();
  vi.stubGlobal("fetch", vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true }); started();
  })));
  const controller = new AbortController();
  const request = run(controller.signal);
  await vi.waitFor(() => expect(started).toHaveBeenCalledOnce());
  controller.abort();
  await expect(request).rejects.toThrow();
});
