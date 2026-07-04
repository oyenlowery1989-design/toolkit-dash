# Copilot Instructions

`CLAUDE.md` in the repo root is the canonical rule file. Read it before making any changes. If this file conflicts with `CLAUDE.md`, `CLAUDE.md` wins.

## Critical rules (most commonly violated)

- **Never touch a working signed-off module** while fixing another. Each module is independent.
- **Never force-uppercase Stellar asset codes** — `wUSDC` ≠ `WUSDC`. Preserve case from input and storage.
- **Always use `/accounts/{address}/payments`** — never `/payments?account={address}`. The `?account=` form includes ops where the address is not the actor.
- **All persistent data goes in SQLite/Supabase** via the DB hook pattern. Never `localStorage` for new features.
- **Never use raw `<input>`, `<button>`, `<select>`** — always use `@/components/ui` equivalents.
- **Display addresses as `GABC…WXYZ`** via the `ShortAddress` component.
- **Standard page shell**: `AppLayout` already adds padding/max-width — never add another `max-w-*` wrapper in a page file.

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
| `components/asset-lookup/index.ts` | Re-exports `ShortAddress` (import from here) |
