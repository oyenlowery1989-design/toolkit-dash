import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: null as SupabaseClient | null }));
vi.mock("@/lib/supabase-server", () => ({ getSupabase: () => mocks.client }));
import { readSavedAnalysisRows } from "@/lib/saved-analyses/server";

function source(size: number, cap = 1000, failAt?: number) {
  const rows = Array.from({ length: size }, (_, id) => ({ id: String(id), created_at: size - id }));
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? cap);
    if ((url.searchParams.has("or") ? size - Number(url.searchParams.get("or")!.match(/created_at.lt.(\d+)/)![1]) + 1 : offset) === failAt) return new Response(JSON.stringify({ message: "read failed" }), { status: 400 });
    const cursor = url.searchParams.get("or");
    const match = cursor?.match(/created_at.lt.(\d+),and\(created_at.eq.\d+,id.lt.(.*?)\)\)/);
    const filtered = match ? rows.filter(row => row.created_at < Number(match[1]) || (row.created_at === Number(match[1]) && row.id < JSON.parse(match[2]))) : rows;
    const page = filtered.slice(offset, offset + Math.min(cap, limit));
    return new Response(JSON.stringify(page), {
      headers: { "Content-Range": `${offset}-${offset + page.length - 1}/${filtered.length}`, "Content-Type": "application/json" },
    });
  });
  mocks.client = createClient("https://test.supabase.co", "test-key", { global: { fetch }, auth: { persistSession: false } });
  return { rows, fetch };
}

describe("complete saved analysis history", () => {
  it("returns only the newest requested rows for the page", async () => {
    const { rows, fetch } = source(100);
    expect(await readSavedAnalysisRows("user-1", 50)).toEqual({ data: rows.slice(0, 50), error: null });
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetch.mock.calls[0][0]));
    expect(url.searchParams.get("offset")).toBe("0");
    expect(url.searchParams.get("limit")).toBe("50");
  });

  it("reads beyond 1000 rows with stable order and user scope on every page", async () => {
    const { rows, fetch } = source(1005);
    expect(await readSavedAnalysisRows("user-1")).toEqual({ data: rows, error: null });
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [input] of fetch.mock.calls) {
      const url = new URL(String(input));
      expect(url.searchParams.get("user_id")).toBe("eq.user-1");
      expect(url.searchParams.get("order")).toBe("created_at.desc,id.desc");
    }
  });

  it("continues when the server cap is smaller than the requested page", async () => {
    const { rows, fetch } = source(501, 200);
    expect(await readSavedAnalysisRows("user-1")).toEqual({ data: rows, error: null });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("returns an error without partial history if a later page fails", async () => {
    source(1005, 1000, 1000);
    expect(await readSavedAnalysisRows("user-1")).toMatchObject({ data: null, error: { message: "read failed" } });
  });

  it("returns an empty history without further reads", async () => {
    const { fetch } = source(0);
    expect(await readSavedAnalysisRows("user-1")).toEqual({ data: [], error: null });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

it("retains every original snapshot when a newer snapshot arrives between full-history pages", async () => {
  const original = Array.from({ length: 1001 }, (_, i) => ({ id: String(i), created_at: 1001 - i }));
  let calls = 0;
  mocks.client = createClient("https://test.supabase.co", "test-key", { auth: { persistSession: false }, global: { fetch: async input => {
    const url = new URL(String(input));
    const all = calls++ === 0 ? original : [{ id: "new", created_at: 1002 }, ...original];
    const cursor = url.searchParams.get("or")?.match(/created_at.lt.(\d+)/);
    const filtered = cursor ? all.filter(row => row.created_at < Number(cursor[1])) : all;
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const page = filtered.slice(offset, offset + 1000);
    return new Response(JSON.stringify(page), { headers: { "Content-Type": "application/json", "Content-Range": `${offset}-${offset + page.length - 1}/${filtered.length}` } });
  } } });
  expect(await readSavedAnalysisRows("user-1")).toEqual({ data: original, error: null });
});
