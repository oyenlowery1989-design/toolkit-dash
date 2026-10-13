/**
 * push-to-supabase.mjs
 * Reads local stellar-toolkit.db and pushes everything to Supabase.
 * Run with: node scripts/push-to-supabase.mjs
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env or .env.local
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// Load env from .env.local or .env
function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    const p = join(root, file);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        const val = match[2].trim().replace(/^["']|["']$/g, "");
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
}
loadEnv();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

// Dynamic import better-sqlite3
const Database = (await import("better-sqlite3")).default;
const dbPath = join(root, "stellar-toolkit.db");

if (!existsSync(dbPath)) {
  console.error("❌ stellar-toolkit.db not found at", dbPath);
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });

async function upsert(table, rows) {
  if (!rows.length) return 0;
  // Batch in chunks of 500
  let pushed = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Prefer": "resolution=merge-duplicates",
      },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      const err = await res.text();
      if (table === "bulk_payment_journal") throw new Error(`Bulk payment journal migration failed: ${err.slice(0, 200)}`);
      console.warn(`  ⚠️  ${table} batch error: ${err.slice(0, 200)}`);
    } else {
      pushed += batch.length;
    }
  }
  return pushed;
}

// Parse JSON text fields for Supabase JSONB tables
function parseJsonField(val) {
  if (val == null) return null;
  if (typeof val === "object") return val;
  try { return JSON.parse(val); } catch { return val; }
}

console.log("📦 Reading local SQLite database...\n");

const journalRows = db.prepare("SELECT * FROM bulk_payment_journal").all();
const rewardGuardRows = db.prepare("SELECT * FROM tiered_reward_run_leases WHERE resource_id LIKE 'reward-guard:%'").all();
const configIds = new Set(db.prepare("SELECT id FROM tiered_reward_configs").all().map((row) => row.id));
if (rewardGuardRows.some((row) => !configIds.has(row.resource_id.slice("reward-guard:".length)))) {
  throw new Error("A reward run guard has no local config; reconcile it before migrating");
}
if (rewardGuardRows.length && !process.env.SUPABASE_SYNC_USER_ID) {
  throw new Error("SUPABASE_SYNC_USER_ID is required to migrate Tiered Rewards run guards");
}
if (journalRows.length && !process.env.SUPABASE_SYNC_USER_ID) {
  throw new Error("SUPABASE_SYNC_USER_ID is required to migrate the Bulk Payments recovery journal");
}
if (journalRows.length) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/bulk_payment_journal?user_id=eq.${encodeURIComponent(process.env.SUPABASE_SYNC_USER_ID)}&select=run_id,version,payload_json`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!response.ok) throw new Error(`Could not inspect remote payment journal: ${response.status}`);
  const [remote] = await response.json();
  const local = journalRows[0];
  if (remote && (remote.run_id !== local.run_id || remote.version > local.version ||
      remote.version === local.version && remote.payload_json !== local.payload_json)) {
    throw new Error("Remote payment journal differs; reconcile it before migrating");
  }
}

const tables = {
  address_book: db.prepare("SELECT * FROM address_book").all(),
  known_intermediaries: db.prepare("SELECT * FROM known_intermediaries").all(),
  known_creators: db.prepare("SELECT * FROM known_creators").all(),
  saved_analyses: db.prepare("SELECT * FROM saved_analyses").all().map(r => ({
    ...r,
    distrib_addresses: parseJsonField(r.distrib_addresses),
    result_json: parseJsonField(r.result_json),
    tags: parseJsonField(r.tags),
  })),
  bulk_recipients: db.prepare("SELECT * FROM bulk_recipients").all().map(r => ({
    ...r,
    addresses: parseJsonField(r.addresses),
  })),
  proceeds_presets: db.prepare("SELECT * FROM proceeds_presets").all(),
  saved_searches: db.prepare("SELECT * FROM saved_searches").all(),
  bulk_run_history: db.prepare("SELECT * FROM bulk_run_history").all(),
  asset_groups: db.prepare("SELECT * FROM asset_groups").all(),
  asset_group_members: db.prepare("SELECT * FROM asset_group_members").all(),
  wallet_folders: db.prepare("SELECT * FROM wallet_folders").all(),
  wallets: db.prepare("SELECT * FROM wallets").all(),
  app_state: db.prepare("SELECT * FROM app_state").all(),
  persons: db.prepare("SELECT * FROM persons").all(),
  person_addresses: db.prepare("SELECT * FROM person_addresses").all(),
  person_relationships: db.prepare("SELECT * FROM person_relationships").all(),
  creator_children: db.prepare("SELECT * FROM creator_children").all().map(r => ({
    ...r,
    issued_assets: parseJsonField(r.issued_assets),
    distributed_assets: parseJsonField(r.distributed_assets),
  })),
  auto_send_groups: db.prepare("SELECT * FROM auto_send_groups").all(),
  auto_send_destinations: db.prepare("SELECT * FROM auto_send_destinations").all(),
  auto_send_run_log: db.prepare("SELECT * FROM auto_send_run_log").all(),
  tiered_reward_configs: db.prepare("SELECT * FROM tiered_reward_configs").all().map((row) => ({
    ...row,
    ...(process.env.SUPABASE_SYNC_USER_ID ? { user_id: process.env.SUPABASE_SYNC_USER_ID } : {}),
  })),
  tiered_reward_tiers: db.prepare("SELECT * FROM tiered_reward_tiers").all(),
  tiered_reward_assets: db.prepare("SELECT * FROM tiered_reward_assets").all(),
  tiered_reward_run_log: db.prepare("SELECT * FROM tiered_reward_run_log").all(),
  bulk_scan_state: db.prepare("SELECT * FROM bulk_scan_state").all().map(r => ({
    ...r,
    rows_json: parseJsonField(r.rows_json),
  })),
  bulk_payment_journal: journalRows.map(r => ({
    ...r,
    user_id: process.env.SUPABASE_SYNC_USER_ID,
  })),
};

db.close();

let totalPushed = 0;
for (const row of rewardGuardRows) {
  const configId = row.resource_id.slice("reward-guard:".length);
  const configResponse = await fetch(`${SUPABASE_URL}/rest/v1/tiered_reward_configs?id=eq.${encodeURIComponent(configId)}&select=user_id`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!configResponse.ok) throw new Error(`Could not inspect remote reward config: ${configResponse.status}`);
  const [remoteConfig] = await configResponse.json();
  if (remoteConfig && remoteConfig.user_id !== process.env.SUPABASE_SYNC_USER_ID) {
    throw new Error("Remote reward config belongs to another user; guard migration stopped");
  }
  const guardResponse = await fetch(`${SUPABASE_URL}/rest/v1/tiered_reward_run_leases?resource_id=eq.${encodeURIComponent(row.resource_id)}&select=lease_token`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!guardResponse.ok) throw new Error(`Could not inspect remote reward run guard: ${guardResponse.status}`);
  const [remoteGuard] = await guardResponse.json();
  if (remoteGuard) {
    if (remoteGuard.lease_token !== row.lease_token) throw new Error("Remote reward run guard differs; reconcile it before migrating");
    continue;
  }
  const insertResponse = await fetch(`${SUPABASE_URL}/rest/v1/tiered_reward_run_leases`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    body: JSON.stringify(row),
  });
  if (!insertResponse.ok) throw new Error(`Reward run guard migration failed: ${(await insertResponse.text()).slice(0, 200)}`);
  totalPushed += 1;
}
for (const [table, rows] of Object.entries(tables)) {
  process.stdout.write(`  ${table.padEnd(22)} ${rows.length} rows → `);
  const pushed = await upsert(table, rows);
  console.log(`✓ ${pushed} pushed`);
  totalPushed += pushed;
}

console.log(`\n✅ Done — ${totalPushed} total records pushed to Supabase`);
