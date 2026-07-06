/**
 * Shared SQLite helpers for Tiered Rewards.
 * Centralises the row → TieredRewardConfig mapping used by
 * the CRUD route, the run route, and the scheduler.
 */

import type { TieredRewardConfig, Tier, RewardAsset } from "./types";

type Row = Record<string, unknown>;

function parseExcludeAddresses(raw: unknown): string[] {
  try { return JSON.parse(raw as string ?? "[]"); } catch { return []; }
}

function mapAssets(rows: Row[]): RewardAsset[] {
  return rows.map((a) => ({
    id: a.id as string,
    tierId: a.tier_id as string,
    assetCode: a.asset_code as string,
    assetIssuer: (a.asset_issuer as string | null) ?? undefined,
    amount: a.amount as number,
  }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapTiers(db: any, tierRows: Row[]): Tier[] {
  return tierRows.map((t) => {
    const assets = db.prepare("SELECT * FROM tiered_reward_assets WHERE tier_id = ?").all(t.id) as Row[];
    return {
      id: t.id as string,
      configId: t.config_id as string,
      tierNumber: t.tier_number as number,
      minTokens: t.min_tokens as number,
      maxTokens: (t.max_tokens as number | null) ?? undefined,
      position: t.position as number,
      assets: mapAssets(assets),
    };
  });
}

function rowToConfig(c: Row, tiers: Tier[], includeSecret = false): TieredRewardConfig {
  return {
    id: c.id as string,
    name: c.name as string,
    assetCode: c.asset_code as string,
    assetIssuer: c.asset_issuer as string,
    network: (c.network as string) ?? "public",
    secretKey: includeSecret ? ((c.secret_key as string) || null) : null,
    hasKey: !!((c.secret_key as string) || ""),
    intervalMinutes: (c.interval_minutes as number | null) ?? null,
    enabled: Number(c.enabled) === 1,
    minReserve: (c.min_reserve as number) ?? 10.0,
    minSenderThreshold: (c.min_sender_threshold as number) ?? 0,
    previewOnly: Number(c.preview_only) === 1,
    batchSend: Number(c.batch_send ?? 1) === 1,
    memo: (c.memo as string | null) ?? null,
    feeMultiplier: (c.fee_multiplier as number) ?? 1.0,
    excludeAddresses: parseExcludeAddresses(c.exclude_addresses),
    lastRunAt: (c.last_run_at as number | null) ?? undefined,
    lastFailureAt: (c.last_failure_at as number | null) ?? undefined,
    createdAt: c.created_at as number,
    tiers,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/** Load all configs ordered by created_at DESC. */
export function loadAllConfigs(db: Db): TieredRewardConfig[] {
  const configs = db.prepare("SELECT * FROM tiered_reward_configs ORDER BY created_at DESC").all() as Row[];
  return configs.map((c) => {
    const tierRows = db.prepare("SELECT * FROM tiered_reward_tiers WHERE config_id = ? ORDER BY position ASC").all(c.id) as Row[];
    return rowToConfig(c, mapTiers(db, tierRows));
  });
}

/** Load all enabled configs with an interval (for the scheduler). Includes the secret key — server-only caller. */
export function loadEnabledConfigs(db: Db): TieredRewardConfig[] {
  const configs = db
    .prepare("SELECT * FROM tiered_reward_configs WHERE enabled = 1 AND interval_minutes IS NOT NULL ORDER BY created_at ASC")
    .all() as Row[];
  return configs.map((c) => {
    const tierRows = db.prepare("SELECT * FROM tiered_reward_tiers WHERE config_id = ? ORDER BY position ASC").all(c.id) as Row[];
    return rowToConfig(c, mapTiers(db, tierRows), true);
  });
}

/** Load a single config by id. Includes the secret key — server-only caller (run route). Returns null if not found. */
export function loadConfig(db: Db, configId: string): TieredRewardConfig | null {
  const c = db.prepare("SELECT * FROM tiered_reward_configs WHERE id = ?").get(configId) as Row | undefined;
  if (!c) return null;
  const tierRows = db.prepare("SELECT * FROM tiered_reward_tiers WHERE config_id = ? ORDER BY position ASC").all(configId) as Row[];
  return rowToConfig(c, mapTiers(db, tierRows), true);
}
