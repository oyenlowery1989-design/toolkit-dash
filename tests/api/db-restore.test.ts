import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

const source = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, unknown>[]>,
  supabaseOnly: false,
  failAt: null as { table: string; from: number } | null,
  noCountAt: null as { table: string; from: number } | null,
  writes: [] as { table: string; action: string }[],
  rpcCalls: [] as { name: string; args: { p_user_id: string; p_tables: Record<string, Record<string, unknown>[]> } }[],
  rpcError: null as { code: string; message: string } | null,
  rpcHold: null as Promise<void> | null,
}));

vi.mock("@/lib/supabase-server", () => ({
  requireAuth: async () => ({ ok: true, userId: "test-user" }),
  isSupabaseConfigured: () => true,
  isSupabaseOnly: () => source.supabaseOnly,
  getSupabase: () => ({
    rpc: async (name: string, args: { p_user_id: string; p_tables: Record<string, Record<string, unknown>[]> }) => {
      source.rpcCalls.push({ name, args });
      if (source.rpcHold) await source.rpcHold;
      return { error: source.rpcError };
    },
    from: (table: string) => {
      let rows = source.rows[table] ?? [];
      const query = {
        eq: (column: string, value: unknown) => {
          rows = rows.filter((row) => column === "user_id" && row[column] === undefined || row[column] === value);
          return query;
        },
        like: (column: string, pattern: string) => { rows = rows.filter(row => String(row[column]).startsWith(pattern.slice(0, -1))); return query; },
        in: (column: string, values: unknown[]) => {
          if (values.length > 100) throw new Error("Parent ID batch too large");
          rows = rows.filter((row) => values.includes(row[column]));
          return query;
        },
        order: (column: string) => {
          rows = [...rows].sort((a, b) => String(a[column]).localeCompare(String(b[column])));
          return query;
        },
        range: async (from: number, to: number) => source.failAt?.table === table && source.failAt.from === from
          ? { data: null, count: null, error: { message: "Simulated page failure" } }
          : {
            data: rows.slice(from, Math.min(to + 1, from + 1000)),
            count: source.noCountAt?.table === table && source.noCountAt.from === from ? null : rows.length,
            error: null,
          },
      };
      return {
        select: () => query,
        insert: async () => { source.writes.push({ table, action: "insert" }); return { error: null }; },
        upsert: async () => { source.writes.push({ table, action: "upsert" }); return { error: null }; },
      };
    },
  }),
}));

let testDir: string | undefined;

afterEach(() => {
  const db = globalThis._stellarDb;
  db?.close();
  globalThis._stellarDb = undefined;
  if (testDir) rmSync(testDir, { recursive: true, force: true });
  testDir = undefined;
  source.rows = {};
  source.supabaseOnly = false;
  source.failAt = null;
  source.noCountAt = null;
  source.writes = [];
  source.rpcCalls = [];
  source.rpcError = null;
  source.rpcHold = null;
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("rejects a different cloud journal without changing a local unresolved run", async () => {
  testDir = mkdtempSync(path.join(tmpdir(), "stellar-restore-test-"));
  vi.stubEnv("SQLITE_DB_PATH", path.join(testDir, "test.db"));
  const { getDb } = await import("@/lib/db");
  const db = getDb();
  const localPayload = JSON.stringify({ runId: "local-run", results: [{ status: "uncertain", txHash: "a".repeat(64) }] });
  db.prepare("INSERT INTO bulk_payment_journal (user_id, run_id, version, payload_json, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run("local", "local-run", 3, localPayload, 1);
  source.rows.bulk_payment_journal = [{ user_id: "test-user", run_id: "older-run", version: 1,
    payload_json: JSON.stringify({ runId: "older-run", results: [] }), updated_at: 0 }];

  const { POST } = await import("@/app/api/db/restore/route");
  const response = await POST(new NextRequest("http://localhost/api/db/restore", {
    method: "POST", body: JSON.stringify({ source: "supabase" }),
  }));
  expect(response.status).toBe(409);
  expect(db.prepare("SELECT run_id, version, payload_json FROM bulk_payment_journal WHERE user_id = 'local'").get())
    .toEqual({ run_id: "local-run", version: 3, payload_json: localPayload });
});

it("accepts an identical cloud payment journal", async () => {
  testDir = mkdtempSync(path.join(tmpdir(), "stellar-restore-test-"));
  vi.stubEnv("SQLITE_DB_PATH", path.join(testDir, "test.db"));
  const { getDb } = await import("@/lib/db");
  const db = getDb();
  const payload = JSON.stringify({ runId: "same-run", results: [] });
  db.prepare("INSERT INTO bulk_payment_journal (user_id, run_id, version, payload_json, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run("local", "same-run", 2, payload, 1);
  source.rows.bulk_payment_journal = [{ user_id: "test-user", run_id: "same-run", version: 2, payload_json: payload, updated_at: 1 }];
  const { POST } = await import("@/app/api/db/restore/route");
  const response = await POST(new NextRequest("http://localhost/api/db/restore", {
    method: "POST", body: JSON.stringify({ source: "supabase" }),
  }));
  expect(response.status).toBe(200);
  expect(db.prepare("SELECT run_id, version, payload_json FROM bulk_payment_journal WHERE user_id = 'local'").get())
    .toEqual({ run_id: "same-run", version: 2, payload_json: payload });
});

it("exports only owned Tiered Rewards guards and restores them without replacing a local guard", async () => {
  testDir = mkdtempSync(path.join(tmpdir(), "stellar-restore-test-"));
  vi.stubEnv("SQLITE_DB_PATH", path.join(testDir, "test.db"));
  source.supabaseOnly = true;
  source.rows.tiered_reward_configs = [{ id: "owned", user_id: "test-user" }];
  source.rows.tiered_reward_run_leases = [
    { resource_id: "reward-guard:owned", lease_token: "owned-journal", expires_at: Number.MAX_SAFE_INTEGER },
    { resource_id: "reward-guard:foreign", lease_token: "foreign-journal", expires_at: Number.MAX_SAFE_INTEGER },
  ];
  const { GET } = await import("@/app/api/db/export/route");
  const exported = await GET(new NextRequest("http://localhost/api/db/export"));
  expect(exported.status).toBe(200);
  expect((await exported.json()).tiered_reward_run_leases).toEqual([source.rows.tiered_reward_run_leases[0]]);

  source.supabaseOnly = false;
  const { getDb } = await import("@/lib/db");
  const db = getDb();
  db.prepare("INSERT INTO tiered_reward_configs (id, name, asset_code, asset_issuer, network, secret_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run("owned", "Local", "XLM", "", "public", "", 1);
  source.rows.tiered_reward_configs = [{ ...(db.prepare("SELECT * FROM tiered_reward_configs WHERE id = 'owned'").get() as Record<string, unknown>), name: "Remote" }];
  const { POST } = await import("@/app/api/db/restore/route");
  const req = () => new NextRequest("http://localhost/api/db/restore", { method: "POST", body: JSON.stringify({ source: "supabase" }) });
  expect((await POST(req())).status).toBe(200);
  expect(db.prepare("SELECT lease_token FROM tiered_reward_run_leases WHERE resource_id = ?").get("reward-guard:owned"))
    .toEqual({ lease_token: "owned-journal" });

  db.prepare("UPDATE tiered_reward_run_leases SET lease_token = ? WHERE resource_id = ?").run("local-newer", "reward-guard:owned");
  source.rows.tiered_reward_configs[0].name = "Should not merge";
  expect((await POST(req())).status).toBe(409);
  expect(db.prepare("SELECT lease_token FROM tiered_reward_run_leases WHERE resource_id = ?").get("reward-guard:owned"))
    .toEqual({ lease_token: "local-newer" });
  expect(db.prepare("SELECT name FROM tiered_reward_configs WHERE id = 'owned'").get()).toEqual({ name: "Remote" });
});

it("refuses local-to-Supabase restore when a remote reward guard differs", async () => {
  testDir = mkdtempSync(path.join(tmpdir(), "stellar-restore-test-"));
  vi.stubEnv("SQLITE_DB_PATH", path.join(testDir, "test.db"));
  const { getDb } = await import("@/lib/db");
  const db = getDb();
  db.prepare("INSERT INTO tiered_reward_configs (id, name, asset_code, asset_issuer, network, secret_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run("owned", "Local", "XLM", "", "public", "", 1);
  db.prepare("INSERT INTO tiered_reward_run_leases (resource_id, lease_token, expires_at) VALUES (?, ?, ?)")
    .run("reward-guard:owned", "local-journal", Number.MAX_SAFE_INTEGER);
  source.rpcError = { code: "PT409", message: "Remote reward guard differs" };

  const { POST } = await import("@/app/api/db/restore/route");
  const response = await POST(new NextRequest("http://localhost/api/db/restore", {
    method: "POST", body: JSON.stringify({ source: "local" }),
  }));
  expect(response.status).toBe(409);
  expect(source.writes).toEqual([]);
  source.rpcError = { code: "PT409", message: "Existing tiered_reward_configs record belongs to another user" };
  const foreignConfigResponse = await POST(new NextRequest("http://localhost/api/db/restore", {
    method: "POST", body: JSON.stringify({ source: "local" }),
  }));
  expect(foreignConfigResponse.status).toBe(409);
  expect(source.writes).toEqual([]);
});

it("restores a group without deleting a member saved only locally", async () => {
  testDir = mkdtempSync(path.join(tmpdir(), "stellar-restore-test-"));
  vi.stubEnv("SQLITE_DB_PATH", path.join(testDir, "test.db"));
  const { getDb } = await import("@/lib/db");
  const db = getDb();
  db.prepare(`INSERT INTO asset_groups (id, name, network, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
    .run("group-1", "Local name", "public", 1, 1);
  db.prepare(`INSERT INTO asset_group_members (id, group_id, address, role, added_at) VALUES (?, ?, ?, ?, ?)`)
    .run("member-1", "group-1", "GLOCAL", "other", 1);
  const group = db.prepare("SELECT * FROM asset_groups WHERE id = ?").get("group-1") as Record<string, unknown>;
  source.rows.asset_groups = [{ ...group, name: "Backup name" }];

  const { POST } = await import("@/app/api/db/restore/route");
  const response = await POST(new NextRequest("http://localhost/api/db/restore", {
    method: "POST",
    body: JSON.stringify({ source: "supabase" }),
  }));

  expect(response.status).toBe(200);
  expect(db.prepare("SELECT name FROM asset_groups WHERE id = ?").get("group-1")).toEqual({ name: "Backup name" });
  expect(db.prepare("SELECT id FROM asset_group_members WHERE id = ?").get("member-1")).toEqual({ id: "member-1" });
});

it("retains local-only children of people and scheduled payment configurations", async () => {
  testDir = mkdtempSync(path.join(tmpdir(), "stellar-restore-test-"));
  vi.stubEnv("SQLITE_DB_PATH", path.join(testDir, "test.db"));
  const { getDb } = await import("@/lib/db");
  const db = getDb();
  db.prepare("INSERT INTO persons (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .run("person-1", "Local person", 1, 1);
  db.prepare("INSERT INTO person_addresses (id, person_id, address, added_at) VALUES (?, ?, ?, ?)")
    .run("address-1", "person-1", "GLOCAL", 1);
  db.prepare("INSERT INTO auto_send_groups (id, name, created_at) VALUES (?, ?, ?)")
    .run("send-1", "Local send", 1);
  db.prepare("INSERT INTO auto_send_destinations (id, group_id, destination, percentage) VALUES (?, ?, ?, ?)")
    .run("destination-1", "send-1", "GLOCAL", 100);
  db.prepare("INSERT INTO tiered_reward_configs (id, name, asset_code, asset_issuer, network, secret_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run("config-1", "Local config", "XLM", "", "public", "", 1);
  db.prepare("INSERT INTO tiered_reward_tiers (id, config_id, tier_number, min_tokens, position) VALUES (?, ?, ?, ?, ?)")
    .run("tier-1", "config-1", 1, 0, 1);
  db.prepare("INSERT INTO tiered_reward_assets (id, tier_id, asset_code, amount) VALUES (?, ?, ?, ?)")
    .run("asset-1", "tier-1", "XLM", 1);
  source.rows.persons = [{ ...(db.prepare("SELECT * FROM persons WHERE id = ?").get("person-1") as Record<string, unknown>), name: "Backup person" }];
  source.rows.auto_send_groups = [{ ...(db.prepare("SELECT * FROM auto_send_groups WHERE id = ?").get("send-1") as Record<string, unknown>), name: "Backup send" }];
  source.rows.tiered_reward_configs = [{ ...(db.prepare("SELECT * FROM tiered_reward_configs WHERE id = ?").get("config-1") as Record<string, unknown>), name: "Backup config" }];
  source.rows.tiered_reward_tiers = [{ ...(db.prepare("SELECT * FROM tiered_reward_tiers WHERE id = ?").get("tier-1") as Record<string, unknown>), min_tokens: 10 }];

  const { POST } = await import("@/app/api/db/restore/route");
  const response = await POST(new NextRequest("http://localhost/api/db/restore", {
    method: "POST",
    body: JSON.stringify({ source: "supabase" }),
  }));

  expect(response.status).toBe(200);
  expect(db.prepare("SELECT name FROM persons WHERE id = ?").get("person-1")).toEqual({ name: "Backup person" });
  expect(db.prepare("SELECT id FROM person_addresses WHERE id = ?").get("address-1")).toEqual({ id: "address-1" });
  expect(db.prepare("SELECT name FROM auto_send_groups WHERE id = ?").get("send-1")).toEqual({ name: "Backup send" });
  expect(db.prepare("SELECT id FROM auto_send_destinations WHERE id = ?").get("destination-1")).toEqual({ id: "destination-1" });
  expect(db.prepare("SELECT name FROM tiered_reward_configs WHERE id = ?").get("config-1")).toEqual({ name: "Backup config" });
  expect(db.prepare("SELECT min_tokens FROM tiered_reward_tiers WHERE id = ?").get("tier-1")).toEqual({ min_tokens: 10 });
  expect(db.prepare("SELECT id FROM tiered_reward_assets WHERE id = ?").get("asset-1")).toEqual({ id: "asset-1" });
});

it("restores every page and batches child lookups for many groups", async () => {
  testDir = mkdtempSync(path.join(tmpdir(), "stellar-restore-test-"));
  vi.stubEnv("SQLITE_DB_PATH", path.join(testDir, "test.db"));
  const { getDb } = await import("@/lib/db");
  const db = getDb();
  source.rows.known_intermediaries = Array.from({ length: 1001 }, (_, i) => ({
    address: `G${i.toString().padStart(4, "0")}`, name: `Intermediary ${i}`, notes: null, added_at: 1,
  }));
  source.rows.asset_groups = Array.from({ length: 101 }, (_, i) => ({
    id: `group-${i}`, name: `Group ${i}`, asset_code: null, issuer: null,
    network: "public", notes: null, domain: null, telegram_channel: null,
    telegram_link: null, person_id: null, created_at: 1, updated_at: 1,
  }));
  source.rows.asset_group_members = Array.from({ length: 1102 }, (_, i) => ({
    id: `member-${i}`, group_id: i === 1101 ? "group-100" : "group-0", address: `G${i}`,
    role: "other", label: null, notes: null, home_domain: null, added_at: 1,
  }));

  const { POST } = await import("@/app/api/db/restore/route");
  const response = await POST(new NextRequest("http://localhost/api/db/restore", {
    method: "POST",
    body: JSON.stringify({ source: "supabase" }),
  }));

  expect(response.status).toBe(200);
  expect(db.prepare("SELECT COUNT(*) AS count FROM known_intermediaries").get()).toEqual({ count: 1001 });
  expect(db.prepare("SELECT COUNT(*) AS count FROM asset_group_members").get()).toEqual({ count: 1102 });
});

it("exports every Supabase page instead of a truncated backup", async () => {
  source.supabaseOnly = true;
  source.rows.known_intermediaries = Array.from({ length: 1001 }, (_, i) => ({
    address: `G${i.toString().padStart(4, "0")}`, name: `Intermediary ${i}`,
  }));
  const { GET } = await import("@/app/api/db/export/route");
  const response = await GET(new NextRequest("http://localhost/api/db/export"));

  expect(response.status).toBe(200);
  expect((await response.json()).known_intermediaries).toHaveLength(1001);
});

it("merges every Supabase page on startup", async () => {
  testDir = mkdtempSync(path.join(tmpdir(), "stellar-restore-test-"));
  vi.stubEnv("SQLITE_DB_PATH", path.join(testDir, "test.db"));
  source.rows.known_intermediaries = Array.from({ length: 1001 }, (_, i) => ({
    address: `G${i.toString().padStart(4, "0")}`, name: `Intermediary ${i}`,
    notes: null, added_at: 1,
  }));
  const { getDb } = await import("@/lib/db");
  const db = getDb();
  const { POST } = await import("@/app/api/db/startup-sync/route");
  const response = await POST(new NextRequest("http://localhost/api/db/startup-sync", { method: "POST" }));

  expect(response.status).toBe(200);
  expect(db.prepare("SELECT COUNT(*) AS count FROM known_intermediaries").get()).toEqual({ count: 1001 });
});

it("does not merge a partial backup when a later page fails", async () => {
  testDir = mkdtempSync(path.join(tmpdir(), "stellar-restore-test-"));
  vi.stubEnv("SQLITE_DB_PATH", path.join(testDir, "test.db"));
  source.rows.known_intermediaries = Array.from({ length: 1001 }, (_, i) => ({
    address: `G${i.toString().padStart(4, "0")}`, name: `Intermediary ${i}`,
    notes: null, added_at: 1,
  }));
  source.failAt = { table: "known_intermediaries", from: 1000 };
  const { getDb } = await import("@/lib/db");
  const db = getDb();
  const { POST } = await import("@/app/api/db/startup-sync/route");
  const response = await POST(new NextRequest("http://localhost/api/db/startup-sync", { method: "POST" }));

  expect(response.status).toBe(502);
  expect(db.prepare("SELECT COUNT(*) AS count FROM known_intermediaries").get()).toEqual({ count: 0 });
});

it("leaves local data and signing safety state intact when restore cannot read the full backup", async () => {
  testDir = mkdtempSync(path.join(tmpdir(), "stellar-restore-test-"));
  vi.stubEnv("SQLITE_DB_PATH", path.join(testDir, "test.db"));
  const { getDb } = await import("@/lib/db");
  const db = getDb();
  db.prepare("INSERT INTO known_intermediaries (address, name, added_at) VALUES (?, ?, ?)")
    .run("GLOCAL", "Keep me", 1);
  db.prepare("INSERT INTO mainnet_signing_budget (bucket_key, entries_json) VALUES (?, ?)")
    .run("global", "[]");
  db.prepare("INSERT INTO asset_creator_issuance_claims (network, issuer, asset_code, unsigned_xdr, unsigned_hash, signed_xdr, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run("public", "GISSUER", "TEST", "unsigned", "hash", "signed", 1);
  source.rows.known_intermediaries = Array.from({ length: 1001 }, (_, i) => ({
    address: `G${i.toString().padStart(4, "0")}`, name: `Backup ${i}`, notes: null, added_at: 1,
  }));
  source.failAt = { table: "known_intermediaries", from: 1000 };

  const { POST } = await import("@/app/api/db/restore/route");
  const response = await POST(new NextRequest("http://localhost/api/db/restore", {
    method: "POST",
    body: JSON.stringify({ source: "supabase" }),
  }));

  expect(response.status).toBe(502);
  expect(db.prepare("SELECT address, name FROM known_intermediaries").all()).toEqual([{ address: "GLOCAL", name: "Keep me" }]);
  expect(db.prepare("SELECT entries_json FROM mainnet_signing_budget WHERE bucket_key = ?").get("global"))
    .toEqual({ entries_json: "[]" });
  expect(db.prepare("SELECT unsigned_hash FROM asset_creator_issuance_claims WHERE network = ? AND issuer = ? AND asset_code = ?").get("public", "GISSUER", "TEST"))
    .toEqual({ unsigned_hash: "hash" });
});

it("rejects an export when Supabase cannot report the full row count", async () => {
  source.supabaseOnly = true;
  source.rows.known_intermediaries = [{ address: "GLOCAL", name: "Local" }];
  source.noCountAt = { table: "known_intermediaries", from: 0 };
  const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const { GET } = await import("@/app/api/db/export/route");
    const response = await GET(new NextRequest("http://localhost/api/db/export"));
    expect(response.status).toBe(502);
  } finally {
    errorLog.mockRestore();
  }
});

it("uses one atomic RPC with natural-key searches, JSON and booleans", async () => {
  testDir = mkdtempSync(path.join(tmpdir(), "stellar-restore-test-"));
  vi.stubEnv("SQLITE_DB_PATH", path.join(testDir, "test.db"));
  const { getDb } = await import("@/lib/db");
  const db = getDb();
  db.prepare("INSERT INTO saved_searches (type, value, created_at) VALUES (?, ?, ?)").run("asset", "MixedCase:issuer", 1);
  db.prepare("INSERT INTO bulk_recipients (id, name, network, addresses, saved_at) VALUES (?, ?, ?, ?, ?)")
    .run("recipients", "List", "public", '["GONE","GTWO"]', 1);
  db.prepare("INSERT INTO auto_send_groups (id, name, enabled, batch_send, created_at) VALUES (?, ?, ?, ?, ?)").run("send", "Send", 0, 1, 1);
  const { POST } = await import("@/app/api/db/restore/route");
  const response = await POST(new NextRequest("http://localhost/api/db/restore", { method: "POST", body: JSON.stringify({ source: "local" }) }));
  expect(response.status).toBe(200);
  expect(source.writes).toEqual([]);
  expect(source.rpcCalls).toHaveLength(1);
  const call = source.rpcCalls[0];
  expect(call.name).toBe("restore_local_backup");
  expect(call.args.p_user_id).toBe("test-user");
  expect(call.args.p_tables.saved_searches[0]).not.toHaveProperty("id");
  expect(call.args.p_tables.saved_searches[0]).not.toHaveProperty("user_id");
  expect(call.args.p_tables.saved_searches[0].value).toBe("MixedCase:issuer");
  expect(call.args.p_tables.bulk_recipients[0].addresses).toEqual(["GONE", "GTWO"]);
  expect(call.args.p_tables.auto_send_groups[0].enabled).toBe(false);
  expect(call.args.p_tables.auto_send_groups[0].batch_send).toBe(true);
  expect(call.args.p_tables).not.toHaveProperty("mainnet_signing_budget");
  expect(call.args.p_tables).not.toHaveProperty("local_backup_mutations");
});

it("fails closed without an installed atomic restore RPC", async () => {
  testDir = mkdtempSync(path.join(tmpdir(), "stellar-restore-test-"));
  vi.stubEnv("SQLITE_DB_PATH", path.join(testDir, "test.db"));
  source.rpcError = { code: "PGRST202", message: "Function absent from schema cache" };
  const { POST } = await import("@/app/api/db/restore/route");
  const response = await POST(new NextRequest("http://localhost/api/db/restore", { method: "POST", body: JSON.stringify({ source: "local" }) }));
  expect(response.status).toBe(503);
  expect((await response.json()).error).toContain("atomic_local_restore migration");
  expect(source.writes).toEqual([]);
});

it("rejects both restore directions on Supabase-only deployments before opening SQLite", async () => {
  source.supabaseOnly = true;
  const { POST } = await import("@/app/api/db/restore/route");
  for (const direction of ["local", "supabase"]) {
    const response = await POST(new NextRequest("http://localhost/api/db/restore", { method: "POST", body: JSON.stringify({ source: direction }) }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("local SQLite");
  }
  expect(globalThis._stellarDb).toBeUndefined();
  expect(source.rpcCalls).toEqual([]);
  expect(source.writes).toEqual([]);
});

it("rejects either restore direction while this user's backup jobs are pending", async () => {
  testDir = mkdtempSync(path.join(tmpdir(), "stellar-restore-test-"));
  vi.stubEnv("SQLITE_DB_PATH", path.join(testDir, "test.db"));
  const { getDb } = await import("@/lib/db");
  getDb().prepare("INSERT INTO local_backup_queue (user_id, operations_json, created_at) VALUES (?, ?, ?)").run("test-user", "[]", 1);
  const { POST } = await import("@/app/api/db/restore/route");
  for (const direction of ["local", "supabase"]) {
    const response = await POST(new NextRequest("http://localhost/api/db/restore", { method: "POST", body: JSON.stringify({ source: direction }) }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("pending");
  }
  expect(source.rpcCalls).toEqual([]);
  expect(source.writes).toEqual([]);
});

it("holds the restore lock until the RPC finishes and rejects an overlapping restore", async () => {
  testDir = mkdtempSync(path.join(tmpdir(), "stellar-restore-test-"));
  vi.stubEnv("SQLITE_DB_PATH", path.join(testDir, "test.db"));
  let release!: () => void;
  source.rpcHold = new Promise<void>((resolve) => { release = resolve; });
  const { isLocalRestoreActive } = await import("@/lib/local-restore-lock");
  const { POST } = await import("@/app/api/db/restore/route");
  const request = () => new NextRequest("http://localhost/api/db/restore", { method: "POST", body: JSON.stringify({ source: "local" }) });
  const running = POST(request());
  await vi.waitFor(() => expect(source.rpcCalls).toHaveLength(1));
  expect(isLocalRestoreActive()).toBe(true);
  const overlapping = await POST(request());
  expect(overlapping.status).toBe(409);
  const { POST: startupSync } = await import("@/app/api/db/startup-sync/route");
  expect((await startupSync(new NextRequest("http://localhost/api/db/startup-sync", { method: "POST" }))).status).toBe(409);
  expect(source.rpcCalls).toHaveLength(1);
  release();
  expect((await running).status).toBe(200);
  expect(isLocalRestoreActive()).toBe(false);
});

for (const route of ["restore", "startup-sync"] as const) {
  it(`${route} imports canonical cloud boolean flags into SQLite`, async () => {
    testDir = mkdtempSync(path.join(tmpdir(), "stellar-boolean-test-"));
    vi.stubEnv("SQLITE_DB_PATH", path.join(testDir, "test.db"));
    const { getDb } = await import("@/lib/db");
    const db = getDb();
    source.rows.auto_send_groups = [{ id: "bool-group", name: "Flags", network: "public", secret_key: "", interval_minutes: 60,
      enabled: true, batch_send: false, batch_memo: null, min_reserve: 1, min_sender_threshold: 1,
      preview_only: true, last_failure_at: null, created_at: 1 }];
    source.rows.auto_send_destinations = [{ id: "bool-dest", group_id: "bool-group", destination: "GDEST",
      percentage: 100, is_remainder: true, is_paused: false, label: null, memo: null,
      min_threshold: 0, max_cap: 0, position: 0 }];
    source.rows.bulk_scan_state = [true, false].map((interrupted, i) => ({
      scan_key: `bool-${i}`, rows_json: "[]", interrupted, updated_at: 1,
    }));
    source.rows.tiered_reward_configs = [{ id: "bool-tier", name: "Flags", asset_code: "XLM", asset_issuer: "",
      network: "public", secret_key: "", interval_minutes: 60, enabled: false, min_reserve: 1,
      min_sender_threshold: 1, preview_only: true, batch_send: false, memo: null, fee_multiplier: 1,
      exclude_addresses: [], last_run_at: null, last_failure_at: null, created_at: 1 }];
    const { POST } = route === "restore" ? await import("@/app/api/db/restore/route") : await import("@/app/api/db/startup-sync/route");
    const response = await POST(new NextRequest(`http://localhost/api/db/${route}`, {
      method: "POST", body: JSON.stringify({ source: "supabase" }),
    }));
    expect(response.status).toBe(200);
    expect(db.prepare("SELECT enabled, batch_send, preview_only FROM auto_send_groups").get()).toEqual({ enabled: 1, batch_send: 0, preview_only: 1 });
    expect(db.prepare("SELECT is_remainder, is_paused FROM auto_send_destinations").get()).toEqual({ is_remainder: 1, is_paused: 0 });
    expect(db.prepare("SELECT interrupted FROM bulk_scan_state ORDER BY scan_key").all()).toEqual([{ interrupted: 1 }, { interrupted: 0 }]);
    expect(db.prepare("SELECT enabled, batch_send, preview_only FROM tiered_reward_configs").get()).toEqual({ enabled: 0, batch_send: 0, preview_only: 1 });
  });
}

it("exports only owned payment and approval safety rows", async () => {
  source.supabaseOnly = true;
  source.rows.tiered_reward_configs = [{ id: "owned", user_id: "test-user" }];
  const ownedApproval = { resource_id: "reward-approval:owned", lease_token: JSON.stringify({ configId: "owned", userId: "test-user", digest: "digest" }), expires_at: Number.MAX_SAFE_INTEGER };
  source.rows.tiered_reward_run_leases = [
    { resource_id: "payment-guard:test-user", lease_token: "payment", expires_at: Number.MAX_SAFE_INTEGER },
    { resource_id: "payment-guard:other", lease_token: "foreign", expires_at: Number.MAX_SAFE_INTEGER },
    ownedApproval,
    { ...ownedApproval, resource_id: "reward-approval:foreign", lease_token: JSON.stringify({ configId: "owned", userId: "other", digest: "digest" }) },
  ];
  const { GET } = await import("@/app/api/db/export/route");
  const result = await (await GET(new NextRequest("http://localhost/api/db/export"))).json();
  expect(result.tiered_reward_run_leases).toEqual([source.rows.tiered_reward_run_leases[0], ownedApproval]);
});

for (const route of ["restore", "startup-sync"] as const) {
  it(`${route} preserves the cloud payment guard under its canonical local key`, async () => {
    testDir = mkdtempSync(path.join(tmpdir(), "stellar-payment-guard-test-"));
    vi.stubEnv("SQLITE_DB_PATH", path.join(testDir, "test.db"));
    const { getDb } = await import("@/lib/db"); const db = getDb();
    source.rows.tiered_reward_run_leases = [{ resource_id: "payment-guard:test-user", lease_token: "unresolved", expires_at: Number.MAX_SAFE_INTEGER }];
    const { POST } = route === "restore" ? await import("@/app/api/db/restore/route") : await import("@/app/api/db/startup-sync/route");
    const request = () => new NextRequest(`http://localhost/api/db/${route}`, { method: "POST", body: JSON.stringify({ source: "supabase" }) });
    expect((await POST(request())).status).toBe(200);
    expect(db.prepare("SELECT lease_token FROM tiered_reward_run_leases WHERE resource_id = 'payment-guard:local'").get()).toEqual({ lease_token: "unresolved" });
    source.rows.tiered_reward_run_leases[0].lease_token = "different";
    expect((await POST(request())).status).toBe(409);
    expect(db.prepare("SELECT lease_token FROM tiered_reward_run_leases WHERE resource_id = 'payment-guard:local'").get()).toEqual({ lease_token: "unresolved" });
  });
}

it("uploads the local payment guard under the authenticated cloud key", async () => {
  testDir = mkdtempSync(path.join(tmpdir(), "stellar-payment-guard-test-"));
  vi.stubEnv("SQLITE_DB_PATH", path.join(testDir, "test.db"));
  const { getDb } = await import("@/lib/db");
  getDb().prepare("INSERT INTO tiered_reward_run_leases VALUES (?, ?, ?)").run("payment-guard:local", "unresolved", Number.MAX_SAFE_INTEGER);
  const { POST } = await import("@/app/api/db/restore/route");
  expect((await POST(new NextRequest("http://localhost/api/db/restore", { method: "POST", body: JSON.stringify({ source: "local" }) }))).status).toBe(200);
  expect(source.rpcCalls[0].args.p_tables.tiered_reward_run_leases).toEqual([{ resource_id: "payment-guard:test-user", lease_token: "unresolved", expires_at: Number.MAX_SAFE_INTEGER }]);
});

for (const pullRoute of ["restore", "startup-sync"] as const) {
  it(`${pullRoute} round-trips an identical local approval while retaining outcome conflicts`, async () => {
    testDir = mkdtempSync(path.join(tmpdir(), "stellar-approval-roundtrip-"));
    vi.stubEnv("SQLITE_DB_PATH", path.join(testDir, "test.db"));
    const { getDb } = await import("@/lib/db"); const db = getDb();
    db.prepare("INSERT INTO tiered_reward_configs (id, name, asset_code, asset_issuer, network, secret_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("roundtrip-config", "Rewards", "XLM", "", "public", "", 1);
    const local = JSON.stringify({ configId: "roundtrip-config", userId: "local", digest: "approved", outcome: { totalSent: 1, results: [{ status: "sent", txHash: "hash" }] } });
    db.prepare("INSERT INTO tiered_reward_run_leases VALUES (?, ?, ?)").run("reward-approval:roundtrip", local, Number.MAX_SAFE_INTEGER);
    const { POST: restore } = await import("@/app/api/db/restore/route");
    const request = (source: string) => new NextRequest("http://localhost/api/db/restore", { method: "POST", body: JSON.stringify({ source }) });
    expect((await restore(request("local"))).status).toBe(200);
    const cloudBackup = source.rpcCalls[0].args.p_tables;
    expect(JSON.parse(cloudBackup.tiered_reward_run_leases[0].lease_token as string).userId).toBe("test-user");
    source.rows = structuredClone(cloudBackup);
    const pull = pullRoute === "restore" ? restore : (await import("@/app/api/db/startup-sync/route")).POST;
    expect((await pull(request("supabase"))).status).toBe(200);
    expect(db.prepare("SELECT lease_token FROM tiered_reward_run_leases WHERE resource_id = ?").get("reward-approval:roundtrip")).toEqual({ lease_token: local });
    expect((await restore(request("local"))).status).toBe(200);
    expect(source.rpcCalls[1].args.p_tables.tiered_reward_run_leases).toEqual(cloudBackup.tiered_reward_run_leases);
    const cloudApproval = JSON.parse(source.rows.tiered_reward_run_leases[0].lease_token as string);
    cloudApproval.outcome.totalSent = 2;
    source.rows.tiered_reward_run_leases[0].lease_token = JSON.stringify(cloudApproval);
    expect((await pull(request("supabase"))).status).toBe(409);
    expect(db.prepare("SELECT lease_token FROM tiered_reward_run_leases WHERE resource_id = ?").get("reward-approval:roundtrip")).toEqual({ lease_token: local });
    source.rows = structuredClone(cloudBackup);
    const foreignIdentity = JSON.stringify({ ...JSON.parse(local), userId: "another-user" });
    db.prepare("UPDATE tiered_reward_run_leases SET lease_token = ? WHERE resource_id = ?").run(foreignIdentity, "reward-approval:roundtrip");
    expect((await pull(request("supabase"))).status).toBe(409);
    expect(db.prepare("SELECT lease_token FROM tiered_reward_run_leases WHERE resource_id = ?").get("reward-approval:roundtrip")).toEqual({ lease_token: foreignIdentity });
  });
}
