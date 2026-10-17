import { afterEach, expect, it, vi } from "vitest";
import { fetchTopVerifiedBuyers } from "@/lib/proceeds-investigator/top-buyers";
const issuer = "GISSUER", code = "wUSD", time = "2026-10-15T12:00:00Z", hash = "a".repeat(64);
const custom = { asset_type: "credit_alphanum4", asset_code: code, asset_issuer: issuer };
function trade(id = "100-0", buyer = "BUYER", nativeBase = true, overrides = {}) {
  const native = { asset_type: "native", account: buyer, amount: "5.0000001" }, asset = { ...custom, account: "SELLER", amount: "2" };
  return { id, paging_token: id, ledger_close_time: time, _links: { operation: { href: `/operations/${id.split("-")[0]}` } }, ...Object.fromEntries(Object.entries(nativeBase ? native : asset).map(([k,v]) => [`base_${k}`,v])), ...Object.fromEntries(Object.entries(nativeBase ? asset : native).map(([k,v]) => [`counter_${k}`,v])), ...overrides };
}
function operation(id = "100", overrides = {}) { return { id, transaction_successful: true, transaction_hash: hash, created_at: time, type: "manage_sell_offer", source_account: "SELLER", ...overrides }; }
function mock(pages: ReturnType<typeof trade>[][] = [[trade()]], ops: Record<string, any> = { "100": operation() }, elder = "2020-01-01T00:00:00Z") {
  const fetch = vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    if (url.pathname === "/") return Response.json({ history_elder_ledger: 2 });
    if (url.pathname === "/ledgers/2") return Response.json({ closed_at: elder });
    if (url.pathname.startsWith("/operations/")) { const op = ops[url.pathname.split("/").at(-1)!]; return Response.json(op ?? {}, { status: op ? 200 : 404 }); }
    const cursor = url.searchParams.get("cursor"), index = cursor ? pages.findIndex(page => page.at(-1)?.paging_token === cursor) + 1 : 0;
    return Response.json({ _embedded: { records: pages[index] ?? [] } });
  });
  vi.stubGlobal("fetch", fetch); return fetch;
}
const run = (callbacks = {}, window: "all" | "7d" | "30d" = "all", signal = new AbortController().signal) => fetchTopVerifiedBuyers("https://horizon.example", code, issuer, window, signal, { now: new Date("2026-10-16T00:00:00Z"), ...callbacks });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it("deduplicates orientations, verifies operations once and keeps exact stroops", async () => {
  const fetch = mock([[trade("100-0", "A"), trade("100-1", "A", false), trade("200-0", "B", true, { base_amount: "10.0000003" })]], { "100": operation(), "200": operation("200") });
  const publish = vi.fn(); const result = await run({ onResult: publish });
  expect(result.buyers.map(b => b.address)).toEqual(["B", "A"]);
  expect(result.buyers[1]).toMatchObject({ xlmSpent: "10.0000002", assetBought: "4.0000000", purchaseCount: 1 });
  expect(result.tradesScanned).toBe(3);
  expect(fetch.mock.calls.filter(([url]) => String(url).includes("/operations/100"))).toHaveLength(1);
  const urls = fetch.mock.calls.map(([u]) => new URL(String(u))).filter(u => u.pathname === "/trades");
  expect(urls[0].searchParams.get("counter_asset_code")).toBe(code);
  expect(urls[1].searchParams.get("base_asset_code")).toBe(code);
  expect(publish.mock.calls[0][0].buyers).toHaveLength(1);
  expect(publish.mock.calls[0][0].buyers[0].xlmSpent).toBe("5.0000001");
});
it("credits a source-paid path once using endpoints, never its recipient", async () => {
  mock([[trade(), trade("100-1")]], { "100": operation("100", { type: "path_payment_strict_send", source_account: "BUYER", from: "BUYER", source_asset_type: "native", source_amount: "11", ...custom, amount: "4", to: "RECIPIENT" }) });
  const result = await run();
  expect(result.buyers).toHaveLength(1);
  expect(result.buyers[0]).toMatchObject({ address: "BUYER", xlmSpent: "11.0000000", assetBought: "4.0000000", purchaseCount: 1 });
  expect(result.buyers[0].evidence[0].recipient).toBe("RECIPIENT");
});
it("credits native maker fills even when path source buys another endpoint asset", async () => {
  mock([[trade()]], { "100": operation("100", { type: "path_payment_strict_receive", source_account: "OTHER", from: "OTHER", source_asset_type: "credit_alphanum4", asset_code: "OTHER", to: "RECIPIENT" }) });
  expect((await run()).buyers[0].xlmSpent).toBe("5.0000001");
});
it.each([{ asset_code: "OTHER" }, { source_asset_type: "credit_alphanum4" }])("rejects path source with incorrect endpoint/source %j", async overrides => {
  mock([[trade()]], { "100": operation("100", { type: "path_payment_strict_send", source_account: "BUYER", from: "BUYER", source_asset_type: "native", source_amount: "11", ...custom, amount: "4", to: "RECIPIENT", ...overrides }) });
  expect((await run()).buyers).toEqual([]);
});
it.each(["payment", "claim_claimable_balance", "create_claimable_balance"])("rejects non-purchase %s proof", async type => {
  mock([[trade()]], { "100": operation("100", { type }) }); expect((await run()).buyers).toEqual([]);
});
it.each([{ successful: false }, { transaction_successful: false }, { id: "999" }, { transaction_hash: "bad" }, { created_at: "2026-10-14T00:00:00Z" }])("excludes invalid operation proof %j", async overrides => {
  mock([[trade()]], { "100": operation("100", overrides) }); const result = await run(); expect(result.buyers).toEqual([]); expect(result.skippedRecords).toBe(1); expect(result.warnings.join()).toContain("could not be verified");
});
it("excludes wrong code case, wrong issuer, self trades, issuer buyers and pools without a payer", async () => {
  mock([[trade("100-0", "A", true, { counter_asset_code: "WUSD" }), trade("100-1", "A", true, { counter_asset_issuer: "OTHER" }), trade("100-2", "SELLER"), trade("100-3", issuer), trade("100-4", "", true, { base_liquidity_pool_id: "pool" })]]);
  expect((await run()).skippedRecords).toBe(5);
});
it("warns about retention and filters exact finite date windows", async () => {
  mock([[trade(), trade("100-1", "OLD", true, { ledger_close_time: "2026-10-01T00:00:00Z" })]], undefined, "2026-10-14T00:00:00Z");
  const result = await run({}, "7d"); expect(result.tradesScanned).toBe(1); expect(result.warnings.join()).toContain("partial"); expect(result.requestedFrom).toBe("2026-10-09T00:00:00.000Z");
});
it("paginates both directions through full pages and ranks later records", async () => {
  const first = Array.from({ length: 200 }, (_, i) => trade(`100-${i}`));
  mock([first, [trade("200-0", "LARGEST", true, { base_amount: "2000" })]], { "100": operation(), "200": operation("200") });
  const result = await run(); expect(result.tradesScanned).toBe(201); expect(result.buyers[0].address).toBe("LARGEST");
});
it("rejects pagination cycles and malformed cursors", async () => {
  const page = Array.from({ length: 200 }, (_, i) => trade(`100-${i}`)); mock([page, page]); await expect(run()).rejects.toThrow(/pagination/i);
  mock([[trade("100-0", "BUYER", true, { paging_token: undefined })]]); await expect(run()).rejects.toThrow(/pagination/i);
});
it("rejects corrupt verified amounts instead of returning complete results", async () => {
  mock([[trade("100-0", "BUYER", true, { base_amount: "1e5" })]]); await expect(run()).rejects.toThrow(/amount/i);
});
it("aborts while streaming and leaves an immutable verified snapshot", async () => {
  mock([[trade(), trade("100-1")]]); const controller = new AbortController(), snapshots: any[] = [];
  await expect(run({ onResult: (result: any) => { snapshots.push(result); controller.abort(); } }, "all", controller.signal)).rejects.toThrow();
  expect(snapshots[0].buyers[0].xlmSpent).toBe("5.0000001");
});
it("bounds hanging requests by the configured deadline", async () => {
  vi.useFakeTimers(); vi.stubGlobal("fetch", () => new Promise(() => {}));
  const request = run({ requestTimeoutMs: 10 }); const rejection = expect(request).rejects.toMatchObject({ name: "TimeoutError" });
  await vi.advanceTimersByTimeAsync(20); await rejection;
});
it("requires matching trade hash and linked operation ID", async () => {
  mock([[trade("100-0", "BUYER", true, { transaction_hash: "b".repeat(64) }), trade("100-1", "BUYER", true, { _links: { operation: { href: "/operations/999" } } })]]);
  const result = await run(); expect(result.buyers).toEqual([]); expect(result.skippedRecords).toBe(2);
});
it("reports missing operation proof and unknown history coverage explicitly", async () => {
  const fetch = mock([[trade()]], {});
  vi.stubGlobal("fetch", async (input: string | URL) => new URL(String(input)).pathname === "/" ? Response.json({}) : fetch(input));
  const result = await run(); expect(result.buyers).toEqual([]); expect(result.skippedRecords).toBe(1); expect(result.warnings.join()).toMatch(/coverage is unknown/);
});
it("sorts beyond floating point precision, then by address for exact ties", async () => {
  mock([[trade("100-0", "B", true, { base_amount: "900719925.4740992" }), trade("100-1", "A", true, { base_amount: "900719925.4740992" }), trade("100-2", "C", true, { base_amount: "900719925.4740993" })]]);
  expect((await run()).buyers.map(b => b.address)).toEqual(["C", "A", "B"]);
});
it("supports the 30-day boundary and excludes trades after its fixed snapshot", async () => {
  mock([[trade("100-0", "FUTURE", true, { ledger_close_time: "2026-10-17T00:00:00Z" }), trade("100-1", "BUYER", true, { ledger_close_time: "2026-09-16T00:00:00Z" })]], { "100": operation("100", { created_at: "2026-09-16T00:00:00Z" }) });
  const result = await run({}, "30d"); expect(result.buyers[0].address).toBe("BUYER"); expect(result.requestedFrom).toBe("2026-09-16T00:00:00.000Z");
});
it("accepts each supported offer type and logs every requested URL", async () => {
  for (const type of ["manage_buy_offer", "manage_sell_offer", "create_passive_sell_offer"]) {
    const fetch = mock([[trade()]], { "100": operation("100", { type }) }), log = vi.fn();
    expect((await run({ onLog: log })).buyers).toHaveLength(1);
    for (const [url] of fetch.mock.calls) expect(log).toHaveBeenCalledWith(`  GET ${url}`);
  }
});
it("never publishes completion after an abort while verifying an operation", async () => {
  const original = mock(), controller = new AbortController(), publish = vi.fn();
  vi.stubGlobal("fetch", async (input: string | URL) => {
    if (new URL(String(input)).pathname.startsWith("/operations/")) controller.abort();
    return original(input);
  });
  await expect(run({ onResult: publish }, "all", controller.signal)).rejects.toThrow(); expect(publish).not.toHaveBeenCalled();
});
it("verifies up to four operations concurrently and never refetches shared proof", async () => {
  const trades = Array.from({ length: 9 }, (_, i) => trade(`${100 + i}-0`));
  trades.push(trade("100-1"));
  const ops = Object.fromEntries(trades.map(t => { const id = t.id.split("-")[0]; return [id, operation(id)]; }));
  const original = mock([trades], ops); let active = 0, maximum = 0;
  vi.stubGlobal("fetch", async (input: string | URL) => {
    if (!new URL(String(input)).pathname.startsWith("/operations/")) return original(input);
    active++; maximum = Math.max(maximum, active);
    try { await new Promise(resolve => setTimeout(resolve, 1)); return await original(input); }
    finally { active--; }
  });
  const result = await run(); expect(result.buyers[0].purchaseCount).toBe(9); expect(maximum).toBe(4);
  expect(original.mock.calls.filter(([url]) => String(url).includes("/operations/"))).toHaveLength(9);
});
it.each([{ from: undefined }, { from: "BUYER", source_account: "WRONG" }])("rejects ambiguous path source %j instead of counting a maker fill", async overrides => {
  mock([[trade()]], { "100": operation("100", { type: "path_payment_strict_send", source_account: "BUYER", from: "BUYER", source_asset_type: "native", source_amount: "11", ...custom, amount: "4", to: "RECIPIENT", ...(overrides as Record<string, unknown>) }) });
  const result = await run(); expect(result.buyers).toEqual([]); expect(result.warnings.join()).toContain("sources could not be verified");
});
it("recognizes retained genesis without requiring a separate ledger lookup", async () => {
  const original = mock(); vi.stubGlobal("fetch", async (input: string | URL) => new URL(String(input)).pathname === "/" ? Response.json({ history_elder_ledger: 1 }) : original(input));
  const result = await run({}, "7d"); expect(result.warnings).toEqual([]);
  expect(original.mock.calls.some(([url]) => String(url).includes("/ledgers/"))).toBe(false);
});
it("streams a verified purchase while another operation is still pending", async () => {
  const original = mock([[trade("100-0"), trade("101-0")]], { "100": operation(), "101": operation("101") });
  const controller = new AbortController(), snapshots: any[] = [];
  vi.stubGlobal("fetch", (input: string | URL) => new URL(String(input)).pathname === "/operations/101" ? new Promise(() => {}) : original(input));
  const request = run({ onResult: (result: any) => { snapshots.push(result); controller.abort(); } }, "all", controller.signal);
  await expect(request).rejects.toThrow();
  expect(snapshots[0].buyers[0].xlmSpent).toBe("5.0000001");
});
