import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAuth } from "@/lib/supabase-server";
import { refreshTieredRewardsScheduler } from "@/lib/tiered-rewards/scheduler";
import type { TieredRewardConfig } from "@/lib/tiered-rewards/types";

type Row = Record<string, unknown>;

function loadConfig(db: ReturnType<typeof getDb>, configId: string): TieredRewardConfig | null {
  const c = db.prepare("SELECT * FROM tiered_reward_configs WHERE id = ?").get(configId) as Row | undefined;
  if (!c) return null;
  const tiers = db.prepare("SELECT * FROM tiered_reward_tiers WHERE config_id = ? ORDER BY position ASC").all(configId) as Row[];
  return {
    id: c.id as string,
    name: c.name as string,
    assetCode: c.asset_code as string,
    assetIssuer: c.asset_issuer as string,
    network: (c.network as string) ?? "public",
    secretKey: c.secret_key as string,
    intervalMinutes: (c.interval_minutes as number | null) ?? null,
    enabled: Number(c.enabled) === 1,
    minReserve: (c.min_reserve as number) ?? 10.0,
    minSenderThreshold: (c.min_sender_threshold as number) ?? 0,
    previewOnly: Number(c.preview_only) === 1,
    lastRunAt: (c.last_run_at as number | null) ?? undefined,
    lastFailureAt: (c.last_failure_at as number | null) ?? undefined,
    createdAt: c.created_at as number,
    tiers: tiers.map((t) => {
      const assets = db.prepare("SELECT * FROM tiered_reward_assets WHERE tier_id = ?").all(t.id) as Row[];
      return {
        id: t.id as string,
        configId: t.config_id as string,
        tierNumber: t.tier_number as number,
        minTokens: t.min_tokens as number,
        maxTokens: (t.max_tokens as number | null) ?? undefined,
        position: t.position as number,
        assets: assets.map((a) => ({
          id: a.id as string,
          tierId: a.tier_id as string,
          assetCode: a.asset_code as string,
          assetIssuer: (a.asset_issuer as string | null) ?? undefined,
          amount: a.amount as number,
        })),
      };
    }),
  };
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  const body = await req.json() as { mode: string; configId?: string; config?: TieredRewardConfig };

  if (body.mode === "refresh-scheduler") {
    refreshTieredRewardsScheduler();
    return NextResponse.json({ ok: true });
  }

  const db = getDb();
  const config = body.configId
    ? loadConfig(db, body.configId)
    : body.config ?? null;

  if (!config) return NextResponse.json({ error: "Config not found" }, { status: 404 });

  const { calculatePreview } = await import("@/lib/tiered-rewards/calculator");

  if (body.mode === "preview") {
    const preview = await calculatePreview(config);
    return NextResponse.json(preview);
  }

  if (body.mode === "run") {
    const preview = await calculatePreview(config);
    if ("error" in preview) return NextResponse.json(preview, { status: 400 });
    if (preview.blocked) return NextResponse.json({ error: preview.blockReasons.join("; ") }, { status: 400 });

    const { runConfig } = await import("@/lib/tiered-rewards/runner");
    const result = await runConfig(config, preview.assignments);
    return NextResponse.json(result);
  }

  return NextResponse.json({ error: "Unknown mode" }, { status: 400 });
}
