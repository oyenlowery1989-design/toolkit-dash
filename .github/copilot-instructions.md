# Copilot Instructions

`CLAUDE.md` in the repo root is the canonical rule file. Read it before making any changes. If this file conflicts with `CLAUDE.md`, `CLAUDE.md` wins.

## Critical rules (most commonly violated)

- **Never touch a working signed-off module** while fixing another. Each module is independent.
- **Never force-uppercase Stellar asset codes** — `wUSDC` ≠ `WUSDC`. Preserve case from input and storage.
- **Always use `/accounts/{address}/payments`** — never `/payments?account={address}`. The `?account=` form includes ops where the address is not the actor.
- **All persistent data goes in SQLite/Supabase** via the DB hook pattern. Never `localStorage` for new features.
- **Never use raw `<input>`, `<button>`, `<select>`** — always use `@/components/ui` equivalents; use `<Switch>` for any boolean toggle (no `Checkbox` exists yet).
- **Display addresses as `GABC…WXYZ`** via the `ShortAddress` component — never wrap it in a `<button>`/`<Button>` (it renders its own internal button; use `<div role="button" tabIndex={0}>` if the row itself needs to be clickable).
- **Standard page shell**: `AppLayout` already adds padding/max-width — never add another `max-w-*` wrapper in a page file.
- **Before writing new UI or a new utility function, check `CLAUDE.md`'s "Reusable Components & Utilities" section first** — most address display, CSV export, save-to-group, XLM/USD pricing, and stats-card needs already have a shared implementation.

## Workflow

1. Read `CLAUDE.md` at task start.
2. Implement only the requested scope — no unrequested refactoring or cleanup.
3. Run `npx tsc --noEmit` after changes to verify TypeScript is clean.
4. Re-read changed files to check for regressions before reporting done.

## DB hook pattern

All data hooks use `createDbCache<T>()` from `lib/db-client.ts`. API routes live at `/api/db/{table}`. New persistent data always gets a new table in `lib/db.ts` and a matching API route — never localStorage.

## Key files

| File | Purpose |
|---|---|
| `lib/navigation.ts` | Sidebar menu — add new routes here |
| `lib/format.ts` | `formatXlm()`, `shortAddr()`, `parseAddresses()` |
| `lib/settings.ts` | Global settings hook + Horizon URL resolution |
| `lib/db-client.ts` | `createDbCache<T>()`, `dbPost`, `dbPatch`, `dbDelete` |
| `lib/asset-groups/types.ts` | `GroupMemberRole`, `ROLE_LABELS`, `ROLE_COLORS` |
| `lib/stellar-submit.ts` | `withAccountLock()` — per-key tx submission-order lock |
| `lib/csv-export.ts` | `downloadCSV()` — quoted/escaped CSV export, never hand-roll this |
| `components/shared/ShortAddress.tsx` | `<ShortAddress address network />` — import from `@/components/shared/ShortAddress` (moved out of `asset-lookup` — that copy no longer exists) |
| `components/shared/proceeds/` | `ProceedsDestinationsTable`, `ProceedsStatsCards`, `SaveToGroupButton`, `ProceedsStatusBadge` — shared destination-table/stats-card UI |
