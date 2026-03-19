import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAuth } from "@/lib/supabase-server";

type Row = Record<string, unknown>;

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const configId = searchParams.get("configId");

  const db = getDb();

  const rows = configId
    ? db.prepare(
        `SELECT * FROM tiered_reward_run_log WHERE config_id = ? ORDER BY ran_at DESC LIMIT 200`
      ).all(configId) as Row[]
    : db.prepare(
        `SELECT * FROM tiered_reward_run_log ORDER BY ran_at DESC LIMIT 200`
      ).all() as Row[];

  const mapped = rows.map((r) => ({
    id: r.id,
    configId: r.config_id ?? undefined,
    tierNumber: r.tier_number,
    holderAddress: r.holder_address,
    assetCode: r.asset_code,
    assetIssuer: (r.asset_issuer as string | null) ?? undefined,
    amountSent: r.amount_sent,
    status: r.status,
    txHash: (r.tx_hash as string | null) ?? undefined,
    error: (r.error as string | null) ?? undefined,
    ranAt: r.ran_at,
  }));

  return NextResponse.json(mapped);
}
