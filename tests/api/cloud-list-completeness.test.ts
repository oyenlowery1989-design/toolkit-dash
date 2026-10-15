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
import { GET as distributors } from "@/app/api/asset-sales/distributors/route";

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

const issuer = "GANJULEAUA7FO4G4VADKZGZ4R7BIRWFQWFCWD6D7W5UDV2D4TJ3CPYTQ";
const distributorRequest = () => req(`?assetCode=WhipSim&issuer=${issuer}&network=public`);
it("reads only the owner's distributors for the exact asset and network, without private fields", async () => {
  source.rows.asset_groups = [
    { id: "match", user_id: "owner", asset_code: "WhipSim", issuer, network: "public" },
    { id: "other-user", user_id: "other", asset_code: "WhipSim", issuer, network: "public" },
    { id: "other-case", user_id: "owner", asset_code: "WHIPSIM", issuer, network: "public" },
    { id: "other-network", user_id: "owner", asset_code: "WhipSim", issuer, network: "testnet" },
    { id: "other-issuer", user_id: "owner", asset_code: "WhipSim", issuer: "other", network: "public" },
  ];
  source.rows.asset_group_members = [
    { id: "a", group_id: "match", address: "saved", role: "distributor", notes: "private" },
    { id: "b", group_id: "match", address: "saved", role: "distributor" },
    { id: "c", group_id: "match", address: "bank", role: "bank" },
    ...["other-user", "other-case", "other-network", "other-issuer"].map(id => ({ id, group_id: id, address: id, role: "distributor" })),
  ];
  const response = await distributors(distributorRequest());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ accounts: ["saved"] });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(source.requests.map(url => url.searchParams.get("select"))).toEqual(["id", "address"]);
});
it("pages matching distributors beyond the cloud API cap", async () => {
  source.rows.asset_groups = rows(101, { asset_code: "WhipSim", issuer, network: "public" });
  source.rows.asset_group_members = rows(1001, { group_id: "00000", role: "distributor" }).map(row => ({ ...row, address: row.id }));
  expect((await (await distributors(distributorRequest())).json()).accounts).toHaveLength(1001);
});
it.each(["asset_groups", "asset_group_members"])("fails closed on scoped %s read errors", async table => {
  source.rows.asset_groups = rows(1, { asset_code: "WhipSim", issuer, network: "public" });
  source.fail = table;
  expect((await distributors(distributorRequest())).status).toBe(502);
});
it("distinguishes no saved distributors from invalid input", async () => {
  expect(await (await distributors(distributorRequest())).json()).toEqual({ accounts: [] });
  expect((await distributors(req("?assetCode=WhipSim&issuer=invalid&network=public"))).status).toBe(400);
  expect((await distributors(req(`?assetCode=WhipSim&issuer=${issuer}&network=invalid`))).status).toBe(400);
});

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
