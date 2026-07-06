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
import { getSupabase, isSupabaseConfigured, requireAuth } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  let source: string;
  try { ({ source } = await req.json()); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 400 });
  }

  const sb = getSupabase()!;

  if (source === "supabase") {
    // Pull from Supabase → upsert into local SQLite
    const db = getDb();
    const userId = auth.userId!;
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
      { data: autoSendRunLog },
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
      sb.from("auto_send_run_log").select("*").eq("user_id", userId),
    ]);
    // Members and destinations are scoped through their parent tables (no user_id column)
    const assetGroupIds = (assetGroups ?? []).map((g) => g.id as string);
    const autoSendGroupIds = (autoSendGroups ?? []).map((g) => g.id as string);
    const [{ data: assetGroupMembers }, { data: autoSendDestinations }] = await Promise.all([
      assetGroupIds.length > 0
        ? sb.from("asset_group_members").select("*").in("group_id", assetGroupIds)
        : Promise.resolve({ data: [] }),
      autoSendGroupIds.length > 0
        ? sb.from("auto_send_destinations").select("*").in("group_id", autoSendGroupIds)
        : Promise.resolve({ data: [] }),
    ]);

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
      // Asset groups (parents before children)
      for (const r of assetGroups ?? []) {
        db.prepare(`INSERT OR REPLACE INTO asset_groups (id, name, asset_code, issuer, network, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(r.id, r.name, r.asset_code, r.issuer, r.network, r.notes, r.created_at, r.updated_at);
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
          .run(r.id, r.folder_id, r.name, r.public_key, r.secret_key, r.position);
      }
      for (const r of appState ?? []) {
        db.prepare(`INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)`)
          .run(r.key, r.value);
      }
      for (const r of autoSendGroups ?? []) {
        db.prepare(`INSERT OR REPLACE INTO auto_send_groups (id, name, network, secret_key, interval_minutes, enabled, batch_send, batch_memo, min_reserve, min_sender_threshold, preview_only, last_failure_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(r.id, r.name, r.network, r.secret_key, r.interval_minutes, r.enabled, r.batch_send, r.batch_memo, r.min_reserve, r.min_sender_threshold, r.preview_only, r.last_failure_at, r.created_at);
      }
      for (const r of autoSendDestinations ?? []) {
        db.prepare(`INSERT OR REPLACE INTO auto_send_destinations (id, group_id, destination, percentage, is_remainder, is_paused, label, memo, min_threshold, max_cap, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(r.id, r.group_id, r.destination, r.percentage, r.is_remainder, r.is_paused, r.label, r.memo, r.min_threshold, r.max_cap, r.position);
      }
      for (const r of autoSendRunLog ?? []) {
        db.prepare(`INSERT OR REPLACE INTO auto_send_run_log (id, group_id, wallet_address, destination, amount_sent, status, error, ran_at, tx_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(r.id, r.group_id, r.wallet_address, r.destination, r.amount_sent, r.status, r.error, r.ran_at, r.tx_hash);
      }
    })();

    return NextResponse.json({ ok: true, message: "Restored from Supabase to local SQLite" });
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

    const db = getDb();

    const tables = [
      { name: "address_book", rows: db.prepare("SELECT * FROM address_book").all() },
      { name: "known_intermediaries", rows: db.prepare("SELECT * FROM known_intermediaries").all() },
      { name: "known_creators", rows: db.prepare("SELECT * FROM known_creators").all() },
      { name: "saved_analyses", rows: db.prepare("SELECT * FROM saved_analyses").all() },
      { name: "bulk_recipients", rows: db.prepare("SELECT * FROM bulk_recipients").all() },
      { name: "proceeds_presets", rows: db.prepare("SELECT * FROM proceeds_presets").all() },
      { name: "saved_searches", rows: db.prepare("SELECT * FROM saved_searches").all() },
      { name: "bulk_run_history", rows: db.prepare("SELECT * FROM bulk_run_history").all() },
      { name: "asset_groups", rows: db.prepare("SELECT * FROM asset_groups").all() },
      { name: "asset_group_members", rows: db.prepare("SELECT * FROM asset_group_members").all() },
      { name: "wallet_folders", rows: db.prepare("SELECT * FROM wallet_folders").all() },
      { name: "wallets", rows: db.prepare("SELECT * FROM wallets").all() },
      { name: "app_state", rows: db.prepare("SELECT * FROM app_state").all() },
      { name: "auto_send_groups", rows: db.prepare("SELECT * FROM auto_send_groups").all() },
      { name: "auto_send_destinations", rows: db.prepare("SELECT * FROM auto_send_destinations").all() },
      { name: "auto_send_run_log", rows: db.prepare("SELECT * FROM auto_send_run_log").all() },
    ];

    // Saved analyses: parse JSON fields back to objects for Supabase JSONB
    const savedAnalysesRows = (db.prepare("SELECT * FROM saved_analyses").all() as Record<string, unknown>[]).map((r) => ({
      ...r,
      distrib_addresses: JSON.parse(r.distrib_addresses as string),
      result_json: JSON.parse(r.result_json as string),
      tags: r.tags ? JSON.parse(r.tags as string) : null,
    }));
    const bulkRecipientsRows = (db.prepare("SELECT * FROM bulk_recipients").all() as Record<string, unknown>[]).map((r) => ({
      ...r,
      addresses: JSON.parse(r.addresses as string),
    }));

    // Child tables scoped through their parent's group_id — no user_id column of their own
    const NO_USER_ID_TABLES = new Set(["asset_group_members", "auto_send_destinations"]);

    const errors: string[] = [];

    for (const { name, rows } of tables) {
      if (rows.length === 0) continue;
      const data =
        name === "saved_analyses" ? savedAnalysesRows :
        name === "bulk_recipients" ? bulkRecipientsRows :
        rows;

      const skipUserId = NO_USER_ID_TABLES.has(name);

      // Upsert in batches of 500 — every row must carry the resolved user_id
      // (except child tables scoped via their parent's group_id)
      for (let i = 0; i < data.length; i += 500) {
        const batch = (data.slice(i, i + 500) as Record<string, unknown>[]).map((row) =>
          skipUserId ? row : { ...row, user_id: userId },
        );
        const { error } = await sb.from(name).upsert(batch);
        if (error) errors.push(`${name}: ${error.message}`);
      }
    }

    if (errors.length > 0) {
      return NextResponse.json({ ok: false, errors }, { status: 500 });
    }

    return NextResponse.json({ ok: true, message: "Pushed local SQLite to Supabase" });
  }

  return NextResponse.json({ error: "source must be 'supabase' or 'local'" }, { status: 400 });
}
