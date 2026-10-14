import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import type { BackupOperation } from "@/lib/local-backup-queue";

const state = vi.hoisted(() => ({ rejectEnqueue: false }));
// Mock is synchronous, matching the enqueue contract so failures abort SQLite.
vi.mock("@/lib/supabase-server", async () => {
  const { enqueueLocalBackup } = await import("@/lib/local-backup-queue");
  return {
    requireAuth: async () => ({ ok: true, userId: "queue-owner" }),
    isSupabaseOnly: () => false,
    getSupabase: () => { throw new Error("Local route must enqueue rather than contact Supabase"); },
    syncToSupabase: (operations: BackupOperation | BackupOperation[]) => {
      if (state.rejectEnqueue) throw new Error("Queue disk failure");
      enqueueLocalBackup(operations, "queue-owner");
    },
  };
});
let dir: string | undefined;
afterEach(() => {
  globalThis._stellarDb?.close();
  globalThis._stellarDb = undefined;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
  state.rejectEnqueue = false;
  vi.unstubAllEnvs();
  vi.resetModules();
});
function req(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/db/test", { method: "POST", body: JSON.stringify(body) });
}
async function setup() {
  dir = mkdtempSync(path.join(tmpdir(), "stellar-child-queue-"));
  vi.stubEnv("SQLITE_DB_PATH", path.join(dir, "test.db"));
  const { getDb } = await import("@/lib/db");
  return getDb();
}

it("queues every local group/member mutation in the SQLite transaction", async () => {
  const db = await setup();
  const { POST, PATCH, DELETE } = await import("@/app/api/db/groups/route");
  expect((await POST(req({ type: "group", id: "group", name: "Group" }))).status).toBe(200);
  expect((await POST(req({ type: "member", id: "member", groupId: "group", address: "GONE", role: "other" }))).status).toBe(200);
  expect((await PATCH(req({ type: "group", id: "group", name: "Renamed" }))).status).toBe(200);
  expect((await PATCH(req({ type: "member", id: "member", groupId: "group", label: "Named" }))).status).toBe(200);
  expect((await DELETE(req({ type: "member", key: "member" }))).status).toBe(200);
  expect((await DELETE(req({ type: "group", key: "group" }))).status).toBe(200);
  const jobs = db.prepare("SELECT operations_json FROM local_backup_queue ORDER BY id").all() as { operations_json: string }[];
  expect(jobs).toHaveLength(7); // member PATCH queues its parent timestamp separately.
  const memberJob = JSON.parse(jobs[1].operations_json) as BackupOperation[];
  expect(memberJob[0]).toMatchObject({ table: "asset_group_members", action: "upsert", onConflict: "group_id,address", preserveExisting: ["id", "added_at"] });
  expect(JSON.parse(jobs[3].operations_json)).toEqual([{ table: "asset_group_members", action: "update", data: { label: "Named" }, match: { group_id: "group", address: "GONE" } }]);
  expect(JSON.parse(jobs[5].operations_json)).toEqual([{ table: "asset_group_members", action: "delete", match: { group_id: "group", address: "GONE" } }]);
  expect(db.prepare("SELECT count(*) AS count FROM asset_groups").get()).toEqual({ count: 0 });
});

it("queues person, address and relationship writes and deletes without network calls", async () => {
  const db = await setup();
  const { POST, PATCH, DELETE } = await import("@/app/api/db/persons/route");
  for (const id of ["person-a", "person-b"]) expect((await POST(req({ type: "person", id, name: id }))).status).toBe(200);
  expect((await POST(req({ type: "address", id: "address", personId: "person-a", address: "GONE" }))).status).toBe(200);
  expect((await POST(req({ type: "relationship", id: "relationship", personAId: "person-a", personBId: "person-b", relationshipType: "related" }))).status).toBe(200);
  expect((await PATCH(req({ type: "person", id: "person-a", name: "Renamed" }))).status).toBe(200);
  for (const [type, key] of [["address", "address"], ["relationship", "relationship"], ["person", "person-a"]]) expect((await DELETE(req({ type, key }))).status).toBe(200);
  const jobs = db.prepare("SELECT operations_json FROM local_backup_queue ORDER BY id").all() as { operations_json: string }[];
  expect(jobs).toHaveLength(8);
  expect(JSON.parse(jobs[5].operations_json)).toEqual([{ table: "person_addresses", action: "delete", match: { person_id: "person-a", address: "GONE" } }]);
  expect(JSON.parse(jobs[2].operations_json)[0]).toMatchObject({ table: "person_addresses", onConflict: "person_id,address", preserveExisting: ["id", "added_at"] });
  expect(JSON.parse(jobs[3].operations_json)[0]).toMatchObject({ table: "person_relationships", action: "upsert" });
});

it("rolls back the local write if queue persistence fails, preserving missing-parent errors", async () => {
  const db = await setup();
  const groups = await import("@/app/api/db/groups/route");
  const persons = await import("@/app/api/db/persons/route");
  state.rejectEnqueue = true;
  await expect(groups.POST(req({ type: "group", id: "rollback-group", name: "Rollback" }))).rejects.toThrow("Queue disk failure");
  await expect(persons.POST(req({ type: "person", id: "rollback-person", name: "Rollback" }))).rejects.toThrow("Queue disk failure");
  expect(db.prepare("SELECT count(*) AS count FROM asset_groups").get()).toEqual({ count: 0 });
  expect(db.prepare("SELECT count(*) AS count FROM persons").get()).toEqual({ count: 0 });
  state.rejectEnqueue = false;
  expect((await groups.POST(req({ type: "member", id: "orphan", groupId: "missing", address: "GONE", role: "other" }))).status).toBe(409);
  expect((await persons.POST(req({ type: "address", id: "orphan", personId: "missing", address: "GONE" }))).status).toBe(409);
  expect(db.prepare("SELECT count(*) AS count FROM local_backup_queue").get()).toEqual({ count: 0 });
});
