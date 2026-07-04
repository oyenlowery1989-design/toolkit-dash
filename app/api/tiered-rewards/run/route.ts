import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly, requireAuth } from "@/lib/supabase-server";
import { refreshTieredRewardsScheduler } from "@/lib/tiered-rewards/scheduler";
import { loadConfig } from "@/lib/tiered-rewards/db";
import type { TieredRewardConfig, Tier, RewardAsset } from "@/lib/tiered-rewards/types";

type Row = Record<string, unknown>;

/** Load a single config from Supabase with its key intact (server-side only). */
async function loadConfigFromSupabase(configId: string, userId: string): Promise<TieredRewardConfig | null> {
  const sb = getSupabase()!;
  const { data: c } = await sb.from("tiered_reward_configs").select("*").eq("id", configId).eq("user_id", userId).single();
  if (!c) return null;
  const { data: tiers } = await sb.from("tiered_reward_tiers").select("*").eq("config_id", configId).order("position", { ascending: true });
  const mappedTiers: Tier[] = await Promise.all(
    (tiers ?? []).map(async (t: Row) => {
      const { data: assets } = await sb.from("tiered_reward_assets").select("*").eq("tier_id", t.id);
      return {
        id: t.id as string, configId: t.config_id as string, tierNumber: t.tier_number as number,
        minTokens: t.min_tokens as number, maxTokens: (t.max_tokens as number | null) ?? undefined,
        position: t.position as number,
        assets: (assets ?? []).map((a: Row): RewardAsset => ({
          id: a.id as string, tierId: a.tier_id as string, assetCode: a.asset_code as string,
          assetIssuer: (a.asset_issuer as string | null) ?? undefined, amount: a.amount as number,
        })),
      };
    })
  );
  return {
    id: c.id, name: c.name, assetCode: c.asset_code, assetIssuer: c.asset_issuer,
    network: c.network ?? "public", secretKey: (c.secret_key as string) || null,
    intervalMinutes: c.interval_minutes ?? null,
    enabled: c.enabled === true || c.enabled === 1,
    minReserve: c.min_reserve ?? 10.0, minSenderThreshold: c.min_sender_threshold ?? 0,
    previewOnly: c.preview_only === true || c.preview_only === 1,
    batchSend: c.batch_send !== false && c.batch_send !== 0,
    memo: c.memo ?? null, feeMultiplier: c.fee_multiplier ?? 1.0,
    excludeAddresses: Array.isArray(c.exclude_addresses)
      ? c.exclude_addresses
      : (() => { try { return JSON.parse(c.exclude_addresses ?? "[]"); } catch { return []; } })(),
    lastRunAt: c.last_run_at ?? undefined, lastFailureAt: c.last_failure_at ?? undefined,
    createdAt: c.created_at, tiers: mappedTiers,
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

  // Always load config from DB server-side so the secret key never travels via the client.
  let config: TieredRewardConfig | null = null;
  if (body.configId) {
    config = isSupabaseOnly() && auth.userId
      ? await loadConfigFromSupabase(body.configId, auth.userId)
      : loadConfig(getDb(), body.configId);
  }

  if (!config) {
    return NextResponse.json({ error: "Config not found" }, { status: 404 });
  }

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

    // Persist last_run_at after a successful run
    if (isSupabaseOnly()) {
      const sb = getSupabase();
      if (sb && auth.userId && config.id) {
        void sb.from("tiered_reward_configs")
          .update({ last_run_at: Date.now() })
          .eq("id", config.id)
          .eq("user_id", auth.userId);
      }
    } else {
      try {
        getDb().prepare("UPDATE tiered_reward_configs SET last_run_at = ? WHERE id = ?").run(Date.now(), config.id);
      } catch (e) {
        console.error("[tiered-rewards/run] last_run_at sqlite:", e);
      }
    }

    return NextResponse.json(result);
  }

  return NextResponse.json({ error: "Unknown mode" }, { status: 400 });
}
