## Auto-Send Groups
- Route: `app/(tools)/auto-send-groups/page.tsx`
- Panel: `components/auto-send-groups/AutoSendGroupsPanel.tsx` (~1500+ lines, all UI in one file)
- Lib: `lib/auto-send/types.ts`, `runner.ts`, `scheduler.ts`
- Hook: `hooks/use-auto-send-groups.ts` — DB-backed cache; exposes `isLoaded` for loading gate
- API routes:
  - `/api/db/auto-send-groups` — CRUD for groups + destinations
  - `/api/auto-send/run` — manual run, dry-run (preview), test run, refresh-scheduler
  - `/api/auto-send/history` — last 200 run log entries; `?totals=1` returns per-destination lifetime aggregates
  - `/api/auto-send/balance` — live XLM balance for a group's wallet via Horizon
  - `/api/auto-send/stats` — panel-level aggregate stats
  - `/api/auto-send/scheduler-status` — returns `{ serverless: boolean }` to warn when on Vercel

### Persistence — Dual-Mode (Supabase + SQLite)
- **Deployed (Vercel)**: `isSupabaseOnly()` returns true → all routes use Supabase. Vercel serverless has ephemeral SQLite (read-only bundle), so Supabase is mandatory for persistence.
- **Local dev**: SQLite only (`stellar-toolkit.db`); Supabase not required.
- All 4 auto-send API routes handle both modes: `/api/db/auto-send-groups`, `/api/auto-send/run`, `/api/auto-send/history`, `/api/auto-send/stats`
- Supabase tables have `user_id` column for multi-user isolation; SQLite tables do not (single-user local tool)
- Destination upsert pattern: always SELECT existing id by `(group_id, destination)` first, then upsert with that id — avoids UNIQUE constraint collision when re-adding same address with new UUID
- `isSupabaseOnly()` is true when `DB_PROVIDER=supabase` OR `VERCEL` env is set + Supabase is configured

### DB Tables
- `auto_send_groups`: `id, name, network, secret_key, interval_minutes, enabled, batch_send, batch_memo, min_reserve, min_sender_threshold, preview_only, last_failure_at, created_at`
- `auto_send_destinations`: `id, group_id, destination, percentage, is_remainder, is_paused, label, memo, min_threshold, max_cap, position`
- `auto_send_run_log`: `id, group_id, wallet_address, destination, amount_sent, status, error, ran_at, tx_hash`
- Supabase versions of all 3 tables also have `user_id TEXT NOT NULL`

### Scheduler
- `lib/auto-send/scheduler.ts` — node-cron singleton; started from `instrumentation.ts` on server boot
- `global._autoSendStarted` + `global._autoSendTasks` — singleton guards; survive HMR
- `startScheduler()` called from `instrumentation.ts` (nodejs runtime only, skipped on Vercel)
- `refreshScheduler()` called after group create (if interval set), enable toggle, interval change, or delete
- `minutesToCronExpression(minutes)` — `*/N * * * *` for <60m, `0 */N * * *` for hours
- Intervals: 1m, 15m, 30m, 1h, 3h, 6h, 12h, 24h (Manual = no cron)
- **CRITICAL**: `createGroup` MUST call `refreshScheduler` if `intervalMinutes` is set — otherwise scheduler never picks up new groups
- **Safety**: `npm run dev` locally starts the REAL auto-send + tiered-rewards cron schedulers (not a mock, not gated by a test flag) — before running the dev server for testing, check the local DB for enabled groups with short intervals to avoid triggering real scheduled payments.

### Runner (`lib/auto-send/runner.ts`)
- `runGroup(group)` — executes the group; batch or separate mode
- `previewGroup(group)` — calculates amounts without sending; returns `GroupPreview`
- `calcAmounts(spendable, destinations)` — two-pass: fixed-% first (excluding paused), then remainder gets leftover + any surplus from maxCap clamps
- `skipReason(spendable, amount, minThreshold, paused)` — returns skip reason string or undefined
- `extractError(err)` — extracts real Horizon result_codes from SDK 400 errors
- `FEE_BUDGET = 1.0` XLM — deducted from spendable in BOTH `runGroup` AND `previewGroup` (must stay in sync)
- `DEFAULT_MIN_RESERVE = 10.0` XLM — kept in wallet, not spent
- Separate mode stops on first failure (`aborted` flag) — remaining destinations logged as `"Aborted — earlier payment failed"`
- `previewOnly` groups: scheduler calls `previewGroup` instead of `runGroup`, logs with status `"preview"`

### Key Design Decisions
- **Fee budget flat 1 XLM** (not actual fee × N) — conservative safety buffer; simplifies calculation
- **Stop on first failure in separate mode** — prevents imbalanced distributions that would repeat every run
- **Max cap surplus redistributed to remainder** — if fixed-% dest is capped below calc'd amount, surplus goes to REST destination
- **previewGroup and runGroup MUST use identical spendable formula** — any change to one must be mirrored in the other
- **Run result persists across card collapse/expand** — stored in module-level `Map<string, GroupRunResult>`, not component state
- **`createGroup` always disabled by default on duplicate** — copy starts with `enabled: false`
- **Stranded XLM warning** shown when: `destCount > 0 && !hasRemainder && !overBudget && totalPct < 100`
- **Loading gate**: panel renders spinner until `isLoaded` (from `_cache.isLoaded()`) is true

### Status Badges (collapsed header)
- Green `✓ sent` — last run had `sentCount > 0`
- Red `✗ failed` — last run had `failedCount > 0`
- Yellow `~ skipped` — all skipped, nothing sent or failed
- `lastFailureAt` (group field, `number | null`) — set by scheduler on failure, cleared on full success or manual dismiss; shows red banner in expanded card. Dismiss must send `null`, not `undefined` — `JSON.stringify` silently drops `undefined`-valued keys so the server never received the clear before this was fixed.

### reviewed+fixed 2026-07-13
- **Scheduler is now dual-mode**: `lib/auto-send/scheduler.ts` previously called `getDb()` (SQLite) unconditionally with no `isSupabaseOnly()` check anywhere — in self-hosted "DB_PROVIDER=supabase, no VERCEL" mode, groups actually living in Supabase were invisible to the cron scheduler and silently never ran (only the `VERCEL`-only serverless warning banner existed, which stays hidden in this exact scenario). `loadEnabledGroups()` is now async + dual-mode (mirrors `lib/tiered-rewards/scheduler.ts`'s already-correct read pattern), `scheduleAll()` is async (called fire-and-forget from `startScheduler`/`refreshScheduler`, signatures unchanged), and the cron tick's `last_failure_at` write-back goes through a new dual-mode `setGroupLastFailure()`. The row→`AutoSendGroup` mapper is extracted to `lib/auto-send/db-map.ts` (`rowToGroup`) and shared by the scheduler and `/api/auto-send/run`, so there's one mapper, not two drifting copies.
  - **Known gap, not yet fixed**: the scheduler's `previewOnly` run-log insert is still an unconditional SQLite write (same as `runner.ts`'s pre-existing `logResult` calls) — on Supabase-only/Vercel deployments this silently no-ops, so scheduler-triggered runs currently produce no `auto_send_run_log` rows beyond the `last_failure_at` update. The manual-run API route works around this with its own `writeRunLog` wrapper; the scheduler has no equivalent yet.
- `handleDuplicate` now sequences properly: `createGroup` is called with `enabled: false` baked into the initial insert (no separate follow-up PATCH racing the insert), and all `upsertDestination` calls are awaited via `Promise.all` — previously all three writes fired unawaited, so a duplicated group could end up enabled (if the disable-PATCH lost the race against the group's own insert) or missing destinations (Supabase's destination-POST 403s if the parent group row doesn't exist yet).
- `lib/auto-send/runner.ts`'s `extractError()` is now a thin wrapper around `getErrorMessage()` from `lib/stellar-helpers.ts` instead of a hand-rolled duplicate — `tests/lib/auto-send/runner.test.ts`'s 19 assertions (including the `extractError` describe-block) still pass unchanged.
