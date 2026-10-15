import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "../../fixtures/proceeds/multi-asset-account.json";
import { inferDistribLite } from "@/lib/asset-lookup/fetchers";
import { fetchAssetXlmProceeds } from "@/lib/proceeds-investigator/fetchers";
const base = "https://horizon.example";
const projectIssuer = "GBJ42LHC6OYHZPGYQ6F5TXJHR4I3WD3AUFIXKM2RZTXSOCHOLM6L7NPT";
const usdcIssuer = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const operations: Record<string, unknown> = fixture.operations;
function mock() {
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = new URL(String(input));
    if (url.pathname === "/") return Response.json({ history_elder_ledger: 2 });
    if (url.pathname.startsWith("/ledgers/")) return Response.json({ closed_at: "2025-01-01T00:00:00Z" });
    if (url.pathname.startsWith("/operations/")) return Response.json(operations[url.pathname.split("/")[2]] ?? {});
    if (url.pathname === "/trades") return Response.json({ _embedded: { records: fixture.trades } });
    if (url.pathname === `/accounts/${fixture.account}/payments`) return Response.json({ _embedded: { records: fixture.payments } });
    if (url.pathname === `/accounts/${projectIssuer}/payments`) return Response.json({ _embedded: { records: fixture.issuancePayments.filter(p => p.asset_issuer === projectIssuer) } });
    if (url.pathname.endsWith("/operations")) return Response.json({ _embedded: { records: [] } });
    return Response.json({ balances: [{ asset_type: "native", balance: "0" }] });
  });
}
afterEach(() => vi.unstubAllGlobals());
describe("reproducible multi-asset public account records", () => {
  it("keeps USDC turnover separate from the funded project's realized sales", async () => {
    mock();
    const signal = new AbortController().signal;
    const project = await fetchAssetXlmProceeds(base, "VORIXLM", projectIssuer, [fixture.account], signal);
    const usdc = await fetchAssetXlmProceeds(base, "USDC", usdcIssuer, [fixture.account], signal);
    const expected = fixture.trades.filter(t => t.counter_asset_code === "VORIXLM" && t.counter_account === fixture.account)
      .filter(t => {
        const id = t._links.operation.href.split("/operations/")[1];
        const operation = operations[id] as Record<string, unknown>;
        return !String(operation.type).startsWith("path_payment") || operation.from !== fixture.account;
      })
      .reduce((sum, t) => sum + Number(t.base_amount), 0);
    expect(project.totalXlmProceeds).toBeCloseTo(expected, 7);
    expect(project.totalXlmSpentOnPurchases).toBe(0);
    expect(project.accountWideXlmSpentOnPurchases).toBeGreaterThan(0);
    expect(usdc.totalXlmProceeds).toBeGreaterThan(project.totalXlmProceeds);
    expect(usdc.totalXlmSpentOnPurchases).toBeGreaterThan(0);
    expect(project.proceedsLedger.every(e => e.category === "dex_sale")).toBe(true);
    expect(project.coverage?.complete).toBe(false);
  });
  it("does not turn issuer funding into distributor or owner attribution", async () => {
    mock();
    expect(fixture.funding.some(op => op.funder === fixture.account && op.account === projectIssuer)).toBe(true);
    const candidates = await inferDistribLite(base, "VORIXLM", projectIssuer, new AbortController().signal);
    const actualRecipient = fixture.issuancePayments.find(p => p.asset_issuer === projectIssuer)!.to;
    expect(candidates.map(c => c.address)).toEqual([actualRecipient]);
    expect(candidates.some(c => c.address === fixture.account)).toBe(false);
    expect(candidates[0].evidence?.some(e => e.from === projectIssuer && e.to === actualRecipient)).toBe(true);
  });
  it("excludes a different issuer despite an identical display code", async () => {
    mock();
    const result = await fetchAssetXlmProceeds(base, "USDC", projectIssuer, [fixture.account], new AbortController().signal);
    expect(result.totalXlmProceeds).toBe(0);
    expect(result.totalXlmSpentOnPurchases).toBe(0);
    expect(result.accountWideXlmSpentOnPurchases).toBeGreaterThan(0);
  });
});
