/**
 * GET /api/db/export
 * Returns a full JSON dump of all local SQLite tables.
 * Use this to migrate data to Supabase or create a manual backup.
 */
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly, requireAuth } from "@/lib/supabase-server";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  if (isSupabaseOnly()) {
    // Export from Supabase — scoped to user
    const sb = getSupabase()!;
    const uid = userId!;
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
    ] = await Promise.all([
      sb.from("address_book").select("*").eq("user_id", uid),
      sb.from("known_intermediaries").select("*").eq("user_id", uid),
      sb.from("known_creators").select("*").eq("user_id", uid),
      sb.from("saved_analyses").select("*").eq("user_id", uid),
      sb.from("bulk_recipients").select("*").eq("user_id", uid),
      sb.from("proceeds_presets").select("*").eq("user_id", uid),
      sb.from("saved_searches").select("*").eq("user_id", uid),
      sb.from("bulk_run_history").select("*").eq("user_id", uid),
      sb.from("asset_groups").select("*").eq("user_id", uid),
      sb.from("wallet_folders").select("*").eq("user_id", uid),
      sb.from("wallets").select("*").eq("user_id", uid),
      sb.from("app_state").select("*").eq("user_id", uid),
      sb.from("auto_send_groups").select("*").eq("user_id", uid),
    ]);
    // Fetch members for user's asset groups only
    const groupIds = (assetGroups ?? []).map((g: Record<string, unknown>) => g.id as string);
    const { data: assetGroupMembers } = groupIds.length > 0
      ? await sb.from("asset_group_members").select("*").in("group_id", groupIds)
      : { data: [] };
    // Fetch auto-send child rows scoped through parent group ownership
    const autoSendGroupIds = (autoSendGroups ?? []).map((g: Record<string, unknown>) => g.id as string);
    const [{ data: autoSendDestinations }, { data: autoSendRunLog }] = await Promise.all([
      autoSendGroupIds.length > 0
        ? sb.from("auto_send_destinations").select("*").in("group_id", autoSendGroupIds)
        : Promise.resolve({ data: [] }),
      autoSendGroupIds.length > 0
        ? sb.from("auto_send_run_log").select("*").in("group_id", autoSendGroupIds)
        : Promise.resolve({ data: [] }),
    ]);

    return NextResponse.json({
      exportedAt: Date.now(),
      source: "supabase",
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
    });
  }

  // Export from SQLite
  const db = getDb();
  return NextResponse.json({
    exportedAt: Date.now(),
    source: "sqlite",
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
  });
}
