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
    if (offset === failAt) return new Response(JSON.stringify({ message: "read failed" }), { status: 400 });
    const page = rows.slice(offset, offset + cap);
    return new Response(JSON.stringify(page), {
      headers: { "Content-Range": `${offset}-${offset + page.length - 1}/${size}`, "Content-Type": "application/json" },
    });
  });
  mocks.client = createClient("https://test.supabase.co", "test-key", { global: { fetch }, auth: { persistSession: false } });
  return { rows, fetch };
}

describe("complete saved analysis history", () => {
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
