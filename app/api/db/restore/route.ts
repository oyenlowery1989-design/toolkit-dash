import { normalizeApprovalGuardToken, readBackupRunGuards, LOCAL_RUN_GUARDS_SQL } from "@/lib/backup-run-guards";
/**
 * POST /api/db/restore
 * Restores data from Supabase into local SQLite (or vice versa).
 *
 * Body: { source: "supabase" | "local" }
 *   "supabase" → pulls all data from Supabase and upserts into local SQLite
 *   "local"    → pulls all data from local SQLite and upserts into Supabase
 *
 * This is a one-time migration/recovery tool, not for continuous sync.
 */
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { LocalRestoreBusyError, withLocalRestoreLock } from "@/lib/local-restore-lock";
import { getSupabase, isSupabaseConfigured, isSupabaseOnly, requireAuth } from "@/lib/supabase-server";
import { encryptImportedStoredSecret } from "@/lib/secret-storage";
import { readAllChildRows, readAllUserRows } from "@/lib/supabase-read-all";

type SupabaseRead = { data: Record<string, unknown>[] | null; error?: { message: string } | null };

function unwrapReads(results: SupabaseRead[], tables: string[]): Record<string, unknown>[][] {
  const failures = results
    .map((result, index) => result.error ? `${tables[index]}: ${result.error.message}` : null)
    .filter(Boolean);
  if (failures.length > 0) throw new Error(failures.join("; "));
  return results.map((result) => result.data ?? []);
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  let source: string;
  try { ({ source } = await req.json()); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 400 });
  }

  if (isSupabaseOnly()) {
    return NextResponse.json({ error: "Restore requires a local SQLite database. Use export/import for Supabase-only deployments." }, { status: 400 });
  }

  try {
    return await withLocalRestoreLock(async () => {
  if (auth.userId && getDb().prepare("SELECT 1 FROM local_backup_queue WHERE user_id = ? LIMIT 1").get(auth.userId)) {
    return NextResponse.json({ error: "Local backup changes are pending. Let them finish syncing before restoring either direction." }, { status: 409 });
  }

  const sb = getSupabase()!;

  if (source === "supabase") {
    try {
    // Pull from Supabase → upsert into local SQLite
    const db = getDb();
    const userId = auth.userId!;
    const parentTables = [
      "address_book", "known_intermediaries", "known_creators", "saved_analyses",
      "bulk_recipients", "proceeds_presets", "saved_searches", "bulk_run_history",
      "asset_groups", "wallet_folders", "wallets", "app_state", "auto_send_groups",
      "persons", "creator_children", "bulk_scan_state", "tiered_reward_configs", "bulk_payment_journal",
    ];
    const parentReads = await Promise.all([
      readAllUserRows(sb, "address_book", userId),
      readAllUserRows(sb, "known_intermediaries", userId),
      readAllUserRows(sb, "known_creators", userId),
      readAllUserRows(sb, "saved_analyses", userId),
      readAllUserRows(sb, "bulk_recipients", userId),
      readAllUserRows(sb, "proceeds_presets", userId),
      readAllUserRows(sb, "saved_searches", userId),
      readAllUserRows(sb, "bulk_run_history", userId),
      readAllUserRows(sb, "asset_groups", userId),
      readAllUserRows(sb, "wallet_folders", userId),
      readAllUserRows(sb, "wallets", userId),
      readAllUserRows(sb, "app_state", userId),
      readAllUserRows(sb, "auto_send_groups", userId),
      readAllUserRows(sb, "persons", userId),
      readAllUserRows(sb, "creator_children", userId),
      readAllUserRows(sb, "bulk_scan_state", userId),
      readAllUserRows(sb, "tiered_reward_configs", userId),
      readAllUserRows(sb, "bulk_payment_journal", userId),
    ]);
    const [
      addressBook, knownIntermediaries, knownCreators, savedAnalyses, bulkRecipients,
      proceedsPresets, savedSearches, bulkRunHistory, assetGroups, walletFolders,
      wallets, appState, autoSendGroups, persons, creatorChildren, bulkScanState,
      tieredRewardConfigs, bulkPaymentJournal,
    ] = unwrapReads(parentReads as SupabaseRead[], parentTables);
    // Members and destinations are scoped through their parent tables (no user_id column)
    const assetGroupIds = (assetGroups ?? []).map((g) => g.id as string);
    const autoSendGroupIds = (autoSendGroups ?? []).map((g) => g.id as string);
    const personIds = (persons ?? []).map((p) => p.id as string);
    const tieredConfigIds = (tieredRewardConfigs ?? []).map((c) => c.id as string);
    const childTables = [
      "asset_group_members", "auto_send_destinations", "auto_send_run_log",
      "person_addresses", "person_relationships", "tiered_reward_tiers", "tiered_reward_run_log",
    ];
    const childReads = await Promise.all([
      assetGroupIds.length > 0
        ? readAllChildRows(sb, "asset_group_members", "group_id", assetGroupIds)
        : Promise.resolve({ data: [], error: null }),
      autoSendGroupIds.length > 0
        ? readAllChildRows(sb, "auto_send_destinations", "group_id", autoSendGroupIds)
        : Promise.resolve({ data: [], error: null }),
      autoSendGroupIds.length > 0
        ? readAllChildRows(sb, "auto_send_run_log", "group_id", autoSendGroupIds)
        : Promise.resolve({ data: [], error: null }),
      personIds.length > 0
        ? readAllChildRows(sb, "person_addresses", "person_id", personIds)
        : Promise.resolve({ data: [], error: null }),
      personIds.length > 0
        ? readAllChildRows(sb, "person_relationships", "person_a_id", personIds)
        : Promise.resolve({ data: [], error: null }),
      tieredConfigIds.length > 0
        ? readAllChildRows(sb, "tiered_reward_tiers", "config_id", tieredConfigIds)
        : Promise.resolve({ data: [], error: null }),
      tieredConfigIds.length > 0
        ? readAllChildRows(sb, "tiered_reward_run_log", "config_id", tieredConfigIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const [
      assetGroupMembers, autoSendDestinations, autoSendRunLog, personAddresses,
      personRelationships, tieredRewardTiers, tieredRewardRunLog,
    ] = unwrapReads(childReads as SupabaseRead[], childTables);
    const tierIds = (tieredRewardTiers ?? []).map((t) => t.id as string);
    const tieredRewardAssetsRead = tierIds.length > 0
      ? await readAllChildRows(sb, "tiered_reward_assets", "tier_id", tierIds)
      : { data: [], error: null };
    const [tieredRewardAssets] = unwrapReads(
      [tieredRewardAssetsRead as SupabaseRead], ["tiered_reward_assets"],
    );
    const rewardGuardRead = await readBackupRunGuards(sb, userId, tieredConfigIds);
    const [cloudRunGuards] = unwrapReads([rewardGuardRead as SupabaseRead], ["tiered_reward_run_leases"]);
    const tieredRewardRunLeases = cloudRunGuards.map(row => row.resource_id === `payment-guard:${userId}`
      ? { ...row, resource_id: "payment-guard:local" } : row);
    const remoteJournal = bulkPaymentJournal[0];
    if (remoteJournal) {
      const localJournal = db.prepare("SELECT run_id, version, payload_json FROM bulk_payment_journal WHERE user_id = 'local'")
        .get() as { run_id: string; version: number; payload_json: string } | undefined;
      if (localJournal && (localJournal.run_id !== remoteJournal.run_id ||
          localJournal.version !== remoteJournal.version || localJournal.payload_json !== remoteJournal.payload_json)) {
        return NextResponse.json({ error: "Local payment journal differs; reconcile it before restoring" }, { status: 409 });
      }
    }
    for (const row of tieredRewardRunLeases) {
      const existing = db.prepare("SELECT lease_token FROM tiered_reward_run_leases WHERE resource_id = ?").get(row.resource_id) as { lease_token: string } | undefined;
      if (existing && normalizeApprovalGuardToken(row.resource_id as string, existing.lease_token, userId) !==
        normalizeApprovalGuardToken(row.resource_id as string, row.lease_token as string, userId)) {
        return NextResponse.json({ error: "A local reward run guard differs; reconcile it before restoring" }, { status: 409 });
      }
    }

    if (db.prepare("SELECT 1 FROM local_backup_queue WHERE user_id = ? LIMIT 1").get(userId)) {
      return NextResponse.json({ error: "Local backup changes arrived during restore. Let them finish syncing before retrying." }, { status: 409 });
    }

    db.transaction(() => {
      for (const r of addressBook ?? []) {
        db.prepare(`INSERT OR REPLACE INTO address_book (public_key, label, notes, color, created_at) VALUES (?, ?, ?, ?, ?)`)
          .run(r.public_key, r.label, r.notes, r.color, r.created_at);
      }
      for (const r of knownIntermediaries ?? []) {
        db.prepare(`INSERT OR REPLACE INTO known_intermediaries (address, name, notes, added_at) VALUES (?, ?, ?, ?)`)
          .run(r.address, r.name, r.notes, r.added_at);
      }
      for (const r of knownCreators ?? []) {
        db.prepare(`INSERT OR REPLACE INTO known_creators (address, name, notes, added_at) VALUES (?, ?, ?, ?)`)
          .run(r.address, r.name, r.notes, r.added_at);
      }
      for (const r of savedAnalyses ?? []) {
        const distribAddresses = typeof r.distrib_addresses === "string"
          ? r.distrib_addresses
          : JSON.stringify(r.distrib_addresses);
        const resultJson = typeof r.result_json === "string"
          ? r.result_json
          : JSON.stringify(r.result_json);
        const tags = r.tags ? (typeof r.tags === "string" ? r.tags : JSON.stringify(r.tags)) : null;
        db.prepare(`INSERT OR REPLACE INTO saved_analyses (id, name, asset_code, issuer, distrib_addresses, network, result_json, notes, tags, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(r.id, r.name, r.asset_code, r.issuer, distribAddresses, r.network, resultJson, r.notes, tags, r.created_at);
      }
      for (const r of bulkRecipients ?? []) {
        const addresses = typeof r.addresses === "string" ? r.addresses : JSON.stringify(r.addresses);
        db.prepare(`INSERT OR REPLACE INTO bulk_recipients (id, name, network, addresses, assets_text, saved_at) VALUES (?, ?, ?, ?, ?, ?)`)
          .run(r.id, r.name, r.network, addresses, r.assets_text, r.saved_at);
      }
      for (const r of proceedsPresets ?? []) {
        db.prepare(`INSERT OR REPLACE INTO proceeds_presets (id, asset_code, issuer, distribution_address, network, accounts_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(r.id, r.asset_code, r.issuer, r.distribution_address, r.network, r.accounts_text, r.created_at);
      }
      for (const r of savedSearches ?? []) {
        db.prepare(`INSERT OR REPLACE INTO saved_searches (type, value, label, network, distrib_address, total_xlm_proceeds, total_asset_sold, intermediary_name, accounts_found, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(r.type, r.value, r.label, r.network, r.distrib_address, r.total_xlm_proceeds, r.total_asset_sold, r.intermediary_name, r.accounts_found, r.created_at);
      }
      for (const r of bulkRunHistory ?? []) {
        db.prepare(`INSERT OR REPLACE INTO bulk_run_history (id, network, memo, recipient_count, success_count, failed_count, ran_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(r.id, r.network, r.memo, r.recipient_count, r.success_count, r.failed_count, r.ran_at);
      }
      // People must exist before groups that refer to them.
      for (const r of persons ?? []) {
        db.prepare(`INSERT INTO persons (id, name, role, notes, telegram_channel, telegram_link, telegram_username, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET name = excluded.name, role = excluded.role, notes = excluded.notes, telegram_channel = excluded.telegram_channel, telegram_link = excluded.telegram_link, telegram_username = excluded.telegram_username, created_at = excluded.created_at, updated_at = excluded.updated_at`)
          .run(r.id, r.name, r.role, r.notes, r.telegram_channel, r.telegram_link, r.telegram_username, r.created_at, r.updated_at);
      }
      for (const r of personAddresses ?? []) {
        db.prepare(`INSERT OR REPLACE INTO person_addresses (id, person_id, address, label, added_at) VALUES (?, ?, ?, ?, ?)`)
          .run(r.id, r.person_id, r.address, r.label, r.added_at);
      }
      for (const r of personRelationships ?? []) {
        db.prepare(`INSERT OR REPLACE INTO person_relationships (id, person_a_id, person_b_id, type, created_at) VALUES (?, ?, ?, ?, ?)`)
          .run(r.id, r.person_a_id, r.person_b_id, r.type, r.created_at);
      }
      // Asset groups (parents before children)
      for (const r of assetGroups ?? []) {
        db.prepare(`INSERT INTO asset_groups (id, name, asset_code, issuer, network, notes, domain, telegram_channel, telegram_link, person_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET name = excluded.name, asset_code = excluded.asset_code, issuer = excluded.issuer, network = excluded.network, notes = excluded.notes, domain = excluded.domain, telegram_channel = excluded.telegram_channel, telegram_link = excluded.telegram_link, person_id = excluded.person_id, created_at = excluded.created_at, updated_at = excluded.updated_at`)
          .run(r.id, r.name, r.asset_code, r.issuer, r.network, r.notes, r.domain, r.telegram_channel, r.telegram_link, r.person_id, r.created_at, r.updated_at);
      }
      for (const r of assetGroupMembers ?? []) {
        db.prepare(`INSERT OR REPLACE INTO asset_group_members (id, group_id, address, role, label, notes, home_domain, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(r.id, r.group_id, r.address, r.role, r.label, r.notes, r.home_domain, r.added_at);
      }
      // Wallets (folders before wallets)
      for (const r of walletFolders ?? []) {
        db.prepare(`INSERT OR REPLACE INTO wallet_folders (id, name, position) VALUES (?, ?, ?)`)
          .run(r.id, r.name, r.position);
      }
      for (const r of wallets ?? []) {
        db.prepare(`INSERT OR REPLACE INTO wallets (id, folder_id, name, public_key, secret_key, position) VALUES (?, ?, ?, ?, ?, ?)`)
          .run(r.id, r.folder_id, r.name, r.public_key, encryptImportedStoredSecret(r.secret_key), r.position);
      }
      for (const r of appState ?? []) {
        db.prepare(`INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)`)
          .run(r.key, r.value);
      }
      for (const r of autoSendGroups ?? []) {
        db.prepare(`INSERT INTO auto_send_groups (id, name, network, secret_key, interval_minutes, enabled, batch_send, batch_memo, min_reserve, min_sender_threshold, preview_only, last_failure_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET name = excluded.name, network = excluded.network, secret_key = excluded.secret_key, interval_minutes = excluded.interval_minutes, enabled = excluded.enabled, batch_send = excluded.batch_send, batch_memo = excluded.batch_memo, min_reserve = excluded.min_reserve, min_sender_threshold = excluded.min_sender_threshold, preview_only = excluded.preview_only, last_failure_at = excluded.last_failure_at, created_at = excluded.created_at`)
          .run(r.id, r.name, "public", encryptImportedStoredSecret(r.secret_key), r.interval_minutes, Number(r.enabled), Number(r.batch_send), r.batch_memo, r.min_reserve, r.min_sender_threshold, Number(r.preview_only), r.last_failure_at, r.created_at);
      }
      for (const r of autoSendDestinations ?? []) {
        db.prepare(`INSERT OR REPLACE INTO auto_send_destinations (id, group_id, destination, percentage, is_remainder, is_paused, label, memo, min_threshold, max_cap, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(r.id, r.group_id, r.destination, r.percentage, Number(r.is_remainder), Number(r.is_paused), r.label, r.memo, r.min_threshold, r.max_cap, r.position);
      }
      for (const r of autoSendRunLog ?? []) {
        db.prepare(`INSERT OR REPLACE INTO auto_send_run_log (id, group_id, wallet_address, destination, amount_sent, status, error, ran_at, tx_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(r.id, r.group_id, r.wallet_address, r.destination, r.amount_sent, r.status, r.error, r.ran_at, r.tx_hash);
      }
      for (const r of creatorChildren ?? []) {
        const issuedAssets = r.issued_assets == null || typeof r.issued_assets === "string"
          ? r.issued_assets : JSON.stringify(r.issued_assets);
        const distributedAssets = r.distributed_assets == null || typeof r.distributed_assets === "string"
          ? r.distributed_assets : JSON.stringify(r.distributed_assets);
        db.prepare(`INSERT OR REPLACE INTO creator_children (id, creator_address, child_address, network, via_intermediary, created_on_chain, confidence, starting_balance, home_domain, issued_assets, distributed_assets, parent_address, discovered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(r.id, r.creator_address, r.child_address, "public", r.via_intermediary, r.created_on_chain, r.confidence, r.starting_balance, r.home_domain, issuedAssets, distributedAssets, r.parent_address, r.discovered_at);
      }
      for (const r of bulkScanState ?? []) {
        db.prepare(`INSERT OR REPLACE INTO bulk_scan_state (id, scan_key, rows_json, interrupted, updated_at) VALUES (?, ?, ?, ?, ?)`)
          .run(`local:${r.scan_key}`, r.scan_key, r.rows_json, Number(r.interrupted), r.updated_at);
      }
      for (const r of bulkPaymentJournal ?? []) {
        db.prepare(`INSERT OR IGNORE INTO bulk_payment_journal (user_id, run_id, version, payload_json, updated_at) VALUES (?, ?, ?, ?, ?)`)
          .run("local", r.run_id, r.version, r.payload_json, r.updated_at);
      }
      for (const r of tieredRewardConfigs ?? []) {
        const excludeAddresses = typeof r.exclude_addresses === "string"
          ? r.exclude_addresses : JSON.stringify(r.exclude_addresses ?? []);
        db.prepare(`INSERT INTO tiered_reward_configs (id, name, asset_code, asset_issuer, network, secret_key, interval_minutes, enabled, min_reserve, min_sender_threshold, preview_only, batch_send, memo, fee_multiplier, exclude_addresses, last_run_at, last_failure_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET name = excluded.name, asset_code = excluded.asset_code, asset_issuer = excluded.asset_issuer, network = excluded.network, secret_key = excluded.secret_key, interval_minutes = excluded.interval_minutes, enabled = excluded.enabled, min_reserve = excluded.min_reserve, min_sender_threshold = excluded.min_sender_threshold, preview_only = excluded.preview_only, batch_send = excluded.batch_send, memo = excluded.memo, fee_multiplier = excluded.fee_multiplier, exclude_addresses = excluded.exclude_addresses, last_run_at = excluded.last_run_at, last_failure_at = excluded.last_failure_at, created_at = excluded.created_at`)
          .run(r.id, r.name, r.asset_code, r.asset_issuer, "public", encryptImportedStoredSecret(r.secret_key), r.interval_minutes, Number(r.enabled), r.min_reserve, r.min_sender_threshold, Number(r.preview_only), Number(r.batch_send), r.memo, r.fee_multiplier, excludeAddresses, r.last_run_at, r.last_failure_at, r.created_at);
      }
      for (const r of tieredRewardTiers ?? []) {
        db.prepare(`INSERT INTO tiered_reward_tiers (id, config_id, tier_number, min_tokens, max_tokens, position) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET config_id = excluded.config_id, tier_number = excluded.tier_number, min_tokens = excluded.min_tokens, max_tokens = excluded.max_tokens, position = excluded.position`)
          .run(r.id, r.config_id, r.tier_number, r.min_tokens, r.max_tokens, r.position);
      }
      for (const r of tieredRewardAssets ?? []) {
        db.prepare(`INSERT OR REPLACE INTO tiered_reward_assets (id, tier_id, asset_code, asset_issuer, amount) VALUES (?, ?, ?, ?, ?)`)
          .run(r.id, r.tier_id, r.asset_code, r.asset_issuer, r.amount);
      }
      for (const r of tieredRewardRunLog ?? []) {
        db.prepare(`INSERT OR REPLACE INTO tiered_reward_run_log (id, config_id, tier_number, holder_address, asset_code, asset_issuer, amount_sent, status, tx_hash, error, ran_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(r.id, r.config_id, r.tier_number, r.holder_address, r.asset_code, r.asset_issuer, r.amount_sent, r.status, r.tx_hash, r.error, r.ran_at);
      }
      for (const r of tieredRewardRunLeases) {
        db.prepare("INSERT OR IGNORE INTO tiered_reward_run_leases (resource_id, lease_token, expires_at) VALUES (?, ?, ?)")
          .run(r.resource_id, r.lease_token, r.expires_at);
      }
    })();

    const counts = Object.fromEntries([
      ...parentTables.map((table, index) => [table, [
        addressBook, knownIntermediaries, knownCreators, savedAnalyses, bulkRecipients,
        proceedsPresets, savedSearches, bulkRunHistory, assetGroups, walletFolders,
        wallets, appState, autoSendGroups, persons, creatorChildren, bulkScanState,
        tieredRewardConfigs, bulkPaymentJournal,
      ][index].length]),
      ...childTables.map((table, index) => [table, [
        assetGroupMembers, autoSendDestinations, autoSendRunLog, personAddresses,
        personRelationships, tieredRewardTiers, tieredRewardRunLog,
      ][index].length]),
      ["tiered_reward_assets", tieredRewardAssets.length],
      ["tiered_reward_run_leases", tieredRewardRunLeases.length],
    ]);
    return NextResponse.json({ ok: true, message: "Restored from Supabase to local SQLite", counts });
    } catch (error) {
      console.error("[db/restore] Supabase backup read failed:", error);
      return NextResponse.json({ error: "Backup source read failed" }, { status: 502 });
    }
  }

  if (source === "local") {
    // Push local SQLite → Supabase
    const userId = auth.userId;
    if (!userId) {
      return NextResponse.json(
        {
          error:
            "No Supabase user id resolvable for local backup. Set SUPABASE_SYNC_USER_ID (local dev) before restoring local data to Supabase.",
        },
        { status: 400 },
      );
    }

    try {
      const db = getDb();
      // Snapshot every table together; the RPC commits the entire cloud merge or nothing.
      const payload = db.transaction(() => {
        const tables = [
          "address_book", "known_intermediaries", "known_creators", "saved_analyses",
          "bulk_recipients", "proceeds_presets", "saved_searches", "bulk_run_history",
          "persons", "person_addresses", "person_relationships", "asset_groups",
          "asset_group_members", "wallet_folders", "wallets", "app_state",
          "auto_send_groups", "auto_send_destinations", "auto_send_run_log",
          "creator_children", "bulk_scan_state", "bulk_payment_journal",
          "tiered_reward_configs", "tiered_reward_tiers", "tiered_reward_assets",
          "tiered_reward_run_log",
        ];
        const jsonColumns: Record<string, string[]> = {
          saved_analyses: ["distrib_addresses", "result_json", "tags"],
          bulk_recipients: ["addresses"],
          creator_children: ["issued_assets", "distributed_assets"],
          tiered_reward_configs: ["exclude_addresses"],
        };
        const booleanColumns = ["enabled", "batch_send", "preview_only", "is_remainder", "is_paused", "interrupted"];
        const result: Record<string, Record<string, unknown>[]> = {};
        for (const table of tables) {
          result[table] = (db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[]).map((original) => {
            const row = { ...original };
            delete row.user_id;
            if (table === "saved_searches" || table === "bulk_scan_state") delete row.id;
            for (const column of jsonColumns[table] ?? []) {
              if (typeof row[column] === "string") row[column] = JSON.parse(row[column] as string);
            }
            for (const column of booleanColumns) {
              if (column in row) row[column] = Boolean(row[column]);
            }
            if ("secret_key" in row) row.secret_key = encryptImportedStoredSecret(row.secret_key);
            if (["creator_children", "tiered_reward_configs", "auto_send_groups"].includes(table)) row.network = "public";
            return row;
          });
        }
        result.tiered_reward_run_leases = db.prepare(LOCAL_RUN_GUARDS_SQL).all() as Record<string, unknown>[];
        result.tiered_reward_run_leases = result.tiered_reward_run_leases.map(row => {
          if (row.resource_id === "payment-guard:local") return { ...row, resource_id: `payment-guard:${userId}` };
          if (String(row.resource_id).startsWith("reward-approval:")) {
            const approval = JSON.parse(row.lease_token as string);
            if (approval.userId !== "local" && approval.userId !== userId) throw new Error("Reward approval belongs to another user");
            return { ...row, lease_token: JSON.stringify({ ...approval, userId }) };
          }
          return row;
        });
        return result;
      })();
      const { error } = await sb.rpc("restore_local_backup", { p_user_id: userId, p_tables: payload });
      if (error) {
        if (error.code === "PGRST202" || error.code === "42883") {
          return NextResponse.json({ error: "Atomic restore RPC is unavailable. Apply the atomic_local_restore migration and reload the Supabase API schema cache before retrying. No data was restored." }, { status: 503 });
        }
        return NextResponse.json({ error: `Atomic restore failed: ${error.message}` }, { status: error.code === "23505" || error.code === "PT409" ? 409 : 502 });
      }
      return NextResponse.json({ ok: true, message: "Pushed local SQLite to Supabase atomically" });
    } catch (error) {
      return NextResponse.json({ error: `Could not prepare local restore: ${error instanceof Error ? error.message : "Unknown error"}` }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "source must be 'supabase' or 'local'" }, { status: 400 });
    });
  } catch (error) {
    if (error instanceof LocalRestoreBusyError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }

}
