/**
 * POST /api/db/startup-sync
 * Merges Supabase data into local SQLite on app startup.
 * Uses INSERT OR IGNORE — never overwrites, never loses local data.
 * Only runs in local mode (not on Vercel where SQLite isn't used).
 */
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseConfigured, isSupabaseOnly, requireAuth } from "@/lib/supabase-server";

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
    { data: assetGroupMembers },
    { data: walletFolders },
    { data: wallets },
    { data: appState },
  ] = await Promise.all([
    sb.from("address_book").select("*"),
    sb.from("known_intermediaries").select("*"),
    sb.from("known_creators").select("*"),
    sb.from("saved_analyses").select("*"),
    sb.from("bulk_recipients").select("*"),
    sb.from("proceeds_presets").select("*"),
    sb.from("saved_searches").select("*"),
    sb.from("bulk_run_history").select("*"),
    sb.from("asset_groups").select("*"),
    sb.from("asset_group_members").select("*"),
    sb.from("wallet_folders").select("*"),
    sb.from("wallets").select("*"),
    sb.from("app_state").select("*"),
  ]);

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
  })();

  return NextResponse.json({ ok: true, merged });
}
