import Database from "better-sqlite3";
import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { GET } from "@/app/api/asset-sales/distributors/route";

const auth = vi.hoisted(() => ({ allowed: true }));
vi.mock("@/lib/supabase-server", () => ({
  isSupabaseOnly: () => false, getSupabase: vi.fn(),
  requireAuth: async () => auth.allowed ? { ok: true, userId: "owner" }
    : { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) },
}));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
const issuer = "GANJULEAUA7FO4G4VADKZGZ4R7BIRWFQWFCWD6D7W5UDV2D4TJ3CPYTQ";
const req = () => new NextRequest(`http://localhost/api/asset-sales/distributors?assetCode=WhipSim&issuer=${issuer}&network=public`);
let db: Database.Database;
beforeEach(() => {
  auth.allowed = true;
  db = new Database(":memory:");
  db.exec("CREATE TABLE asset_groups (id TEXT, asset_code TEXT, issuer TEXT, network TEXT); CREATE TABLE asset_group_members (group_id TEXT, address TEXT, role TEXT)");
  vi.mocked(getDb).mockClear().mockReturnValue(db);
});
afterEach(() => db.close());
it("preserves exact asset identity and distributor role in SQLite too", async () => {
  const group = db.prepare("INSERT INTO asset_groups VALUES (?, ?, ?, ?)");
  group.run("correct", "WhipSim", issuer, "public");
  group.run("case", "WHIPSIM", issuer, "public");
  group.run("network", "WhipSim", issuer, "testnet");
  group.run("issuer", "WhipSim", "other", "public");
  const member = db.prepare("INSERT INTO asset_group_members VALUES (?, ?, ?)");
  member.run("correct", "saved", "distributor"); member.run("correct", "saved", "distributor");
  member.run("correct", "bank", "bank");
  for (const id of ["case", "network", "issuer"]) member.run(id, id, "distributor");
  expect(await (await GET(req())).json()).toEqual({ accounts: ["saved"] });
});
it("requires authentication before querying either storage mode", async () => {
  auth.allowed = false;
  expect((await GET(req())).status).toBe(401);
  expect(getDb).not.toHaveBeenCalled();
});
