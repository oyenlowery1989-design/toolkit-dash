import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  upsertError: null as null | { code?: string; message: string },
  existingId: null as string | null,
  upserts: [] as { table: string; row: Record<string, unknown> }[],
  supabaseOnly: true,
  sqliteWrites: [] as { sql: string; values: unknown[] }[],
}));

vi.mock("@/lib/db", () => ({ getDb: () => ({
  prepare: (sql: string) => ({ run: (...values: unknown[]) => mocks.sqliteWrites.push({ sql, values }) }),
}) }));
vi.mock("@/lib/supabase-server", () => ({
  requireAuth: async () => ({ ok: true, userId: "owner" }),
  isSupabaseOnly: () => mocks.supabaseOnly,
  checkSupabaseRowOwnership: async () => ({ ok: true }),
  syncToSupabase: vi.fn(),
  getSupabase: () => ({
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({ data: mocks.existingId ? { id: mocks.existingId, added_at: 10 } : null, error: null }),
        single: async () => ({ data: { id: "parent" }, error: null }),
        upsert: async (row: Record<string, unknown>) => {
          mocks.upserts.push({ table, row });
          return { error: mocks.upsertError };
        },
        update: () => query,
        then: (resolve: (value: { error: null }) => unknown) => Promise.resolve({ error: null }).then(resolve),
      };
      return query;
    },
  }),
}));

import { POST as postGroup } from "@/app/api/db/groups/route";
import { POST as postPerson, PATCH as patchPerson } from "@/app/api/db/persons/route";

function request(path: string, body: Record<string, unknown>, method = "POST") {
  return new NextRequest(`http://localhost/api/db/${path}`, { method, body: JSON.stringify(body) });
}

beforeEach(() => {
  mocks.upsertError = null;
  mocks.existingId = null;
  mocks.upserts.length = 0;
  mocks.supabaseOnly = true;
  mocks.sqliteWrites.length = 0;
});

describe("cloud persistence", () => {
  it("reports a non-duplicate group create failure", async () => {
    mocks.upsertError = { code: "42501", message: "permission denied" };
    const response = await postGroup(request("groups", { type: "group", id: "new", name: "Group", network: "public" }));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ ok: false, error: "permission denied" });
  });

  it("keeps the stored member and address IDs on duplicate saves", async () => {
    mocks.existingId = "stored";
    const groupResponse = await postGroup(request("groups", {
      type: "member", id: "new", groupId: "parent", address: "GADDRESS", role: "other",
    }));
    const personResponse = await postPerson(request("persons", {
      type: "address", id: "new", personId: "parent", address: "GADDRESS",
    }));
    expect(await groupResponse.json()).toMatchObject({ ok: true, id: "stored" });
    expect(await personResponse.json()).toMatchObject({ ok: true, id: "stored" });
    expect(mocks.upserts).toEqual([
      { table: "asset_group_members", row: expect.objectContaining({ id: "stored", added_at: 10 }) },
      { table: "person_addresses", row: expect.objectContaining({ id: "stored", added_at: 10 }) },
    ]);
  });

  it("clears optional person fields in SQLite when the edit form sends blanks", async () => {
    mocks.supabaseOnly = false;
    const response = await patchPerson(request("persons", {
      type: "person", id: "person", role: "", notes: "", telegramUsername: "",
    }, "PATCH"));
    expect(response.status).toBe(200);
    expect(mocks.sqliteWrites).toHaveLength(1);
    expect(mocks.sqliteWrites[0].sql).toContain("role = ?");
    expect(mocks.sqliteWrites[0].values).toEqual([expect.any(Number), null, null, null, "person"]);
  });
});
