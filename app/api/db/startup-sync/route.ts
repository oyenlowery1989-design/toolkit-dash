/**
 * POST /api/db/startup-sync
 * Merges Supabase data into local SQLite on app startup.
 * Uses INSERT OR IGNORE — never overwrites, never loses local data.
 * Only runs in local mode (not on Vercel where SQLite isn't used).
 */
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  getSupabase,
  isSupabaseConfigured,
  isSupabaseOnly,
  requireAuth,
  warnSyncSkippedOnce,
} from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  // No-op on Vercel — Supabase is already the primary DB
  if (isSupabaseOnly()) {
    return NextResponse.json({ ok: true, skipped: true, reason: "supabase-only mode" });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: true, skipped: true, reason: "supabase not configured" });
  }

  const userId = auth.userId;
  if (!userId) {
    warnSyncSkippedOnce();
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "no SUPABASE_SYNC_USER_ID configured",
    });
  }

  const sb = getSupabase()!;
  const db = getDb();

  const [
    { data: addressBook },
    { data: knownIntermediaries },
    { data: knownCreators },
    { data: savedAnalyses },
    { data: bulkRecipients },
    { data: proceedsPresets },
    { data: savedSearches },
    { data: bulkRunHistory },
    { data: assetGroups },
    { data: walletFolders },
    { data: wallets },
    { data: appState },
    { data: autoSendGroups },
    { data: tieredRewardConfigs },
  ] = await Promise.all([
    sb.from("address_book").select("*").eq("user_id", userId),
    sb.from("known_intermediaries").select("*").eq("user_id", userId),
    sb.from("known_creators").select("*").eq("user_id", userId),
    sb.from("saved_analyses").select("*").eq("user_id", userId),
    sb.from("bulk_recipients").select("*").eq("user_id", userId),
    sb.from("proceeds_presets").select("*").eq("user_id", userId),
    sb.from("saved_searches").select("*").eq("user_id", userId),
    sb.from("bulk_run_history").select("*").eq("user_id", userId),
    sb.from("asset_groups").select("*").eq("user_id", userId),
    sb.from("wallet_folders").select("*").eq("user_id", userId),
    sb.from("wallets").select("*").eq("user_id", userId),
    sb.from("app_state").select("*").eq("user_id", userId),
    sb.from("auto_send_groups").select("*").eq("user_id", userId),
    sb.from("tiered_reward_configs").select("*").eq("user_id", userId),
  ]);

  // Child tables with no user_id column of their own — scoped through their parent instead
  const assetGroupIds = (assetGroups ?? []).map((g) => g.id as string);
  const autoSendGroupIds = (autoSendGroups ?? []).map((g) => g.id as string);
  const tieredRewardConfigIds = (tieredRewardConfigs ?? []).map((c) => c.id as string);
  const [
    { data: assetGroupMembers },
    { data: autoSendDestinations },
    { data: autoSendRunLog },
    { data: tieredRewardTiers },
    { data: tieredRewardRunLog },
  ] = await Promise.all([
    assetGroupIds.length > 0
      ? sb.from("asset_group_members").select("*").in("group_id", assetGroupIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    autoSendGroupIds.length > 0
      ? sb.from("auto_send_destinations").select("*").in("group_id", autoSendGroupIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    autoSendGroupIds.length > 0
      ? sb.from("auto_send_run_log").select("*").eq("user_id", userId)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    tieredRewardConfigIds.length > 0
      ? sb.from("tiered_reward_tiers").select("*").in("config_id", tieredRewardConfigIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    tieredRewardConfigIds.length > 0
      ? sb.from("tiered_reward_run_log").select("*").eq("user_id", userId)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);
  const tieredRewardTierIds = (tieredRewardTiers ?? []).map((t) => t.id as string);
  const { data: tieredRewardAssets } =
    tieredRewardTierIds.length > 0
      ? await sb.from("tiered_reward_assets").select("*").in("tier_id", tieredRewardTierIds)
      : { data: [] as Record<string, unknown>[] };

  let merged = 0;

  db.transaction(() => {
    for (const r of addressBook ?? []) {
      const result = db.prepare(
        "INSERT OR IGNORE INTO address_book (public_key, label, notes, color, created_at) VALUES (?, ?, ?, ?, ?)"
      ).run(r.public_key, r.label, r.notes, r.color, r.created_at);
      merged += result.changes;
    }
    for (const r of knownIntermediaries ?? []) {
      const result = db.prepare(
        "INSERT OR IGNORE INTO known_intermediaries (address, name, notes, added_at) VALUES (?, ?, ?, ?)"
      ).run(r.address, r.name, r.notes, r.added_at);
      merged += result.changes;
    }
    for (const r of knownCreators ?? []) {
      const result = db.prepare(
        "INSERT OR IGNORE INTO known_creators (address, name, notes, added_at) VALUES (?, ?, ?, ?)"
      ).run(r.address, r.name, r.notes, r.added_at);
      merged += result.changes;
    }
    for (const r of savedAnalyses ?? []) {
      const distribAddresses = typeof r.distrib_addresses === "string"
        ? r.distrib_addresses : JSON.stringify(r.distrib_addresses);
      const resultJson = typeof r.result_json === "string"
        ? r.result_json : JSON.stringify(r.result_json);
      const tags = r.tags ? (typeof r.tags === "string" ? r.tags : JSON.stringify(r.tags)) : null;
      const result = db.prepare(
        "INSERT OR IGNORE INTO saved_analyses (id, name, asset_code, issuer, distrib_addresses, network, result_json, notes, tags, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(r.id, r.name, r.asset_code, r.issuer, distribAddresses, r.network, resultJson, r.notes, tags, r.created_at);
      merged += result.changes;
    }
    for (const r of bulkRecipients ?? []) {
      const addresses = typeof r.addresses === "string" ? r.addresses : JSON.stringify(r.addresses);
      const result = db.prepare(
        "INSERT OR IGNORE INTO bulk_recipients (id, name, network, addresses, assets_text, saved_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(r.id, r.name, r.network, addresses, r.assets_text, r.saved_at);
      merged += result.changes;
    }
    for (const r of proceedsPresets ?? []) {
      const result = db.prepare(
        "INSERT OR IGNORE INTO proceeds_presets (id, asset_code, issuer, distribution_address, network, accounts_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(r.id, r.asset_code, r.issuer, r.distribution_address, r.network, r.accounts_text, r.created_at);
      merged += result.changes;
    }
    for (const r of savedSearches ?? []) {
      const result = db.prepare(
        "INSERT OR IGNORE INTO saved_searches (type, value, label, network, distrib_address, total_xlm_proceeds, total_asset_sold, intermediary_name, accounts_found, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(r.type, r.value, r.label, r.network, r.distrib_address, r.total_xlm_proceeds, r.total_asset_sold, r.intermediary_name, r.accounts_found, r.created_at);
      merged += result.changes;
    }
    for (const r of bulkRunHistory ?? []) {
      const result = db.prepare(
        "INSERT OR IGNORE INTO bulk_run_history (id, network, memo, recipient_count, success_count, failed_count, ran_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(r.id, r.network, r.memo, r.recipient_count, r.success_count, r.failed_count, r.ran_at);
      merged += result.changes;
    }
    // Groups — parents before children
    for (const r of assetGroups ?? []) {
      const result = db.prepare(
        "INSERT OR IGNORE INTO asset_groups (id, name, asset_code, issuer, network, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(r.id, r.name, r.asset_code, r.issuer, r.network, r.notes, r.created_at, r.updated_at);
      merged += result.changes;
    }
    for (const r of assetGroupMembers ?? []) {
      const result = db.prepare(
        "INSERT OR IGNORE INTO asset_group_members (id, group_id, address, role, label, notes, home_domain, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(r.id, r.group_id, r.address, r.role, r.label, r.notes, r.home_domain, r.added_at);
      merged += result.changes;
    }
    // Wallets — folders before wallets
    for (const r of walletFolders ?? []) {
      const result = db.prepare(
        "INSERT OR IGNORE INTO wallet_folders (id, name, position) VALUES (?, ?, ?)"
      ).run(r.id, r.name, r.position);
      merged += result.changes;
    }
    for (const r of wallets ?? []) {
      const result = db.prepare(
        "INSERT OR IGNORE INTO wallets (id, folder_id, name, public_key, secret_key, position) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(r.id, r.folder_id, r.name, r.public_key, r.secret_key, r.position);
      merged += result.changes;
    }
    for (const r of appState ?? []) {
      const result = db.prepare(
        "INSERT OR IGNORE INTO app_state (key, value) VALUES (?, ?)"
      ).run(r.key, r.value);
      merged += result.changes;
    }
    // Auto-send groups — parents before children
    for (const r of autoSendGroups ?? []) {
      const result = db.prepare(
        "INSERT OR IGNORE INTO auto_send_groups (id, name, network, secret_key, interval_minutes, enabled, batch_send, batch_memo, min_reserve, min_sender_threshold, preview_only, last_failure_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(r.id, r.name, r.network, r.secret_key, r.interval_minutes, r.enabled, r.batch_send, r.batch_memo, r.min_reserve, r.min_sender_threshold, r.preview_only, r.last_failure_at, r.created_at);
      merged += result.changes;
    }
    for (const r of autoSendDestinations ?? []) {
      const result = db.prepare(
        "INSERT OR IGNORE INTO auto_send_destinations (id, group_id, destination, percentage, is_remainder, is_paused, label, memo, min_threshold, max_cap, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(r.id, r.group_id, r.destination, r.percentage, r.is_remainder, r.is_paused, r.label, r.memo, r.min_threshold, r.max_cap, r.position);
      merged += result.changes;
    }
    for (const r of autoSendRunLog ?? []) {
      const result = db.prepare(
        "INSERT OR IGNORE INTO auto_send_run_log (id, group_id, wallet_address, destination, amount_sent, status, error, ran_at, tx_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(r.id, r.group_id, r.wallet_address, r.destination, r.amount_sent, r.status, r.error, r.ran_at, r.tx_hash);
      merged += result.changes;
    }
    // Tiered rewards — configs before tiers before assets
    for (const r of tieredRewardConfigs ?? []) {
      const excludeAddresses = JSON.stringify(r.exclude_addresses ?? []);
      const result = db.prepare(
        "INSERT OR IGNORE INTO tiered_reward_configs (id, name, asset_code, asset_issuer, network, secret_key, interval_minutes, enabled, min_reserve, min_sender_threshold, preview_only, batch_send, memo, fee_multiplier, exclude_addresses, last_run_at, last_failure_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(r.id, r.name, r.asset_code, r.asset_issuer, r.network, r.secret_key, r.interval_minutes, r.enabled, r.min_reserve, r.min_sender_threshold, r.preview_only, r.batch_send, r.memo, r.fee_multiplier, excludeAddresses, r.last_run_at, r.last_failure_at, r.created_at);
      merged += result.changes;
    }
    for (const r of tieredRewardTiers ?? []) {
      const result = db.prepare(
        "INSERT OR IGNORE INTO tiered_reward_tiers (id, config_id, tier_number, min_tokens, max_tokens, position) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(r.id, r.config_id, r.tier_number, r.min_tokens, r.max_tokens, r.position);
      merged += result.changes;
    }
    for (const r of tieredRewardAssets ?? []) {
      const result = db.prepare(
        "INSERT OR IGNORE INTO tiered_reward_assets (id, tier_id, asset_code, asset_issuer, amount) VALUES (?, ?, ?, ?, ?)"
      ).run(r.id, r.tier_id, r.asset_code, r.asset_issuer, r.amount);
      merged += result.changes;
    }
    for (const r of tieredRewardRunLog ?? []) {
      const result = db.prepare(
        "INSERT OR IGNORE INTO tiered_reward_run_log (id, config_id, tier_number, holder_address, asset_code, asset_issuer, amount_sent, status, tx_hash, error, ran_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(r.id, r.config_id, r.tier_number, r.holder_address, r.asset_code, r.asset_issuer, r.amount_sent, r.status, r.tx_hash, r.error, r.ran_at);
      merged += result.changes;
    }
  })();

  return NextResponse.json({ ok: true, merged });
}
