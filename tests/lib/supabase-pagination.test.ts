import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rows: Array.from({ length: 1201 }, (_, id) => ({ id })), calls: 0, change: false, error: false }));
vi.mock("@/lib/supabase-server", () => ({ getSupabase: () => ({ from: () => ({ select: () => {
  const q = { eq: () => q, order: () => q, range: async (from: number) => {
    state.calls++;
    return { data: state.rows.slice(from, from + 125), error: state.error ? { message: "denied" } : null, count: state.rows.length + (state.change && state.calls > 1 ? 1 : 0) };
  } }; return q;
} }) }) }));
import { readAllSupabaseRows } from "@/lib/supabase-pagination";
beforeEach(() => { state.calls = 0; state.change = false; state.error = false; });
it("reads every row even when the server caps pages below requested size", async () => {
  const { data } = await readAllSupabaseRows("wallets", (q) => q.eq("user_id", "owner"));
  expect(data).toHaveLength(1201); expect(state.calls).toBe(10);
});
it("fails rather than declaring an incomplete or changing backup successful", async () => {
  state.change = true; await expect(readAllSupabaseRows("wallets", (q) => q)).rejects.toThrow("changed");
  state.error = true; await expect(readAllSupabaseRows("wallets", (q) => q)).rejects.toThrow("denied");
});
