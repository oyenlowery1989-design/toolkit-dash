/**
 * GET /api/db/status
 * Returns DB configuration state — safe to expose, no secrets.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isSupabaseConfigured, isSupabaseOnly, resolveLocalSyncUserId } from "@/lib/supabase-server";

export async function GET() {
  const supabaseOnly = isSupabaseOnly();
  const supabaseConfigured = isSupabaseConfigured();
  const localBackupEnabled = !supabaseOnly && supabaseConfigured && !!resolveLocalSyncUserId();
  const backupFailed = localBackupEnabled && !!getDb().prepare("SELECT 1 FROM local_backup_failure WHERE user_id = ?")
    .get(resolveLocalSyncUserId());
  return NextResponse.json({
    supabaseConfigured,
    supabaseOnly,
    localBackupEnabled,
    backupFailed,
    provider: supabaseOnly ? "supabase" : "sqlite",
  });
}
