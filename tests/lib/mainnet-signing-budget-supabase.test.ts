import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ raw: "[]", collide: false }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({
  isSupabaseOnly: () => true,
  getSupabase: () => ({ from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { entries_json: state.raw }, error: null }) }) }),
    update: ({ entries_json }: { entries_json: string }) => {
      let compared = "";
      const query = {
        eq(column: string, value: string) { if (column === "entries_json") compared = value; return query; },
        async select() {
          if (state.collide) {
            state.collide = false;
            state.raw = JSON.stringify([{ hash: "b".repeat(64), stroops: 20_000_000, countedUntil: 1_800_086_460_000 }]);
          }
          if (compared !== state.raw) return { data: [], error: null };
          state.raw = entries_json;
          return { data: [{ bucket_key: "global" }], error: null };
        },
      };
      return query;
    },
  }) }),
}));
import { reserveMainnetSignature } from "@/lib/mainnet-signing-budget";

beforeEach(() => {
  state.raw = "[]";
  state.collide = false;
  vi.stubEnv("MAINNET_TRANSACTIONS_ENABLED", "true");
  vi.stubEnv("MAINNET_MAX_XLM_PER_DAY", "3");
});
afterEach(() => vi.unstubAllEnvs());

it("rechecks the limit after a competing Supabase reservation wins", async () => {
  state.collide = true;
  const errors = await reserveMainnetSignature("owner", "a".repeat(64), 1_800_000_060,
    { destinations: [], operationCount: 1, xlmAmount: 2 }, 1_800_000_000_000);
  expect(errors).toContain("Daily XLM limit of 3 would be exceeded");
  expect(JSON.parse(state.raw)).toHaveLength(1);
});
