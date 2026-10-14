import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const source = vi.hoisted(() => ({ client: null as SupabaseClient | null, rows: {} as Record<string, Record<string, unknown>[]>, fail: "", requests: [] as URL[] }));
vi.mock("@/lib/supabase-server", () => ({
  getSupabase: () => source.client, isSupabaseOnly: () => true,
  requireAuth: async () => ({ ok: true, userId: "owner" }),
}));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
import { GET as groups } from "@/app/api/db/groups/route";
import { GET as persons } from "@/app/api/db/persons/route";
import { GET as children } from "@/app/api/db/creator-children/route";
import { GET as wallets } from "@/app/api/db/wallets-v2/route";

beforeEach(() => {
  source.rows = {}; source.fail = ""; source.requests = [];
  source.client = createClient("https://test.supabase.co", "test-key", { auth: { persistSession: false }, global: { fetch: async (input) => {
    const url = new URL(String(input)); source.requests.push(url);
    const table = url.pathname.split("/").at(-1)!;
    if (table === source.fail) return new Response(JSON.stringify({ message: "read failed" }), { status: 400 });
    let rows = source.rows[table] ?? [];
    for (const [key, filter] of url.searchParams) {
      if (filter.startsWith("eq.")) rows = rows.filter(row => String(row[key]) === filter.slice(3));
      if (filter.startsWith("in.(")) {
        const ids = filter.slice(4, -1).split(",");
        expect(ids.length).toBeLessThanOrEqual(100);
        rows = rows.filter(row => ids.includes(String(row[key])));
      }
    }
    const from = Number(url.searchParams.get("offset") ?? 0);
    const size = Math.min(1000, Number(url.searchParams.get("limit") ?? 1000));
    const page = rows.slice(from, from + size);
    return new Response(JSON.stringify(page), { headers: { "Content-Type": "application/json", "Content-Range": `${from}-${from + page.length - 1}/${rows.length}` } });
  } } });
});
const req = (query = "") => new NextRequest(`http://localhost/api/db/test${query}`);
const rows = (n: number, extra: Record<string, unknown> = {}) => Array.from({ length: n }, (_, i) => ({ id: String(i).padStart(5, "0"), user_id: "owner", ...extra }));

it("reads all group parents and members with bounded parent ID batches", async () => {
  source.rows.asset_groups = rows(1001, { name: "Group", network: "public", created_at: 1, updated_at: 2 });
  source.rows.asset_group_members = rows(1001, { group_id: "00000", address: "GTEST", role: "other", added_at: 1 });
  const response = await groups(req()); const data = await response.json();
  expect(response.status).toBe(200); expect(data).toHaveLength(1001); expect(data[0].members).toHaveLength(1001);
});

it.each(["asset_groups", "asset_group_members"])("rejects a failed %s read instead of returning empty evidence", async table => {
  source.rows.asset_groups = rows(1); source.fail = table;
  expect((await groups(req())).status).toBeGreaterThanOrEqual(500);
});

it("reads all person parents, addresses and relationships", async () => {
  source.rows.persons = rows(1001, { name: "Person", created_at: 1, updated_at: 1 });
  source.rows.person_addresses = rows(1001, { person_id: "00000", address: "GTEST", added_at: 1 });
  source.rows.person_relationships = rows(1001, { person_a_id: "00000", person_b_id: "00001", type: "related", created_at: 1 });
  const data = await (await persons(req())).json();
  expect(data).toHaveLength(1001); expect(data[0].addresses).toHaveLength(1001); expect(data[0].relationships).toHaveLength(1001);
});

it("pages creator children while preserving creator/network filters", async () => {
  source.rows.creator_children = [...rows(1001, { creator_address: "GOWNER", child_address: "GCHILD", network: "public", discovered_at: 1 }), ...rows(1, { creator_address: "GOTHER", network: "public" })];
  expect(await (await children(req("?creator=GOWNER&network=public"))).json()).toHaveLength(1001);
  source.fail = "creator_children";
  expect((await children(req())).status).toBeGreaterThanOrEqual(500);
});

it("reads wallets beyond the API cap", async () => {
  source.rows.wallets = rows(1001, { folder_id: "folder", name: "Wallet", public_key: "GTEST", secret_key: "", position: 0 });
  expect(await (await wallets(req())).json()).toHaveLength(1001);
});
