import { createHash } from "node:crypto";

const SHARED_TABLES = [
  "address_book",
  "known_intermediaries",
  "known_creators",
  "saved_analyses",
  "bulk_recipients",
  "proceeds_presets",
  "saved_searches",
  "bulk_run_history",
  "asset_groups",
  "asset_group_members",
  "wallet_folders",
  "wallets",
  "app_state",
  "auto_send_groups",
  "auto_send_destinations",
  "auto_send_run_log",
  "persons",
  "person_addresses",
  "person_relationships",
  "creator_children",
  "bulk_scan_state",
  "bulk_payment_journal",
  "tiered_reward_configs",
  "tiered_reward_tiers",
  "tiered_reward_assets",
  "tiered_reward_run_log",
  "tiered_reward_run_leases",
];

const SQLITE_ONLY_TABLES = [
  "tracer_watchlist",
  "tracer_watch_events",
  "key_scan_state",
  "key_scan_hits",
];

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function exportedTables(payload) {
  if (payload.source === "sqlite") return [...SHARED_TABLES, ...SQLITE_ONLY_TABLES];
  if (payload.source === "supabase") return SHARED_TABLES;
  throw new Error(`Export has an unknown source: ${String(payload.source)}`);
}

function counts(payload, tables) {
  const result = {};
  for (const table of tables) {
    if (!Array.isArray(payload[table])) throw new Error(`Export is missing table array: ${table}`);
    result[table] = payload[table].length;
  }
  return result;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function fingerprint(payload, tables) {
  const exportedData = Object.fromEntries(
    tables.map((table) => [
      table,
      payload[table]
        .map((row) => JSON.stringify(canonicalize(row)))
        .sort(),
    ]),
  );
  return createHash("sha256").update(JSON.stringify(exportedData)).digest("hex");
}

async function requestJson(url, init) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${JSON.stringify(body)}`);
  return body;
}

const baseUrl = required("DRILL_BASE_URL").replace(/\/$/, "");
const token = required("DRILL_BEARER_TOKEN");
const authorization = { Authorization: `Bearer ${token}` };

const before = await requestJson(`${baseUrl}/api/db/export`, { headers: authorization });
const tables = exportedTables(before);
const beforeCounts = counts(before, tables);
console.log(JSON.stringify({
  stage: "export-validated",
  source: before.source,
  tables: tables.length,
  counts: beforeCounts,
  fingerprint: fingerprint(before, tables),
}));

if (process.env.DRILL_CONFIRM_DISPOSABLE !== "DISPOSABLE") {
  console.log("Validation-only mode. Set DRILL_CONFIRM_DISPOSABLE=DISPOSABLE to exercise the restore endpoint.");
  process.exit(0);
}

const restoreSource = required("DRILL_RESTORE_SOURCE");
if (restoreSource !== "local" && restoreSource !== "supabase") {
  throw new Error("DRILL_RESTORE_SOURCE must be either 'local' or 'supabase'");
}
const restored = await requestJson(`${baseUrl}/api/db/restore`, {
  method: "POST",
  headers: { ...authorization, "Content-Type": "application/json" },
  body: JSON.stringify({ source: restoreSource }),
});
if (restored.ok !== true) throw new Error(`Restore did not report success: ${JSON.stringify(restored)}`);

const after = await requestJson(`${baseUrl}/api/db/export`, { headers: authorization });
if (after.source !== before.source) {
  throw new Error(`Export source changed during the drill: ${before.source} -> ${after.source}`);
}
const afterCounts = counts(after, tables);
const regressions = tables.filter((table) => afterCounts[table] < beforeCounts[table]);
if (regressions.length > 0) {
  throw new Error(`Post-restore export lost rows in: ${regressions.join(", ")}`);
}
if (restoreSource === "supabase") {
  if (!restored.counts || typeof restored.counts !== "object") {
    throw new Error("Supabase restore did not report source row counts");
  }
  const missingRestoredRows = SHARED_TABLES.filter((table) => {
    const sourceCount = restored.counts[table];
    return !Number.isInteger(sourceCount) || afterCounts[table] < sourceCount;
  });
  if (missingRestoredRows.length > 0) {
    throw new Error(`Restored target is missing source rows in: ${missingRestoredRows.join(", ")}`);
  }
}

console.log(JSON.stringify({
  stage: "restore-validated",
  source: after.source,
  tables: tables.length,
  counts: afterCounts,
  fingerprint: fingerprint(after, tables),
}));
