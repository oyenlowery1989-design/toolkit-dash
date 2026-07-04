/**
 * GET /api/db/status
 * Returns DB configuration state — safe to expose, no secrets.
 */
import { NextResponse } from "next/server";
import { isSupabaseConfigured, isSupabaseOnly } from "@/lib/supabase-server";

export async function GET() {
  return NextResponse.json({
    supabaseConfigured: isSupabaseConfigured(),
    supabaseOnly: isSupabaseOnly(),
    provider: isSupabaseOnly() ? "supabase" : "sqlite",
  });
}
