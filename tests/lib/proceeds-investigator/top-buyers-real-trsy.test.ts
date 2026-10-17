import { afterEach, expect, it, vi } from "vitest";
import fixture from "../../fixtures/proceeds/trsy-verified-buyers.json";
import { fetchTopVerifiedBuyers } from "@/lib/proceeds-investigator/top-buyers";

afterEach(() => vi.unstubAllGlobals());

it("reproduces public TRSY purchases while excluding seven paths that spent other assets", async () => {
  const operations = fixture.operations as Record<string, unknown>;
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    const body = url.pathname === "/" ? { history_elder_ledger: 1 } : url.pathname === "/trades"
      ? { _embedded: { records: fixture.trades } } : operations[url.pathname.split("/").at(-1)!];
    expect(body).toBeDefined();
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  }));
  const result = await fetchTopVerifiedBuyers("https://horizon.example", fixture.assetCode, fixture.issuer, "all", new AbortController().signal, { now: new Date(fixture.capturedAt) });
  expect(result.buyers).toHaveLength(3);
  expect(result.buyers.map(buyer => buyer.xlmSpent)).toEqual(["10006.0000000", "5000.0000000", "5000.0000000"]);
  expect(result.buyers.map(buyer => buyer.purchaseCount)).toEqual([5, 1, 3]);
  expect(result.skippedRecords).toBe(7);
  const evidenceIds = new Set(result.buyers.flatMap(buyer => buyer.evidence.map(entry => entry.id)));
  for (const excluded of fixture.excludedIntermediateTradeIds) expect(evidenceIds.has(excluded)).toBe(false);
});
