import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isSupabaseOnly, requireAuth } from "@/lib/supabase-server";
import { refreshTieredRewardsScheduler } from "@/lib/tiered-rewards/scheduler";

type Row = Record<string, unknown>;

function sqliteGet(db: ReturnType<typeof getDb>) {
  const configs = db.prepare("SELECT * FROM tiered_reward_configs ORDER BY created_at DESC").all() as Row[];
  return configs.map((c) => {
    const tiers = db.prepare("SELECT * FROM tiered_reward_tiers WHERE config_id = ? ORDER BY position ASC").all(c.id) as Row[];
    return {
      id: c.id, name: c.name, assetCode: c.asset_code, assetIssuer: c.asset_issuer,
      network: c.network, secretKey: c.secret_key, intervalMinutes: c.interval_minutes ?? null,
      enabled: Number(c.enabled) === 1, minReserve: c.min_reserve, minSenderThreshold: c.min_sender_threshold,
      previewOnly: Number(c.preview_only) === 1, lastRunAt: (c.last_run_at as number | null) ?? undefined,
      lastFailureAt: (c.last_failure_at as number | null) ?? undefined, createdAt: c.created_at,
      tiers: tiers.map((t) => {
        const assets = db.prepare("SELECT * FROM tiered_reward_assets WHERE tier_id = ?").all(t.id) as Row[];
        return {
          id: t.id, configId: t.config_id, tierNumber: t.tier_number,
          minTokens: t.min_tokens, maxTokens: (t.max_tokens as number | null) ?? undefined, position: t.position,
          assets: assets.map((a) => ({
            id: a.id, tierId: a.tier_id, assetCode: a.asset_code,
            assetIssuer: (a.asset_issuer as string | null) ?? undefined, amount: a.amount,
          })),
        };
      }),
    };
  });
}

function validateNoOverlap(tiers: Array<{ minTokens: number; maxTokens?: number | null }>): string | null {
  for (let i = 0; i < tiers.length; i++) {
    for (let j = i + 1; j < tiers.length; j++) {
      const a = tiers[i], b = tiers[j];
      const aMax = a.maxTokens ?? Infinity;
      const bMax = b.maxTokens ?? Infinity;
      if (a.minTokens < bMax && aMax > b.minTokens) {
        return `Tier ranges overlap between tier ${i + 1} and tier ${j + 1}`;
      }
    }
  }
  return null;
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  if (isSupabaseOnly()) {
    // TODO: Supabase implementation
    return NextResponse.json([]);
  }

  const db = getDb();
  return NextResponse.json(sqliteGet(db));
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  try {
    let body: Row;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

    const { type, action, data } = body as { type: string; action: string; data: Row };

    if (isSupabaseOnly()) {
      // TODO: Supabase implementation
      return NextResponse.json({ ok: true });
    }

    const db = getDb();

    if (type === "config") {
      if (action === "create") {
        db.prepare(
          `INSERT INTO tiered_reward_configs
           (id, name, asset_code, asset_issuer, network, secret_key, interval_minutes, enabled, min_reserve, min_sender_threshold, preview_only, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          data.id, data.name, data.assetCode, data.assetIssuer, data.network,
          data.secretKey, data.intervalMinutes ?? null, data.enabled ? 1 : 0,
          data.minReserve ?? 10.0, data.minSenderThreshold ?? 0, data.previewOnly ? 1 : 0,
          Date.now()
        );
        refreshTieredRewardsScheduler();
      } else if (action === "update") {
        db.prepare(
          `UPDATE tiered_reward_configs SET name=?, asset_code=?, asset_issuer=?, network=?, secret_key=?,
           interval_minutes=?, enabled=?, min_reserve=?, min_sender_threshold=?, preview_only=?,
           last_failure_at=? WHERE id=?`
        ).run(
          data.name, data.assetCode, data.assetIssuer, data.network, data.secretKey,
          data.intervalMinutes ?? null, data.enabled ? 1 : 0,
          data.minReserve ?? 10.0, data.minSenderThreshold ?? 0, data.previewOnly ? 1 : 0,
          data.lastFailureAt ?? null, data.id
        );
        refreshTieredRewardsScheduler();
      } else if (action === "delete") {
        db.prepare("DELETE FROM tiered_reward_configs WHERE id = ?").run(data.id);
        refreshTieredRewardsScheduler();
      }
    } else if (type === "tier") {
      if (action === "create") {
        const existing = db.prepare("SELECT min_tokens, max_tokens FROM tiered_reward_tiers WHERE config_id = ?").all(data.configId) as Array<{ min_tokens: number; max_tokens: number | null }>;
        const allTiers = [
          ...existing.map((t) => ({ minTokens: t.min_tokens, maxTokens: t.max_tokens })),
          { minTokens: data.minTokens as number, maxTokens: (data.maxTokens as number | null) ?? null },
        ];
        const overlapErr = validateNoOverlap(allTiers);
        if (overlapErr) return NextResponse.json({ error: overlapErr }, { status: 400 });

        db.prepare(
          `INSERT INTO tiered_reward_tiers (id, config_id, tier_number, min_tokens, max_tokens, position) VALUES (?, ?, ?, ?, ?, ?)`
        ).run(data.id, data.configId, data.tierNumber, data.minTokens, data.maxTokens ?? null, data.position);
      } else if (action === "update") {
        db.prepare(
          `UPDATE tiered_reward_tiers SET tier_number=?, min_tokens=?, max_tokens=?, position=? WHERE id=?`
        ).run(data.tierNumber, data.minTokens, data.maxTokens ?? null, data.position, data.id);
      } else if (action === "delete") {
        db.prepare("DELETE FROM tiered_reward_tiers WHERE id = ?").run(data.id);
      }
    } else if (type === "asset") {
      if (action === "create") {
        db.prepare(
          `INSERT INTO tiered_reward_assets (id, tier_id, asset_code, asset_issuer, amount) VALUES (?, ?, ?, ?, ?)`
        ).run(data.id, data.tierId, data.assetCode, data.assetIssuer ?? null, data.amount);
      } else if (action === "update") {
        db.prepare(
          `UPDATE tiered_reward_assets SET asset_code=?, asset_issuer=?, amount=? WHERE id=?`
        ).run(data.assetCode, data.assetIssuer ?? null, data.amount, data.id);
      } else if (action === "delete") {
        db.prepare("DELETE FROM tiered_reward_assets WHERE id = ?").run(data.id);
      }
    } else {
      return NextResponse.json({ error: "unknown type — expected 'config', 'tier', or 'asset'" }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[tiered-rewards] POST unhandled:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
