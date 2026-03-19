# Tiered Rewards Distribution — Design Spec

**Date:** 2026-03-19
**Status:** Approved
**Module:** `/tiered-rewards`

---

## Overview

A module for distributing token rewards to Stellar asset holders based on tier membership. Holders are automatically sorted into tiers by their token balance, and each tier receives a flat reward per holder (any number of assets: native XLM or any Stellar token). Supports saved scheduled configs (default 24h) and ad-hoc one-time Quick Runs.

---

## User Flow

1. Create a config — name it, pick the asset to scan, define tiers with reward assets, set sender wallet and schedule
2. Preview — scan holders, assign to tiers, show full breakdown (who gets what, total cost per asset, sender balance check) — must approve before sending
3. Execute — payments sent in batches from sender wallet
4. Monitor — card shows holder counts per tier, last run log, next scheduled run

---

## Data Model

### `tiered_reward_configs`
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| name | TEXT NOT NULL | Display name |
| asset_code | TEXT NOT NULL | Token to scan holders for |
| asset_issuer | TEXT NOT NULL | Issuer of tracked asset |
| network | TEXT NOT NULL | `testnet` / `public` / `futurenet` |
| secret_key | TEXT NOT NULL | Secret key of sending account |
| interval_minutes | INTEGER | NULL = manual only |
| enabled | INTEGER NOT NULL DEFAULT 0 | 0/1 boolean — new configs default disabled |
| min_reserve | REAL NOT NULL DEFAULT 10.0 | Minimum XLM to keep in sender wallet |
| min_sender_threshold | REAL NOT NULL DEFAULT 0.0 | Skip entire run if XLM balance below this |
| preview_only | INTEGER NOT NULL DEFAULT 0 | Scheduler runs preview instead of real payments |
| last_run_at | INTEGER | Unix ms timestamp, written after each successful run |
| last_failure_at | INTEGER | Unix ms timestamp, cleared on full success |
| created_at | INTEGER NOT NULL | Unix ms timestamp |

### `tiered_reward_tiers`
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| config_id | TEXT NOT NULL REFERENCES tiered_reward_configs(id) ON DELETE CASCADE | |
| tier_number | INTEGER NOT NULL | 1-based, display order |
| min_tokens | REAL NOT NULL | Inclusive lower bound |
| max_tokens | REAL | NULL = open-ended top tier |
| position | INTEGER NOT NULL | Sort order |

### `tiered_reward_assets`
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| tier_id | TEXT NOT NULL REFERENCES tiered_reward_tiers(id) ON DELETE CASCADE | |
| asset_code | TEXT NOT NULL | `XLM` for native |
| asset_issuer | TEXT | NULL for native XLM |
| amount | REAL NOT NULL | Amount per holder per run |

### `tiered_reward_run_log`
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| config_id | TEXT REFERENCES tiered_reward_configs(id) ON DELETE CASCADE | NULL for Quick Runs (no FK row exists) |
| tier_number | INTEGER NOT NULL | Which tier this row is for |
| holder_address | TEXT NOT NULL | Address of recipient |
| asset_code | TEXT NOT NULL | Reward asset for this row |
| asset_issuer | TEXT | NULL for native XLM |
| amount_sent | REAL NOT NULL DEFAULT 0 | Actual amount sent (0 if failed/skipped) |
| status | TEXT NOT NULL | `sent` / `failed` / `skipped` / `aborted` / `preview` |
| tx_hash | TEXT | TX hash if sent |
| error | TEXT | Error message if failed |
| ran_at | INTEGER NOT NULL | Unix ms timestamp |

> **Log model:** one row per holder per reward asset per run — no aggregate summary rows. Counts (holders_sent, holders_failed) computed at query time by GROUP + COUNT in the history API. `config_id` is nullable to accommodate Quick Runs which have no saved config row; the FK still enforces cascade deletes for saved configs.

---

## Architecture

### Files

```
app/(tools)/tiered-rewards/page.tsx
components/tiered-rewards/
  TieredRewardsPanel.tsx        main panel — config list + top bar
  TierConfigCard.tsx            expandable card per saved config
  TierBuilder.tsx               inline tier editor (add/edit/delete tiers + reward assets)
  TierPreviewModal.tsx          full preview breakdown modal before execution
lib/tiered-rewards/
  types.ts                      TieredRewardConfig, Tier, RewardAsset, RunLog types
  fetcher.ts                    fetch all holders via Horizon, assign each to a tier
  calculator.ts                 compute preview: per-tier holder list + total cost per asset
  runner.ts                     execute payments, batch 100 ops/tx, stop-on-failure per tier
  scheduler.ts                  cron singleton, mirrors auto-send scheduler pattern
hooks/
  use-tiered-reward-configs.ts  DB-backed cache via createDbCache<TieredRewardConfig>()
                                includes window focus reload for cross-tab sync
app/api/
  db/tiered-rewards/route.ts    CRUD for configs, tiers, reward assets (type discriminator in body)
  tiered-rewards/run/route.ts   POST: { mode: "preview" | "run" | "dry-run", configId }
  tiered-rewards/history/route.ts  GET: last 200 log rows per configId
```

### Navigation
Add to `lib/navigation.ts` under **Tools** section:
```ts
{ title: "Tiered Rewards", href: "/tiered-rewards", icon: Trophy }
```

### `instrumentation.ts` final state
```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./lib/auto-send/scheduler");
    const { startTieredRewardsScheduler } = await import("./lib/tiered-rewards/scheduler");
    startScheduler();
    startTieredRewardsScheduler();
  }
}
```

---

## Key Design Decisions

### Tier assignment
Each holder's balance is compared against tier ranges in order. A holder belongs to the first tier where `balance >= min_tokens && (max_tokens === null || balance < max_tokens)`. Holders below the lowest tier's `min_tokens` receive nothing.

**Exclusions (applied before tier assignment):**
- The issuer account itself (appears in Horizon results with negative balance) — excluded by address match
- Accounts with balance = 0 (trustline exists, no holdings) — excluded; they fall below any tier's min_tokens naturally

### Top tier is open-ended
The highest tier always has `max_tokens = NULL` (1,000+ = no upper bound).

### Tier overlap validation
The UI prevents saving a config where tier ranges overlap. Validation runs client-side on save: for any two tiers A and B, `A.max_tokens > B.min_tokens && A.min_tokens < B.max_tokens` = overlap error. The API also validates before write.

### Horizon holder pagination
`fetcher.ts` uses Horizon `/accounts?asset=CODE:ISSUER&limit=200` with cursor-based pagination via `next()`. If a page request fails after 3 exponential-backoff retries, the entire run aborts — partial holder data is not used (would produce unfair distributions).

### Payment batching
Within a tier, payment ops are batched 100 ops per transaction. Multiple reward assets for the same holder = multiple ops in the same batch (e.g., 10 XLM + 10 XRP = 2 ops for that holder). Formula: `ceil((holdersInTier × rewardAssetsCount) / 100)` transactions per tier.

**Sequence number management:** The runner calls `server.loadAccount(senderAddress)` before building each batch transaction to get a fresh sequence number. This is required because submitting multiple transactions from the same account sequentially will fail with `tx_bad_seq` if sequence is cached.

### Stop-on-failure per tier
If a batch transaction fails, remaining holders in that tier are logged as `aborted`. Other tiers still proceed.

### Per-holder trustline failures
If a holder lacks a trustline for a reward asset, that payment op fails at the operation level — logged as `failed` per holder per asset. Does not abort the batch.

### Sender balance preflight (preview step)
Preview calculates required balance per asset:
- **XLM native:** `(holdersPerTier × amountPerHolder)` summed across all tiers + `FEE_BUDGET` + `min_reserve`. Compare to sender's available XLM balance.
- **Non-XLM assets:** `server.loadAccount(senderAddress)` → find balance entry for `asset_code + asset_issuer`. Compare to required amount. **Also checks that sender has a trustline to each reward asset** — if trustline is absent, preview blocks execution with a clear "sender has no trustline for ASSET" message.

### Fee budget
`FEE_BUDGET = 1.0` XLM flat (same as auto-send), deducted from spendable XLM in both preview and run paths. Must stay in sync between `calculator.ts` and `runner.ts`.

### Sender wallet
Follows existing pattern: `effectiveSecretKey = activeWallet?.secretKey ?? manualSecretKey`. Active wallet indicator shown when connected, manual secret key field otherwise.

### Scheduler integration
`lib/tiered-rewards/scheduler.ts` exports:
- `startTieredRewardsScheduler()` — loads all enabled configs with their tiers + reward assets, registers cron tasks
- `refreshTieredRewardsScheduler()` — cancels all existing tasks and re-registers from DB (called after any config mutation)

Singleton guard: `global._tieredRewardsStarted`.

**Scheduler DB loading:** `loadEnabledConfigs()` — SELECT from `tiered_reward_configs WHERE enabled = 1`, then for each config JOIN `tiered_reward_tiers` → `tiered_reward_assets` to build the full in-memory config tree.

**`refreshTieredRewardsScheduler()` must be called after:**
- Config created (if `interval_minutes` is set)
- `enabled` toggled
- `interval_minutes` changed
- Config deleted

### API route body shape (type discriminator)
`POST /api/db/tiered-rewards` accepts:
```ts
{ type: "config",  action: "create" | "update" | "delete", data: TieredRewardConfig }
{ type: "tier",    action: "create" | "update" | "delete", data: Tier }
{ type: "asset",   action: "create" | "update" | "delete", data: RewardAsset }
```

### Run log cleanup
`/api/tiered-rewards/history` returns the last 200 log rows per config (ordered by `ran_at DESC LIMIT 200`). No automatic deletion — the cap is enforced at query time.

### Quick Run
- Lightweight modal: asset + tiers + sender — no name, no schedule, not saved to DB
- Same preview → execute flow
- Run is logged to `tiered_reward_run_log` with `config_id = NULL` (no saved config row exists); the nullable FK is safe for this case
- Results shown inline in the modal; do not survive page refresh

### Memo
Intentionally omitted in v1. All tiered rewards transactions are sent without a memo. Can be added per-tier in a future version.

### Schedule intervals
Manual, 1h, 3h, 6h, 12h, 24h (default). Sub-hour intervals (1m, 15m, 30m) excluded — sub-hour rewards distributions are not a use case for this module.

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| Sender XLM balance < required | Preview blocks execute, shows shortfall |
| Sender lacks trustline to reward asset | Preview blocks execute, shows which asset |
| Holder has no trustline for reward asset | Op fails, logged per-address, batch continues |
| Batch tx fails | Stop tier, log remaining as `aborted`, continue next tier |
| Horizon page fetch fails (3 retries) | Abort entire run, log error |
| Scheduler failure | Set `last_failure_at`, show red banner on card |
| No holders in a tier | Tier skipped silently, logged as 0 sent |
| Overlapping tier ranges | UI + API validation blocks save |
| Issuer account in holder results | Excluded before tier assignment |
| Zero-balance trustlines | Fall below min_tokens naturally, receive nothing |

---

## Supabase / Dual-Mode
All four tables have Supabase equivalents with `user_id TEXT NOT NULL` column. API routes follow `isSupabaseOnly()` pattern identical to auto-send groups routes.

---

## Out of Scope (v1)
- Proportional distribution within a tier (flat per-holder only)
- Per-address exclusion list
- Retroactive snapshot mode (always uses live holder data at run time)
- Email / webhook notifications on completion
- Memo per tier
- Sub-hour scheduling intervals
