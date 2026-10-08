import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({ rows: new Map<string, any>(), actor: "attacker", fail: false }));
vi.mock("@/lib/db", () => ({ getDb: () => { throw new Error("Unexpected SQLite access"); } }));
vi.mock("@/lib/supabase-server", () => ({
  requireAuth: async () => ({ ok: true, userId: state.actor }), isSupabaseOnly: () => true, syncToSupabase: () => {},
  getSupabase: () => ({ from: (table: string) => ({
    insert: async (row: any) => {
      if (state.fail) return { error: { code: "network", message: "Unavailable" } };
      if (state.rows.has(table + ':' + row.id)) return { error: { code: "23505" } };
      state.rows.set(table + ':' + row.id, row); return { error: null };
    },
    update: (patch: any) => {
      const filters: Record<string, string> = {};
      const query = {
        eq: (key: string, value: string) => { filters[key] = value; return query; }, select: () => query,
        maybeSingle: async () => {
          const row = state.rows.get(table + ':' + filters.id);
          if (!row || row.user_id !== filters.user_id) return { data: null, error: null };
          state.rows.set(table + ':' + row.id, { ...row, ...patch }); return { data: { id: row.id }, error: null };
        },
      }; return query;
    },
    select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [] }) }) }) }),
  }) }),
}));
import { POST as recipients } from "@/app/api/db/bulk-recipients/route";
import { POST as history } from "@/app/api/db/bulk-runs/route";
const request = (id: string) => new NextRequest("http://localhost/api/db/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, name: "new", network: "public", addresses: [], memo: "", recipientCount: 1, successCount: 1, failedCount: 0 }) });
beforeEach(() => { state.rows.clear(); state.actor = "attacker"; state.fail = false; });
describe.each([["bulk_recipients", recipients], ["bulk_run_history", history]] as const)("%s API", (table, post) => {
  it("rejects another tenant's ID without changing or transferring its row", async () => {
    const original = { id: "victim", user_id: "victim", name: "original" };
    state.rows.set(table + ':victim', original);
    expect((await post(request("victim"))).status).toBe(403);
    expect(state.rows.get(table + ':victim')).toEqual(original);
  });
  it("supports creating and updating the caller's own row", async () => {
    expect((await post(request("owned"))).status).toBe(200);
    expect((await post(request("owned"))).status).toBe(200);
    expect(state.rows.get(table + ':owned').user_id).toBe("attacker");
  });
  it("fails closed on database errors", async () => { state.fail = true; expect((await post(request("id"))).status).toBe(500); });
});
