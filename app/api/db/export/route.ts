import { readBackupRunGuards, LOCAL_RUN_GUARDS_SQL } from "@/lib/backup-run-guards";
/**
 * GET /api/db/export
 * Returns a user-data backup. Some server-only signing safety state is excluded;
 * recover it from a database snapshot before enabling mainnet transactions.
 */
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly, requireAuth } from "@/lib/supabase-server";
import { readSavedAnalysisRows } from "@/lib/saved-analyses/server";
import { readAllChildRows, readAllUserRows } from "@/lib/supabase-read-all";
import { streamJson } from "@/lib/json-stream";

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
      "persons", "creator_children", "bulk_scan_state", "tiered_reward_configs", "bulk_payment_journal",
    ];
    const parentReads = await Promise.all([
      readAllUserRows(sb, "address_book", uid),
      readAllUserRows(sb, "known_intermediaries", uid),
      readAllUserRows(sb, "known_creators", uid),
      readSavedAnalysisRows(uid),
      readAllUserRows(sb, "bulk_recipients", uid),
      readAllUserRows(sb, "proceeds_presets", uid),
      readAllUserRows(sb, "saved_searches", uid),
      readAllUserRows(sb, "bulk_run_history", uid),
      readAllUserRows(sb, "asset_groups", uid),
      readAllUserRows(sb, "wallet_folders", uid),
      readAllUserRows(sb, "wallets", uid),
      readAllUserRows(sb, "app_state", uid),
      readAllUserRows(sb, "auto_send_groups", uid),
      readAllUserRows(sb, "persons", uid),
      readAllUserRows(sb, "creator_children", uid),
      readAllUserRows(sb, "bulk_scan_state", uid),
      readAllUserRows(sb, "tiered_reward_configs", uid),
      readAllUserRows(sb, "bulk_payment_journal", uid),
    ]);
    const [
      addressBook, knownIntermediaries, knownCreators, savedAnalyses, bulkRecipients,
      proceedsPresets, savedSearches, bulkRunHistory, assetGroups, walletFolders,
      wallets, appState, autoSendGroups, persons, creatorChildren, bulkScanState,
      tieredRewardConfigs, bulkPaymentJournal,
    ] = unwrapReads(parentReads as SupabaseRead[], parentTables);
    // Fetch members for user's asset groups only
    const groupIds = (assetGroups ?? []).map((g: Record<string, unknown>) => g.id as string);
    const assetGroupMembersRead = groupIds.length > 0
      ? await readAllChildRows(sb, "asset_group_members", "group_id", groupIds)
      : { data: [], error: null };
    const [assetGroupMembers] = unwrapReads([assetGroupMembersRead as SupabaseRead], ["asset_group_members"]);
    // Fetch auto-send child rows scoped through parent group ownership
    const autoSendGroupIds = (autoSendGroups ?? []).map((g: Record<string, unknown>) => g.id as string);
    const autoSendReads = await Promise.all([
      autoSendGroupIds.length > 0
        ? readAllChildRows(sb, "auto_send_destinations", "group_id", autoSendGroupIds)
        : Promise.resolve({ data: [], error: null }),
      autoSendGroupIds.length > 0
        ? readAllChildRows(sb, "auto_send_run_log", "group_id", autoSendGroupIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const [autoSendDestinations, autoSendRunLog] = unwrapReads(
      autoSendReads as SupabaseRead[], ["auto_send_destinations", "auto_send_run_log"],
    );
    const personIds = (persons ?? []).map((person: Record<string, unknown>) => person.id as string);
    const personReads = await Promise.all([
      personIds.length > 0
        ? readAllChildRows(sb, "person_addresses", "person_id", personIds)
        : Promise.resolve({ data: [], error: null }),
      personIds.length > 0
        ? readAllChildRows(sb, "person_relationships", "person_a_id", personIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const [personAddresses, personRelationships] = unwrapReads(
      personReads as SupabaseRead[], ["person_addresses", "person_relationships"],
    );
    const tieredConfigIds = (tieredRewardConfigs ?? []).map((config: Record<string, unknown>) => config.id as string);
    const tieredReads = await Promise.all([
      tieredConfigIds.length > 0
        ? readAllChildRows(sb, "tiered_reward_tiers", "config_id", tieredConfigIds)
        : Promise.resolve({ data: [], error: null }),
      tieredConfigIds.length > 0
        ? readAllChildRows(sb, "tiered_reward_run_log", "config_id", tieredConfigIds)
        : Promise.resolve({ data: [], error: null }),
      readBackupRunGuards(sb, uid, tieredConfigIds),
    ]);
    const [tieredRewardTiers, tieredRewardRunLog, tieredRewardRunLeases] = unwrapReads(
      tieredReads as SupabaseRead[], ["tiered_reward_tiers", "tiered_reward_run_log", "tiered_reward_run_leases"],
    );
    const tierIds = (tieredRewardTiers ?? []).map((tier: Record<string, unknown>) => tier.id as string);
    const tieredRewardAssetsRead = tierIds.length > 0
      ? await readAllChildRows(sb, "tiered_reward_assets", "tier_id", tierIds)
      : { data: [], error: null };
    const [tieredRewardAssets] = unwrapReads(
      [tieredRewardAssetsRead as SupabaseRead], ["tiered_reward_assets"],
    );

    return streamJson({
      exportedAt: Date.now(),
      source: "supabase",
      signingSafetyStateExcluded: true,
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
      tiered_reward_run_leases: tieredRewardRunLeases ?? [],
      bulk_payment_journal: bulkPaymentJournal ?? [],
    });
    } catch (error) {
      console.error("[db/export] Supabase backup read failed:", error);
      return NextResponse.json({ error: "Backup source read failed" }, { status: 502 });
    }
  }

  // Export from SQLite
  const db = getDb();
  return streamJson({
    exportedAt: Date.now(),
    source: "sqlite",
    signingSafetyStateExcluded: true,
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
    bulk_payment_journal: db.prepare("SELECT * FROM bulk_payment_journal").all(),
    tiered_reward_configs: db.prepare("SELECT * FROM tiered_reward_configs").all(),
    tiered_reward_tiers: db.prepare("SELECT * FROM tiered_reward_tiers").all(),
    tiered_reward_assets: db.prepare("SELECT * FROM tiered_reward_assets").all(),
    tiered_reward_run_log: db.prepare("SELECT * FROM tiered_reward_run_log").all(),
    tiered_reward_run_leases: db.prepare(LOCAL_RUN_GUARDS_SQL).all(),
    tracer_watchlist: db.prepare("SELECT * FROM tracer_watchlist").all(),
    tracer_watch_events: db.prepare("SELECT * FROM tracer_watch_events").all(),
    key_scan_state: db.prepare("SELECT * FROM key_scan_state").all(),
    key_scan_hits: db.prepare("SELECT * FROM key_scan_hits").all(),
  });
}
