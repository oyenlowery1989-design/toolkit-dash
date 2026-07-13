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
- `lastFailureAt` (group field) — set by scheduler on failure, cleared on full success; shows red banner in expanded card
