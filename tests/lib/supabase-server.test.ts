import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let testDir: string | undefined;
afterEach(async () => {
  await globalThis._localBackupDraining;
  if (globalThis._localBackupTimer) clearInterval(globalThis._localBackupTimer);
  globalThis._localBackupTimer = undefined;
  globalThis._localBackupDraining = undefined;
  globalThis._stellarDb?.close();
  globalThis._stellarDb = undefined;
  if (testDir) rmSync(testDir, { recursive: true, force: true });
  testDir = undefined;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

async function localDb() {
  testDir = mkdtempSync(path.join(tmpdir(), "stellar-sync-test-"));
  vi.stubEnv("SQLITE_DB_PATH", path.join(testDir, "test.db"));
  return (await import("@/lib/db")).getDb();
}

function cloud() {
  const writes: string[] = [];
  let fail = true;
  let foreign = false;
  const client = { from: (table: string) => {
    let action = "select";
    const query = {
      select: () => query,
      eq: () => query,
      abortSignal: () => query,
      maybeSingle: async () => ({ data: foreign ? { user_id: "other" } : null, error: null }),
      upsert: () => { action = "upsert"; return query; },
      delete: () => { action = "delete"; return query; },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(
        fail ? { error: { message: "offline" } } : (writes.push(`${table}:${action}`), { error: null }),
      ).then(resolve, reject),
    };
    return query;
  } } as unknown as SupabaseClient;
  return { client, writes, recover: () => { fail = false; }, foreign: () => { foreign = true; } };
}

describe("durable local Supabase backup", () => {
  it("retains failed jobs on disk, resumes after restart, and preserves write/delete order", async () => {
    const db = await localDb();
    const { enqueueLocalBackup, drainLocalBackup } = await import("@/lib/local-backup-queue");
    const sb = cloud();
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.transaction(() => {
      db.prepare("INSERT INTO address_book VALUES ('GKEY', 'Name', NULL, NULL, 1)").run();
      enqueueLocalBackup({ table: "address_book", action: "upsert", data: { public_key: "GKEY", label: "Name" }, onConflict: "user_id,public_key" }, "owner");
    })();
    db.transaction(() => {
      db.prepare("DELETE FROM address_book WHERE public_key = 'GKEY'").run();
      enqueueLocalBackup({ table: "address_book", action: "delete", match: { public_key: "GKEY" } }, "owner");
    })();
    await drainLocalBackup(sb.client, "owner");
    expect(db.prepare("SELECT count(*) AS count FROM local_backup_queue").get()).toEqual({ count: 2 });
    expect(sb.writes).toEqual([]);
    expect(db.prepare("SELECT * FROM local_backup_failure").get()).toMatchObject({ user_id: "owner" });
    db.close();
    globalThis._stellarDb = undefined;
    sb.recover();
    await drainLocalBackup(sb.client, "owner");
    const reopened = (await import("@/lib/db")).getDb();
    expect(sb.writes).toEqual(["address_book:upsert", "address_book:delete"]);
    expect(reopened.prepare("SELECT count(*) AS count FROM local_backup_queue").get()).toEqual({ count: 0 });
    expect(reopened.prepare("SELECT * FROM local_backup_failure").get()).toBeUndefined();
  });

  it("rolls back the local mutation if its durable job cannot be recorded", async () => {
    const db = await localDb();
    const { enqueueLocalBackup } = await import("@/lib/local-backup-queue");
    const operation = { table: "address_book", action: "delete" as const, match: { public_key: "GKEY" } };
    expect(() => enqueueLocalBackup(operation, "owner")).toThrow("share a transaction");
    db.exec("CREATE TRIGGER reject_backup BEFORE INSERT ON local_backup_queue BEGIN SELECT RAISE(FAIL, 'disk error'); END");
    expect(() => db.transaction(() => {
      db.prepare("INSERT INTO address_book VALUES ('GKEY', 'Name', NULL, NULL, 1)").run();
      enqueueLocalBackup(operation, "owner");
    })()).toThrow("disk error");
    expect(db.prepare("SELECT * FROM address_book").all()).toEqual([]);
  });

  it("never reassigns an existing cloud row owned by another user", async () => {
    const db = await localDb();
    const { enqueueLocalBackup, drainLocalBackup } = await import("@/lib/local-backup-queue");
    const sb = cloud();
    sb.recover(); sb.foreign();
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.transaction(() => enqueueLocalBackup({ table: "saved_analyses", action: "upsert", data: { id: "foreign-id" } }, "owner"))();
    await drainLocalBackup(sb.client, "owner");
    expect(sb.writes).toEqual([]);
    expect(db.prepare("SELECT count(*) AS count FROM local_backup_queue").get()).toEqual({ count: 1 });
  });

  it("replays child updates and deletes by natural keys when cloud and local IDs differ", async () => {
    const db = await localDb();
    const { enqueueLocalBackup, drainLocalBackup } = await import("@/lib/local-backup-queue");
    const writes: { method: string; url: URL; body?: Record<string, unknown> }[] = [];
    const client = createClient("https://example.supabase.co", "test-key", {
      auth: { persistSession: false },
      global: { fetch: async (input, init) => {
        const url = new URL(String(input));
        const method = init?.method ?? "GET";
        if (method === "GET") {
          const rows = url.pathname.endsWith("asset_groups") ? [{ user_id: "owner" }]
            : url.searchParams.get("id") === "eq.local-id" ? []
            : [{ id: "cloud-id", added_at: 1, group_id: "group", address: "GADDRESS" }];
          return Response.json(rows);
        }
        writes.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        return new Response(null, { status: 204 });
      } },
    });
    db.transaction(() => enqueueLocalBackup([
      { table: "asset_group_members", action: "upsert", onConflict: "group_id,address", preserveExisting: ["id", "added_at"], data: { id: "local-id", group_id: "group", address: "GADDRESS", added_at: 2 } },
      { table: "asset_group_members", action: "update", match: { group_id: "group", address: "GADDRESS" }, data: { label: "Renamed" } },
      { table: "asset_group_members", action: "delete", match: { group_id: "group", address: "GADDRESS" } },
    ], "owner"))();
    await drainLocalBackup(client, "owner");
    expect(writes.map((write) => write.method)).toEqual(["POST", "PATCH", "DELETE"]);
    expect(writes[0].body).toMatchObject({ id: "cloud-id", added_at: 1 });
    for (const write of writes.slice(1)) {
      expect(write.url.searchParams.get("group_id")).toBe("eq.group");
      expect(write.url.searchParams.get("address")).toBe("eq.GADDRESS");
      expect(write.url.searchParams.has("id")).toBe(false);
    }
    expect(db.prepare("SELECT count(*) AS count FROM local_backup_queue").get()).toEqual({ count: 0 });
  });
});
