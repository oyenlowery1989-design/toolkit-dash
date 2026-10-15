import { afterEach, expect, it, vi } from "vitest";
import { fetchTopAssetHolders } from "@/lib/proceeds-investigator/top-holders";
const issuer = "GISSUER";
const record = (id: string, balance: string, code = "WhipSim", assetIssuer = issuer) => ({ id, paging_token: id, balances: [{ asset_type: "credit_alphanum12", asset_code: code, asset_issuer: assetIssuer, balance }] });
function mock(pages = [[record("A", "10"), record("B", "30"), record("C", "20"), record("D", "40")]], extra: Record<string, unknown> = {}) {
  const fetch = vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    if (url.pathname === "/assets") return Response.json({ _embedded: { records: [{ asset_code: "WhipSim", asset_issuer: issuer, claimable_balances_amount: "25", liquidity_pools_amount: "50", contracts_amount: "25", ...extra }] } });
    const cursor = url.searchParams.get("cursor");
    const index = cursor ? pages.findIndex(page => page.at(-1)?.paging_token === cursor) + 1 : 0;
    return Response.json({ _embedded: { records: pages[index] ?? [] } });
  });
  vi.stubGlobal("fetch", fetch); return fetch;
}
afterEach(() => vi.unstubAllGlobals());
it("sorts every account and divides by account balances plus claimables, pools and contracts", async () => {
  mock();
  const log = vi.fn(), result = vi.fn();
  const data = await fetchTopAssetHolders("https://horizon.example", "WhipSim", issuer, new AbortController().signal, { onLog: log, onResult: result });
  expect(data.holders.map(h => h.address)).toEqual(["D", "B", "C"]);
  expect(data.holders.map(h => h.percentage)).toEqual([20, 15, 10]);
  expect(data.observedSupply).toBe("200.0000000");
  expect(data.holderCount).toBe(4);expect(data.accountsScanned).toBe(4);
  expect(log.mock.calls.some(([line]) => line.includes("GET https://horizon.example/accounts?"))).toBe(true);
  expect(result).toHaveBeenCalledWith(data);
});
it("paginates beyond 200 and keeps exact code plus issuer matching", async () => {
  const page = Array.from({ length: 200 }, (_, i) => record(String(i), "1"));
  const fetch = mock([page, [record("largest", "500"), record("wrong-case", "999", "WHIPSIM"), record("wrong-issuer", "999", "WhipSim", "other")]]);
  const data = await fetchTopAssetHolders("https://horizon.example", "WhipSim", issuer, new AbortController().signal);
  expect(data.holders[0].address).toBe("largest");expect(data.holderCount).toBe(201);
  expect(data.observedSupply).toBe("800.0000000");
  const accounts = fetch.mock.calls.map(([u]) => new URL(String(u))).filter(u => u.pathname === "/accounts");
  expect(accounts[1].searchParams.get("cursor")).toBe("199");
  expect(accounts[0].searchParams.get("asset")).toBe(`WhipSim:${issuer}`);
});
it("handles empty and zero-balance accounts without inventing holders", async () => {
  mock([[record("zero", "0")]], { claimable_balances_amount: "0", liquidity_pools_amount: "0", contracts_amount: "0" });
  const data = await fetchTopAssetHolders("https://horizon.example", "WhipSim", issuer, new AbortController().signal);
  expect(data.holders).toEqual([]);expect(data.holderCount).toBe(0);
});
it("keeps percentages unknown when non-account supply cannot be verified", async () => {
  mock(undefined, { contracts_amount: undefined });
  const data = await fetchTopAssetHolders("https://horizon.example", "WhipSim", issuer, new AbortController().signal);
  expect(data.holders[0].address).toBe("D");expect(data.holders[0].percentage).toBeNull();expect(data.warning).toBeTruthy();
});
it("does not mark an interrupted scan as a completed ranking", async () => {
  const controller = new AbortController();mock();
  await expect(fetchTopAssetHolders("https://horizon.example", "WhipSim", issuer, controller.signal, { onProgress: () => controller.abort() })).rejects.toThrow();
});
it("rejects a repeated full-page cursor instead of claiming these are the global top holders", async () => {
  const page = Array.from({ length: 200 }, (_, i) => record(String(i), "1"));
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = new URL(String(input));
    return Response.json({ _embedded: { records: url.pathname === "/assets" ? [] : page } });
  });
  await expect(fetchTopAssetHolders("https://horizon.example", "WhipSim", issuer, new AbortController().signal)).rejects.toThrow(/pagination/i);
});
it("preserves fractional balances and excludes duplicate account records", async () => {
  mock([[record("A", "0.0000001"), record("A", "0.0000001"), record("B", "0.0000002")]], { claimable_balances_amount: "0", liquidity_pools_amount: "0", contracts_amount: "0" });
  const data = await fetchTopAssetHolders("https://horizon.example", "WhipSim", issuer, new AbortController().signal);
  expect(data.observedSupply).toBe("0.0000003");expect(data.holders[0].balance).toBe("0.0000002");
  expect(data.holders[0].percentage).toBeCloseTo(200/3);
});
it("keeps the holder ranking available if the asset statistics endpoint fails", async () => {
  const original = mock();
  vi.stubGlobal("fetch", async (input: string | URL) => new URL(String(input)).pathname === "/assets" ? Response.json({}, { status: 404 }) : original(input));
  const result = await fetchTopAssetHolders("https://horizon.example", "WhipSim", issuer, new AbortController().signal);
  expect(result.holders).toHaveLength(3);expect(result.observedSupply).toBeNull();expect(result.holders.every(h => h.percentage === null)).toBe(true);
});
it("rejects malformed or negative balances rather than publishing a misleading ranking", async () => {
  mock([[record("invalid", "-10")]]);
  const publish = vi.fn();
  await expect(fetchTopAssetHolders("https://horizon.example", "WhipSim", issuer, new AbortController().signal, { onResult: publish })).rejects.toThrow(/balance/i);
  expect(publish).not.toHaveBeenCalled();
});
