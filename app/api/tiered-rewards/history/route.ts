import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly, requireAuth } from "@/lib/supabase-server";
import type { RunLogRow } from "@/lib/tiered-rewards/types";

type Row = Record<string, unknown>;

function mapRow(r: Row): RunLogRow {
  return {
    id: r.id as string,
    configId: (r.config_id as string | null) ?? undefined,
    tierNumber: r.tier_number as number,
    holderAddress: r.holder_address as string,
    assetCode: r.asset_code as string,
    assetIssuer: (r.asset_issuer as string | null) ?? undefined,
    amountSent: r.amount_sent as number,
    status: r.status as RunLogRow["status"],
    txHash: (r.tx_hash as string | null) ?? undefined,
    error: (r.error as string | null) ?? undefined,
    ranAt: r.ran_at as number,
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const configId = searchParams.get("configId");

  if (isSupabaseOnly()) {
    const sb = getSupabase()!;
    let query = sb
      .from("tiered_reward_run_log")
      .select("*")
      .eq("user_id", auth.userId!)
      .order("ran_at", { ascending: false })
      .limit(200);
    if (configId) query = query.eq("config_id", configId);
    const { data, error } = await query;
    if (error) return NextResponse.json([], { status: 200 });
    return NextResponse.json((data ?? []).map(mapRow));
  }

  const db = getDb();
  const rows = (configId
    ? db.prepare("SELECT * FROM tiered_reward_run_log WHERE config_id = ? ORDER BY ran_at DESC LIMIT 200").all(configId)
    : db.prepare("SELECT * FROM tiered_reward_run_log ORDER BY ran_at DESC LIMIT 200").all()) as Row[];

  return NextResponse.json(rows.map(mapRow));
}
