import { readAllSupabaseRows } from "@/lib/supabase-pagination";
/**
 * GET /api/db/export
 * Returns a full JSON dump of all local SQLite tables.
 * Use this to migrate data to Supabase or create a manual backup.
 */
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly, requireAuth } from "@/lib/supabase-server";
import { readSavedAnalysisRows } from "@/lib/saved-analyses/server";

type SupabaseRead = { data: Record<string, unknown>[] | null; error?: { message: string } | null };

function unwrapReads(results: SupabaseRead[], tables: string[]): Record<string, unknown>[][] {
  const failures = results
    .map((result, index) => result.error ? `${tables[index]}: ${result.error.message}` : null)
    .filter(Boolean);
  if (failures.length > 0) throw new Error(failures.join("; "));
  return results.map((result) => result.data ?? []);
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  if (isSupabaseOnly()) {
    try {
    // Export from Supabase — scoped to user
    const sb = getSupabase()!;
    const uid = userId!;
    const parentTables = [
      "address_book", "known_intermediaries", "known_creators", "saved_analyses",
      "bulk_recipients", "proceeds_presets", "saved_searches", "bulk_run_history",
      "asset_groups", "wallet_folders", "wallets", "app_state", "auto_send_groups",
      "persons", "creator_children", "bulk_scan_state", "tiered_reward_configs",
    ];
    const parentReads = await Promise.all([
      readAllSupabaseRows("address_book", (q) => q.eq("user_id", uid)),
      readAllSupabaseRows("known_intermediaries", (q) => q.eq("user_id", uid)),
      readAllSupabaseRows("known_creators", (q) => q.eq("user_id", uid)),
      readSavedAnalysisRows(uid),
      readAllSupabaseRows("bulk_recipients", (q) => q.eq("user_id", uid)),
      readAllSupabaseRows("proceeds_presets", (q) => q.eq("user_id", uid)),
      readAllSupabaseRows("saved_searches", (q) => q.eq("user_id", uid)),
      readAllSupabaseRows("bulk_run_history", (q) => q.eq("user_id", uid)),
      readAllSupabaseRows("asset_groups", (q) => q.eq("user_id", uid)),
      readAllSupabaseRows("wallet_folders", (q) => q.eq("user_id", uid)),
      readAllSupabaseRows("wallets", (q) => q.eq("user_id", uid)),
      readAllSupabaseRows("app_state", (q) => q.eq("user_id", uid)),
      readAllSupabaseRows("auto_send_groups", (q) => q.eq("user_id", uid)),
      readAllSupabaseRows("persons", (q) => q.eq("user_id", uid)),
      readAllSupabaseRows("creator_children", (q) => q.eq("user_id", uid)),
      readAllSupabaseRows("bulk_scan_state", (q) => q.eq("user_id", uid)),
      readAllSupabaseRows("tiered_reward_configs", (q) => q.eq("user_id", uid)),
    ]);
    const [
      addressBook, knownIntermediaries, knownCreators, savedAnalyses, bulkRecipients,
      proceedsPresets, savedSearches, bulkRunHistory, assetGroups, walletFolders,
      wallets, appState, autoSendGroups, persons, creatorChildren, bulkScanState,
      tieredRewardConfigs,
    ] = unwrapReads(parentReads as SupabaseRead[], parentTables);
    // Fetch members for user's asset groups only
    const groupIds = (assetGroups ?? []).map((g: Record<string, unknown>) => g.id as string);
    const assetGroupMembersRead = groupIds.length > 0
      ? await readAllSupabaseRows("asset_group_members", (q) => q.in("group_id", groupIds))
      : { data: [], error: null };
    const [assetGroupMembers] = unwrapReads([assetGroupMembersRead as SupabaseRead], ["asset_group_members"]);
    // Fetch auto-send child rows scoped through parent group ownership
    const autoSendGroupIds = (autoSendGroups ?? []).map((g: Record<string, unknown>) => g.id as string);
    const autoSendReads = await Promise.all([
      autoSendGroupIds.length > 0
        ? readAllSupabaseRows("auto_send_destinations", (q) => q.in("group_id", autoSendGroupIds))
        : Promise.resolve({ data: [], error: null }),
      autoSendGroupIds.length > 0
        ? readAllSupabaseRows("auto_send_run_log", (q) => q.in("group_id", autoSendGroupIds))
        : Promise.resolve({ data: [], error: null }),
    ]);
    const [autoSendDestinations, autoSendRunLog] = unwrapReads(
      autoSendReads as SupabaseRead[], ["auto_send_destinations", "auto_send_run_log"],
    );
    const personIds = (persons ?? []).map((person: Record<string, unknown>) => person.id as string);
    const personReads = await Promise.all([
      personIds.length > 0
        ? readAllSupabaseRows("person_addresses", (q) => q.in("person_id", personIds))
        : Promise.resolve({ data: [], error: null }),
      personIds.length > 0
        ? readAllSupabaseRows("person_relationships", (q) => q.in("person_a_id", personIds))
        : Promise.resolve({ data: [], error: null }),
    ]);
    const [personAddresses, personRelationships] = unwrapReads(
      personReads as SupabaseRead[], ["person_addresses", "person_relationships"],
    );
    const tieredConfigIds = (tieredRewardConfigs ?? []).map((config: Record<string, unknown>) => config.id as string);
    const tieredReads = await Promise.all([
      tieredConfigIds.length > 0
        ? readAllSupabaseRows("tiered_reward_tiers", (q) => q.in("config_id", tieredConfigIds))
        : Promise.resolve({ data: [], error: null }),
      tieredConfigIds.length > 0
        ? readAllSupabaseRows("tiered_reward_run_log", (q) => q.in("config_id", tieredConfigIds))
        : Promise.resolve({ data: [], error: null }),
    ]);
    const [tieredRewardTiers, tieredRewardRunLog] = unwrapReads(
      tieredReads as SupabaseRead[], ["tiered_reward_tiers", "tiered_reward_run_log"],
    );
    const tierIds = (tieredRewardTiers ?? []).map((tier: Record<string, unknown>) => tier.id as string);
    const tieredRewardAssetsRead = tierIds.length > 0
      ? await readAllSupabaseRows("tiered_reward_assets", (q) => q.in("tier_id", tierIds))
      : { data: [], error: null };
    const [tieredRewardAssets] = unwrapReads(
      [tieredRewardAssetsRead as SupabaseRead], ["tiered_reward_assets"],
    );

    return NextResponse.json({
      exportedAt: Date.now(),
      source: "supabase",
      scope: "tenant",
      address_book: addressBook ?? [],
      known_intermediaries: knownIntermediaries ?? [],
      known_creators: knownCreators ?? [],
      saved_analyses: savedAnalyses ?? [],
      bulk_recipients: bulkRecipients ?? [],
      proceeds_presets: proceedsPresets ?? [],
      saved_searches: savedSearches ?? [],
      bulk_run_history: bulkRunHistory ?? [],
      asset_groups: assetGroups ?? [],
      asset_group_members: assetGroupMembers ?? [],
      wallet_folders: walletFolders ?? [],
      wallets: wallets ?? [],
      app_state: appState ?? [],
      auto_send_groups: autoSendGroups ?? [],
      auto_send_destinations: autoSendDestinations ?? [],
      auto_send_run_log: autoSendRunLog ?? [],
      persons: persons ?? [],
      person_addresses: personAddresses ?? [],
      person_relationships: personRelationships ?? [],
      creator_children: creatorChildren ?? [],
      bulk_scan_state: bulkScanState ?? [],
      tiered_reward_configs: tieredRewardConfigs ?? [],
      tiered_reward_tiers: tieredRewardTiers ?? [],
      tiered_reward_assets: tieredRewardAssets ?? [],
      tiered_reward_run_log: tieredRewardRunLog ?? [],
    });
    } catch (error) {
      console.error("[db/export] Supabase backup read failed:", error);
      return NextResponse.json({ error: "Backup source read failed" }, { status: 502 });
    }
  }

  // Export from SQLite
  const db = getDb();
  return NextResponse.json({
    exportedAt: Date.now(),
    source: "sqlite",
    mainnet_executions: db.prepare("SELECT * FROM mainnet_executions").all(),
    scheduled_jobs: db.prepare("SELECT * FROM scheduled_jobs").all(),
    used_preview_approvals: db.prepare("SELECT * FROM used_preview_approvals").all(),
    address_book: db.prepare("SELECT * FROM address_book").all(),
    known_intermediaries: db.prepare("SELECT * FROM known_intermediaries").all(),
    known_creators: db.prepare("SELECT * FROM known_creators").all(),
    saved_analyses: db.prepare("SELECT * FROM saved_analyses").all(),
    bulk_recipients: db.prepare("SELECT * FROM bulk_recipients").all(),
    proceeds_presets: db.prepare("SELECT * FROM proceeds_presets").all(),
    saved_searches: db.prepare("SELECT * FROM saved_searches").all(),
    bulk_run_history: db.prepare("SELECT * FROM bulk_run_history").all(),
    asset_groups: db.prepare("SELECT * FROM asset_groups").all(),
    asset_group_members: db.prepare("SELECT * FROM asset_group_members").all(),
    wallet_folders: db.prepare("SELECT * FROM wallet_folders").all(),
    wallets: db.prepare("SELECT * FROM wallets").all(),
    app_state: db.prepare("SELECT * FROM app_state").all(),
    auto_send_groups: db.prepare("SELECT * FROM auto_send_groups").all(),
    auto_send_destinations: db.prepare("SELECT * FROM auto_send_destinations").all(),
    auto_send_run_log: db.prepare("SELECT * FROM auto_send_run_log").all(),
    persons: db.prepare("SELECT * FROM persons").all(),
    person_addresses: db.prepare("SELECT * FROM person_addresses").all(),
    person_relationships: db.prepare("SELECT * FROM person_relationships").all(),
    creator_children: db.prepare("SELECT * FROM creator_children").all(),
    bulk_scan_state: db.prepare("SELECT * FROM bulk_scan_state").all(),
    tiered_reward_configs: db.prepare("SELECT * FROM tiered_reward_configs").all(),
    tiered_reward_tiers: db.prepare("SELECT * FROM tiered_reward_tiers").all(),
    tiered_reward_assets: db.prepare("SELECT * FROM tiered_reward_assets").all(),
    tiered_reward_run_log: db.prepare("SELECT * FROM tiered_reward_run_log").all(),
    tracer_watchlist: db.prepare("SELECT * FROM tracer_watchlist").all(),
    tracer_watch_events: db.prepare("SELECT * FROM tracer_watch_events").all(),
    key_scan_state: db.prepare("SELECT * FROM key_scan_state").all(),
    key_scan_hits: db.prepare("SELECT * FROM key_scan_hits").all(),
  });
}
