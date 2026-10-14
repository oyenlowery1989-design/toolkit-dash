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
}));

vi.mock("@/lib/supabase-server", () => ({
  requireAuth: async () => ({ ok: true, userId: "test-user" }),
  isSupabaseConfigured: () => true,
  isSupabaseOnly: () => source.supabaseOnly,
  getSupabase: () => ({
    from: (table: string) => {
      let rows = source.rows[table] ?? [];
      const query = {
        eq: (column: string, value: unknown) => {
          rows = rows.filter((row) => column === "user_id" && row[column] === undefined || row[column] === value);
          return query;
        },
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
  source.rows.tiered_reward_run_leases = [{ resource_id: "reward-guard:owned", lease_token: "remote-journal", expires_at: Number.MAX_SAFE_INTEGER }];

  const { POST } = await import("@/app/api/db/restore/route");
  const response = await POST(new NextRequest("http://localhost/api/db/restore", {
    method: "POST", body: JSON.stringify({ source: "local" }),
  }));
  expect(response.status).toBe(409);
  expect(source.writes).toEqual([]);
  source.rows.tiered_reward_run_leases = [];
  source.rows.tiered_reward_configs = [{ id: "owned", user_id: "another-user" }];
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
