import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { SavedAnalysis, SavedAnalysisCursor, SavedAnalysisSummary } from "@/hooks/use-saved-analyses";
import { summarizeSavedAnalysis } from "@/lib/saved-analyses/summary";
import { diffSnapshots } from "@/lib/saved-analyses/diff";
import { buildGraph } from "@/lib/tracer-v2/graph-builder";

const mocks = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], queries: [] as string[], denied: false, client: null as SupabaseClient | null }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ prepare: (sql: string) => {
  mocks.queries.push(sql);
  return { all: (...args: (number | string)[]) => {
    const filtered = args.length === 1 ? mocks.rows : mocks.rows.filter((row) => Number(row.created_at) < Number(args[0]) || (row.created_at === args[0] && String(row.id) < String(args[2])));
    return [...filtered].sort((a, b) => Number(b.created_at) - Number(a.created_at) || (String(a.id) < String(b.id) ? 1 : -1)).slice(0, Number(args.at(-1)));
  }, get: (id: string) => mocks.rows.find((row) => row.id === id) };
} }) }));
vi.mock("@/lib/supabase-server", () => ({
  getSupabase: () => mocks.client, isSupabaseOnly: () => !!mocks.client, syncToSupabase: vi.fn(), checkSupabaseRowOwnership: vi.fn(),
  requireAuth: async () => mocks.denied ? { ok: false, response: new Response(null, { status: 401 }) } : { ok: true, userId: "owner" },
}));
import { GET } from "@/app/api/db/saved-analyses/route";
import { SAVED_ANALYSES_PAGE_BYTES, SAVED_ANALYSES_PAGE_SIZE, summaryPage } from "@/lib/saved-analyses/server";

function analysis(id = "snapshot"): SavedAnalysis {
  return {
    id, name: "Snapshot", assetCode: "wUSDC", issuer: "issuer", distribAddresses: ["sender", "other"], network: "public", timestamp: 1,
    result: { assetCode: "wUSDC", issuer: "issuer", accounts: ["sender", "other"], totalAssetSold: 10, totalXlmProceeds: 20, totalOutgoingXlm: 8, estimatedOnHandXlm: 12, dexTradeCount: 1, pathSaleCount: 0,
      proceedsLedger: [{ id: "trade", account: "sender", category: "dex_sale", amountXlm: 20, txHash: "tx", createdAt: "date", successful: true }],
      outgoingLedger: [
        { id: "one", account: "sender", category: "payment", to: "destination", amountXlm: 3, txHash: "tx1", createdAt: "date", successful: true },
        { id: "two", account: "other", from: "sender", category: "payment", to: "destination", amountXlm: 5, txHash: "tx2", createdAt: "date", successful: true },
        { id: "failed", account: "other", category: "payment", to: "destination", amountXlm: 100, txHash: "tx3", createdAt: "date", successful: false },
      ], topDestinations: [{ address: "destination", totalXlm: 8, count: 2 }] },
  };
}
function row(a: SavedAnalysis): Record<string, unknown> {
  return { id: a.id, name: a.name, asset_code: a.assetCode, issuer: a.issuer, distrib_addresses: JSON.stringify(a.distribAddresses), network: a.network, created_at: a.timestamp, result_json: JSON.stringify(a.result) };
}
const cursorQuery = (cursor?: SavedAnalysisCursor) => cursor ? `?${new URLSearchParams({ beforeTimestamp: String(cursor.timestamp), beforeId: cursor.id })}` : "";
const request = (query = "") => new NextRequest(`http://localhost/api/db/saved-analyses${query}`);
beforeEach(() => { mocks.rows = []; mocks.queries = []; mocks.denied = false; mocks.client = null; });

describe("saved analysis history", () => {
  it("paginates all 132 snapshots, including history older than row 50, without raw ledgers", async () => {
    mocks.rows = Array.from({ length: 132 }, (_, i) => row({ ...analysis(String(i)), timestamp: 132 - i }));
    const ids: string[] = [];
    let cursor: SavedAnalysisCursor | undefined;
    do {
      const response = await GET(request(cursorQuery(cursor)));
      const page = await response.json();
      for (const entry of page) {
        expect(entry.result.proceedsLedger).toBeUndefined();
        expect(entry.result.outgoingLedger).toBeUndefined();
        ids.push(entry.id);
      }
      cursor = page.at(-1)?.nextCursor;
    } while (cursor);
    expect(ids).toEqual(mocks.rows.map((r) => r.id));
    expect(mocks.queries.every((sql) => sql.includes("LIMIT ?") && !sql.includes("OFFSET"))).toBe(true);
  });

  it("does not skip older snapshots when an earlier row is deleted and a newer row inserted during paging", async () => {
    const original = Array.from({ length: 65 }, (_, i) => row({ ...analysis(String(i)), timestamp: 100 - i }));
    mocks.rows = [...original];
    const first: SavedAnalysisSummary[] = await (await GET(request())).json();
    mocks.rows = mocks.rows.filter((row) => row.id !== first[0].id && row.id !== first[1].id);
    mocks.rows.unshift(row({ ...analysis("inserted"), timestamp: 101 }));
    const ids = first.map((entry) => entry.id);
    let cursor = first.at(-1)?.nextCursor;
    while (cursor) {
      const page: SavedAnalysisSummary[] = await (await GET(request(cursorQuery(cursor)))).json();
      ids.push(...page.map((entry) => entry.id));
      cursor = page.at(-1)?.nextCursor;
    }
    expect(ids).toEqual(original.map((row) => row.id));
    expect(new Set(ids).size).toBe(65);
  });

  it("continues correctly through snapshots sharing the same timestamp", async () => {
    mocks.rows = Array.from({ length: 55 }, (_, i) => row(analysis(String(i).padStart(3, "0"))));
    const ids: string[] = [];
    let cursor: SavedAnalysisCursor | undefined;
    do {
      const page: SavedAnalysisSummary[] = await (await GET(request(cursorQuery(cursor)))).json();
      ids.push(...page.map((entry) => entry.id));
      cursor = page.at(-1)?.nextCursor;
    } while (cursor);
    expect(ids).toEqual(mocks.rows.map((row) => row.id).reverse());
  });

  it("loads a complete snapshot only by explicit id, and reports missing or unauthenticated requests", async () => {
    const original = analysis();
    mocks.rows = [row(original)];
    expect((await (await GET(request())).json())[0].result.outgoingLedger).toBeUndefined();
    expect(await (await GET(request(`?id=${original.id}`))).json()).toEqual(original);
    expect((await GET(request("?id=missing"))).status).toBe(404);
    mocks.denied = true;
    expect((await GET(request("?id=snapshot"))).status).toBe(401);
  });

  it("bounds pages by encoded bytes, retaining a cursor for every omitted row", () => {
    const large = analysis();
    large.name = "x".repeat(600_000);
    const page = summaryPage([row(large), row({ ...large, id: "second" })], false);
    expect(page).toHaveLength(1);
    expect(page[0].nextCursor).toEqual({ timestamp: 1, id: "snapshot" });
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(SAVED_ANALYSES_PAGE_BYTES);
  });

  it("streams oversized detail intact, including Unicode across chunk boundaries", async () => {
    const original = analysis();
    original.name = "x".repeat(32_754) + "😀" + "y".repeat(4_600_000);
    mocks.rows = [row(original)];
    const response = await GET(request("?id=snapshot"));
    expect(response.headers.get("content-length")).toBeNull();
    expect(await response.json()).toEqual(original);
  });

  it("retains exact graph, fingerprint destinations and comparison facts in the projection", () => {
    const original = analysis();
    const summary = summarizeSavedAnalysis(original);
    const input = { groups: [], knownIntermediaries: [], knownCreators: [], creatorChildren: [], analyses: [original] };
    expect(buildGraph({ ...input, analyses: [summary] })).toEqual(buildGraph(input));
    expect(summary.result.topDestinations).toEqual(original.result.topDestinations);
    const newer = { ...original, timestamp: 2, result: { ...original.result, totalXlmProceeds: 30, topDestinations: [{ address: "new", totalXlm: 9, count: 1 }] } };
    expect(diffSnapshots(summary, summarizeSavedAnalysis(newer))).toEqual(diffSnapshots(original, newer));
    const emptyRelevant = { ...original, distribAddresses: ["unrelated"] };
    expect(buildGraph({ ...input, analyses: [summarizeSavedAnalysis(emptyRelevant)] })).toEqual(buildGraph({ ...input, analyses: [emptyRelevant] }));
  });

  it("paginates Supabase history with tenant scope and stable order, and scopes lazy detail", async () => {
    const rows: Record<string, unknown>[] = Array.from({ length: 132 }, (_, i) => ({ ...row({ ...analysis(String(i)), timestamp: 132 - i }), user_id: "owner" }));
    rows.push({ ...row(analysis("foreign")), user_id: "other-user" });
    const urls: URL[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      urls.push(url);
      const user = url.searchParams.get("user_id")?.replace("eq.", "");
      const id = url.searchParams.get("id")?.replace("eq.", "");
      const cursorFilter = url.searchParams.get("or");
      const timestamp = cursorFilter?.match(/created_at\.lt\.(\d+)/)?.[1];
      const cursorId = cursorFilter?.match(/id\.lt\.(".*")/)?.[1];
      const filtered = rows.filter((row) => (!user || row.user_id === user) && (!id || row.id === id) &&
        (!timestamp || Number(row.created_at) < Number(timestamp) || (Number(row.created_at) === Number(timestamp) && String(row.id) < JSON.parse(cursorId!))));
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 1000);
      if (!id) expect(limit).toBeLessThanOrEqual(6);
      const page = filtered.slice(offset, offset + Math.min(limit, 10));
      return Response.json(page, { headers: { "Content-Range": `${offset}-${offset + page.length - 1}/${filtered.length}` } });
    });
    mocks.client = createClient("https://test.supabase.co", "test-key", { global: { fetch }, auth: { persistSession: false } });
    const ids: string[] = [];
    let cursor: SavedAnalysisCursor | undefined;
    do {
      const page: SavedAnalysisSummary[] = await (await GET(request(cursorQuery(cursor)))).json();
      ids.push(...page.map((entry) => entry.id));
      cursor = page.at(-1)?.nextCursor;
    } while (cursor);
    expect(ids).toHaveLength(132);
    expect(ids).not.toContain("foreign");
    expect((await GET(request("?id=foreign"))).status).toBe(404);
    expect((await (await GET(request("?id=131"))).json()).id).toBe("131");
    expect(urls.every((url) => url.searchParams.get("user_id") === "eq.owner")).toBe(true);
    expect(urls.filter((url) => !url.searchParams.has("id")).every((url) => url.searchParams.get("order") === "created_at.desc,id.desc")).toBe(true);
  });

  it("rejects invalid pagination input", async () => {
    for (const query of ["?beforeTimestamp=-1&beforeId=x", "?beforeTimestamp=1.1&beforeId=x", "?beforeTimestamp=oops&beforeId=x", "?beforeTimestamp=1", "?beforeId=x", "?beforeTimestamp=&beforeId=x"]) expect((await GET(request(query))).status).toBe(400);
  });

  it("reduces timed-out database batches without losing rows, order or tenant scope", async () => {
    const original: Record<string, unknown>[] = Array.from({ length: 13 }, (_, i) => ({ ...row({ ...analysis(String(i)), timestamp: 13 - i }), user_id: "owner" }));
    const limits: number[] = [];
    mocks.client = createClient("https://test.supabase.co", "test-key", { auth: { persistSession: false }, global: { fetch: async input => {
      const url = new URL(String(input));
      expect(url.searchParams.get("user_id")).toBe("eq.owner");
      const limit = Number(url.searchParams.get("limit")); limits.push(limit);
      if (limit > 1) return Response.json({ code: "57014", message: "canceling statement due to statement timeout" }, { status: 500 });
      const cursor = url.searchParams.get("or")?.match(/created_at\.lt\.(\d+)/)?.[1];
      const filtered = original.filter(row => !cursor || Number(row.created_at) < Number(cursor));
      return Response.json(filtered.slice(0, 1), { headers: { "Content-Range": `0-0/${filtered.length}` } });
    } } });
    const ids: string[] = [];
    let cursor: SavedAnalysisCursor | undefined;
    do {
      const response = await GET(request(cursorQuery(cursor)));
      expect(response.status).toBe(200);
      const page: SavedAnalysisSummary[] = await response.json();
      ids.push(...page.map(entry => entry.id));
      cursor = page.at(-1)?.nextCursor;
    } while (cursor);
    expect(ids).toEqual(original.map(row => row.id));
    expect(limits.slice(0, 3)).toEqual([SAVED_ANALYSES_PAGE_SIZE + 1, 3, 1]);
  });

  it("bounds retries and reports genuine storage errors without pretending history is empty", async () => {
    const fetcher = vi.fn(async () => Response.json({ code: "57014", message: "statement timeout" }, { status: 500 }));
    mocks.client = createClient("https://test.supabase.co", "test-key", { auth: { persistSession: false }, global: { fetch: fetcher } });
    expect((await GET(request())).status).toBe(502);
    expect(fetcher).toHaveBeenCalledTimes(3);
    fetcher.mockClear().mockImplementation(async () => Response.json({ code: "42501", message: "permission denied" }, { status: 403 }));
    expect((await GET(request())).status).toBe(502);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
