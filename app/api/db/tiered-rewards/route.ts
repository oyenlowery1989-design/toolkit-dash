import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly, requireAuth } from "@/lib/supabase-server";
import { refreshTieredRewardsScheduler } from "@/lib/tiered-rewards/scheduler";
import { loadAllConfigs } from "@/lib/tiered-rewards/db";
import type { TieredRewardConfig } from "@/lib/tiered-rewards/types";

type Row = Record<string, unknown>;

// ── Supabase GET ──────────────────────────────────────────────────────────────

async function supabaseGet(userId: string): Promise<TieredRewardConfig[]> {
  const sb = getSupabase()!;
  const { data: configs, error } = await sb
    .from("tiered_reward_configs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error || !configs) return [];

  const result: TieredRewardConfig[] = [];
  for (const c of configs) {
    const { data: tiers } = await sb
      .from("tiered_reward_tiers")
      .select("*")
      .eq("config_id", c.id)
      .order("position", { ascending: true });

    const mappedTiers = await Promise.all(
      (tiers ?? []).map(async (t: Row) => {
        const { data: assets } = await sb
          .from("tiered_reward_assets")
          .select("*")
          .eq("tier_id", t.id);
        return {
          id: t.id as string,
          configId: t.config_id as string,
          tierNumber: t.tier_number as number,
          minTokens: t.min_tokens as number,
          maxTokens: (t.max_tokens as number | null) ?? undefined,
          position: t.position as number,
          assets: (assets ?? []).map((a: Row) => ({
            id: a.id as string,
            tierId: a.tier_id as string,
            assetCode: a.asset_code as string,
            assetIssuer: (a.asset_issuer as string | null) ?? undefined,
            amount: a.amount as number,
          })),
        };
      })
    );

    result.push({
      id: c.id,
      name: c.name,
      assetCode: c.asset_code,
      assetIssuer: c.asset_issuer,
      network: c.network ?? "public",
      secretKey: null,
      hasKey: !!(c.secret_key || ""),
      intervalMinutes: c.interval_minutes ?? null,
      enabled: c.enabled === true || c.enabled === 1,
      minReserve: c.min_reserve ?? 10.0,
      minSenderThreshold: c.min_sender_threshold ?? 0,
      previewOnly: c.preview_only === true || c.preview_only === 1,
      batchSend: c.batch_send !== false && c.batch_send !== 0,
      memo: c.memo ?? null,
      feeMultiplier: c.fee_multiplier ?? 1.0,
      excludeAddresses: Array.isArray(c.exclude_addresses)
        ? c.exclude_addresses
        : (() => { try { return JSON.parse(c.exclude_addresses ?? "[]"); } catch { return []; } })(),
      lastRunAt: c.last_run_at ?? undefined,
      lastFailureAt: c.last_failure_at ?? undefined,
      createdAt: c.created_at,
      tiers: mappedTiers,
    });
  }
  return result;
}

// ── Validation ────────────────────────────────────────────────────────────────

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

// ── Routes ────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  if (isSupabaseOnly()) {
    return NextResponse.json(await supabaseGet(auth.userId!));
  }

  return NextResponse.json(loadAllConfigs(getDb()));
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  let body: Row;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const { type, action, data } = body as { type: string; action: string; data: Row };

  if (isSupabaseOnly()) {
    const sb = getSupabase()!;
    const userId = auth.userId!;

    try {
      if (type === "config") {
        if (action === "create") {
          await sb.from("tiered_reward_configs").insert({
            id: data.id, user_id: userId, name: data.name, asset_code: data.assetCode,
            asset_issuer: data.assetIssuer, network: data.network, secret_key: data.secretKey ?? "",
            interval_minutes: data.intervalMinutes ?? null, enabled: !!data.enabled,
            min_reserve: data.minReserve ?? 10.0, min_sender_threshold: data.minSenderThreshold ?? 0,
            preview_only: !!data.previewOnly, batch_send: data.batchSend !== false,
            memo: data.memo ?? null, fee_multiplier: data.feeMultiplier ?? 1.0,
            exclude_addresses: data.excludeAddresses ?? [], created_at: Date.now(),
          });
        } else if (action === "update") {
          // Build partial update — only touch fields present in the request
          const updates: Row = {};
          if (data.name !== undefined) updates.name = (data.name as string)?.trim() ?? null;
          if (data.assetCode !== undefined) updates.asset_code = data.assetCode;
          if (data.assetIssuer !== undefined) updates.asset_issuer = data.assetIssuer;
          if (data.network !== undefined) updates.network = data.network;
          // Only update key when caller supplies a non-empty value (empty/undefined = keep existing)
          if (data.secretKey !== undefined && data.secretKey !== "") updates.secret_key = data.secretKey;
          if (data.secretKey === null) updates.secret_key = ""; // explicit clear
          if (data.intervalMinutes !== undefined) updates.interval_minutes = data.intervalMinutes ?? null;
          if (data.enabled !== undefined) updates.enabled = !!data.enabled;
          if (data.minReserve !== undefined) updates.min_reserve = data.minReserve;
          if (data.minSenderThreshold !== undefined) updates.min_sender_threshold = data.minSenderThreshold ?? 0;
          if (data.previewOnly !== undefined) updates.preview_only = !!data.previewOnly;
          if (data.batchSend !== undefined) updates.batch_send = data.batchSend !== false;
          if (data.memo !== undefined) updates.memo = data.memo ?? null;
          if (data.feeMultiplier !== undefined) updates.fee_multiplier = data.feeMultiplier;
          if (data.excludeAddresses !== undefined) updates.exclude_addresses = data.excludeAddresses ?? [];
          if (data.lastFailureAt !== undefined) updates.last_failure_at = data.lastFailureAt ?? null;
          if (Object.keys(updates).length > 0) {
            await sb.from("tiered_reward_configs").update(updates).eq("id", data.id).eq("user_id", userId);
          }
        } else if (action === "delete") {
          await sb.from("tiered_reward_configs").delete().eq("id", data.id).eq("user_id", userId);
        }
      } else if (type === "tier") {
        // Resolve config_id from either data.configId (create) or the tier itself (update/delete)
        let tierConfigId: string | null = null;
        if (action === "create") {
          tierConfigId = data.configId as string;
        } else {
          const { data: existingTier } = await sb.from("tiered_reward_tiers").select("config_id").eq("id", data.id).single();
          tierConfigId = (existingTier as { config_id: string } | null)?.config_id ?? null;
        }
        const { data: ownedConfig } = tierConfigId
          ? await sb.from("tiered_reward_configs").select("id").eq("id", tierConfigId).eq("user_id", userId).single()
          : { data: null };
        if (!ownedConfig) return NextResponse.json({ error: "Not found" }, { status: 404 });

        if (action === "create") {
          const { data: existingTiers } = await sb
            .from("tiered_reward_tiers")
            .select("min_tokens, max_tokens")
            .eq("config_id", data.configId);
          const allTiers = [
            ...(existingTiers ?? []).map((t: Row) => ({ minTokens: t.min_tokens as number, maxTokens: t.max_tokens as number | null })),
            { minTokens: data.minTokens as number, maxTokens: (data.maxTokens as number | null) ?? null },
          ];
          const overlapErr = validateNoOverlap(allTiers);
          if (overlapErr) return NextResponse.json({ error: overlapErr }, { status: 400 });

          await sb.from("tiered_reward_tiers").insert({
            id: data.id, config_id: data.configId, tier_number: data.tierNumber,
            min_tokens: data.minTokens, max_tokens: data.maxTokens ?? null, position: data.position,
          });
        } else if (action === "update") {
          const { data: otherTiers } = await sb
            .from("tiered_reward_tiers")
            .select("min_tokens, max_tokens")
            .eq("config_id", tierConfigId)
            .neq("id", data.id);
          const allTiers = [
            ...(otherTiers ?? []).map((t: Row) => ({ minTokens: t.min_tokens as number, maxTokens: t.max_tokens as number | null })),
            { minTokens: data.minTokens as number, maxTokens: (data.maxTokens as number | null) ?? null },
          ];
          const overlapErr = validateNoOverlap(allTiers);
          if (overlapErr) return NextResponse.json({ error: overlapErr }, { status: 400 });

          await sb.from("tiered_reward_tiers").update({
            tier_number: data.tierNumber, min_tokens: data.minTokens,
            max_tokens: data.maxTokens ?? null, position: data.position,
          }).eq("id", data.id);
        } else if (action === "delete") {
          await sb.from("tiered_reward_tiers").delete().eq("id", data.id);
        }
      } else if (type === "asset") {
        // Resolve tier_id from data.tierId (create) or the asset itself (update/delete)
        let assetTierId: string | null = null;
        if (action === "create") {
          assetTierId = data.tierId as string;
        } else {
          const { data: existingAsset } = await sb.from("tiered_reward_assets").select("tier_id").eq("id", data.id).single();
          assetTierId = (existingAsset as { tier_id: string } | null)?.tier_id ?? null;
        }
        let assetConfigId: string | null = null;
        if (assetTierId) {
          const { data: existingTier } = await sb.from("tiered_reward_tiers").select("config_id").eq("id", assetTierId).single();
          assetConfigId = (existingTier as { config_id: string } | null)?.config_id ?? null;
        }
        const { data: ownedConfig } = assetConfigId
          ? await sb.from("tiered_reward_configs").select("id").eq("id", assetConfigId).eq("user_id", userId).single()
          : { data: null };
        if (!ownedConfig) return NextResponse.json({ error: "Not found" }, { status: 404 });

        if (action === "create") {
          await sb.from("tiered_reward_assets").insert({
            id: data.id, tier_id: data.tierId, asset_code: data.assetCode,
            asset_issuer: data.assetIssuer ?? null, amount: data.amount,
          });
        } else if (action === "update") {
          await sb.from("tiered_reward_assets").update({
            asset_code: data.assetCode, asset_issuer: data.assetIssuer ?? null, amount: data.amount,
          }).eq("id", data.id);
        } else if (action === "delete") {
          await sb.from("tiered_reward_assets").delete().eq("id", data.id);
        }
      } else {
        return NextResponse.json({ error: "unknown type" }, { status: 400 });
      }
    } catch (e) {
      console.error("[tiered-rewards/supabase] POST unhandled:", e);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  // SQLite path
  try {
    const db = getDb();

    if (type === "config") {
      if (action === "create") {
        db.prepare(
          `INSERT INTO tiered_reward_configs
           (id, name, asset_code, asset_issuer, network, secret_key, interval_minutes, enabled, min_reserve, min_sender_threshold, preview_only, batch_send, memo, fee_multiplier, exclude_addresses, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          data.id, data.name, data.assetCode, data.assetIssuer, data.network,
          data.secretKey ?? "", data.intervalMinutes ?? null, data.enabled ? 1 : 0,
          data.minReserve ?? 10.0, data.minSenderThreshold ?? 0, data.previewOnly ? 1 : 0,
          data.batchSend !== false ? 1 : 0, data.memo ?? null, data.feeMultiplier ?? 1.0,
          JSON.stringify(data.excludeAddresses ?? []), Date.now()
        );
        refreshTieredRewardsScheduler();
      } else if (action === "update") {
        // Build partial update — only touch columns present in the request
        const fields: string[] = [];
        const vals: unknown[] = [];
        if (data.name !== undefined) { fields.push("name = ?"); vals.push((data.name as string)?.trim() ?? null); }
        if (data.assetCode !== undefined) { fields.push("asset_code = ?"); vals.push(data.assetCode); }
        if (data.assetIssuer !== undefined) { fields.push("asset_issuer = ?"); vals.push(data.assetIssuer); }
        if (data.network !== undefined) { fields.push("network = ?"); vals.push(data.network); }
        // Only update key when caller supplies a non-empty value (empty/undefined = keep existing)
        if (data.secretKey !== undefined && data.secretKey !== "") { fields.push("secret_key = ?"); vals.push(data.secretKey ?? ""); }
        if (data.secretKey === null) { fields.push("secret_key = ?"); vals.push(""); } // explicit clear
        if (data.intervalMinutes !== undefined) { fields.push("interval_minutes = ?"); vals.push(data.intervalMinutes ?? null); }
        if (data.enabled !== undefined) { fields.push("enabled = ?"); vals.push(data.enabled ? 1 : 0); }
        if (data.minReserve !== undefined) { fields.push("min_reserve = ?"); vals.push(data.minReserve); }
        if (data.minSenderThreshold !== undefined) { fields.push("min_sender_threshold = ?"); vals.push(data.minSenderThreshold ?? 0); }
        if (data.previewOnly !== undefined) { fields.push("preview_only = ?"); vals.push(data.previewOnly ? 1 : 0); }
        if (data.batchSend !== undefined) { fields.push("batch_send = ?"); vals.push(data.batchSend !== false ? 1 : 0); }
        if (data.memo !== undefined) { fields.push("memo = ?"); vals.push(data.memo ?? null); }
        if (data.feeMultiplier !== undefined) { fields.push("fee_multiplier = ?"); vals.push(data.feeMultiplier); }
        if (data.excludeAddresses !== undefined) { fields.push("exclude_addresses = ?"); vals.push(JSON.stringify(data.excludeAddresses ?? [])); }
        if (data.lastFailureAt !== undefined) { fields.push("last_failure_at = ?"); vals.push(data.lastFailureAt ?? null); }
        if (fields.length > 0) {
          vals.push(data.id);
          db.prepare(`UPDATE tiered_reward_configs SET ${fields.join(", ")} WHERE id = ?`).run(...vals);
        }
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
        const tierRow = db.prepare("SELECT config_id FROM tiered_reward_tiers WHERE id = ?").get(data.id) as { config_id: string } | undefined;
        if (tierRow) {
          const existing = db.prepare("SELECT min_tokens, max_tokens FROM tiered_reward_tiers WHERE config_id = ? AND id != ?").all(tierRow.config_id, data.id) as Array<{ min_tokens: number; max_tokens: number | null }>;
          const allTiers = [
            ...existing.map((t) => ({ minTokens: t.min_tokens, maxTokens: t.max_tokens })),
            { minTokens: data.minTokens as number, maxTokens: (data.maxTokens as number | null) ?? null },
          ];
          const overlapErr = validateNoOverlap(allTiers);
          if (overlapErr) return NextResponse.json({ error: overlapErr }, { status: 400 });
        }

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
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
