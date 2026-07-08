# Persons Module — Design

## Goal
Standalone "Important Persons" registry (e.g. CEO, founder) that can be attributed to Asset Groups and linked directly to Stellar addresses, laying the groundwork for a later "group by person" / "group by Telegram channel" clustering view (not built in this pass).

## Scope
- New standalone module: `persons` + `person_addresses` tables, own page (`/persons`), own hook, own panel.
- `asset_groups` gets a single nullable `person_id` FK — **replaces** the `personName`/`personRole` free-text fields added earlier this session (same session, no real user data on them yet).
- One attributed person per asset group (not multiple). A person's role is fixed on the person record (not per-group) — if the same human holds different titles across different projects, that's out of scope for this pass; model them as separate person records if it comes up.
- No clustering/grouping-by-person-or-channel view yet. No wiring Person into the global `ShortAddress` badge-resolution chain (`lib/address-resolver.ts`) — real future enhancement, not built now.

## Schema

### SQLite (`lib/db.ts`)
```sql
CREATE TABLE IF NOT EXISTS persons (
  id          TEXT    PRIMARY KEY,
  name        TEXT    NOT NULL,
  role        TEXT,
  notes       TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS person_addresses (
  id         TEXT    PRIMARY KEY,
  person_id  TEXT    NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  address    TEXT    NOT NULL,
  label      TEXT,
  added_at   INTEGER NOT NULL,
  UNIQUE(person_id, address)
);

CREATE INDEX IF NOT EXISTS idx_person_addresses_person ON person_addresses(person_id);
CREATE INDEX IF NOT EXISTS idx_person_addresses_address ON person_addresses(address);
```

`asset_groups`: add `person_id TEXT REFERENCES persons(id) ON DELETE SET NULL`; drop `person_name`, `person_role` (migration: `ALTER TABLE ... DROP COLUMN` guarded by a `pragma table_info` existence check, same guard style already used for every other column migration in this file — better-sqlite3's bundled SQLite is new enough to support `DROP COLUMN`).

### Supabase (`supabase-schema.sql`)
Same two new tables (with `user_id` column, following the file's existing multi-user convention), plus:
```sql
ALTER TABLE asset_groups DROP COLUMN IF EXISTS person_name;
ALTER TABLE asset_groups DROP COLUMN IF EXISTS person_role;
ALTER TABLE asset_groups ADD COLUMN IF NOT EXISTS person_id TEXT REFERENCES persons(id) ON DELETE SET NULL;
```
(appended as an explicit migration block, same pattern as the existing `auto_send_groups` block already in this file — the base `CREATE TABLE` line for `asset_groups` also gets updated to the final desired shape for fresh installs.)

## The COALESCE-vs-NULL wrinkle
Every other `asset_groups` PATCH field uses `COALESCE(?, column)`, relying on the JS convention "send the field to change it, omit it to leave it alone" — with the empty string standing in for "clear text back to blank". That doesn't work for `person_id`: an empty string isn't a valid FK reference, and passing SQL `NULL` through `COALESCE` is indistinguishable from "not touching this column" (COALESCE skips NULL arguments). Unlinking a person needs an actual `SET person_id = NULL`, distinct from "leave whatever it was."

Fix: the hook calls `updateGroup(id, { personId: null })` to unlink (explicit `null`, not omitted). The route destructures `personId` and checks `personId !== undefined` (true for both a real id and explicit `null`) to decide whether to touch the column at all, then binds two params instead of COALESCE's one:
```sql
person_id = CASE WHEN ? = 1 THEN NULL ELSE COALESCE(?, person_id) END
```
— a `clearPerson` flag (`1` when `personId === null`) and the COALESCE value (`personId ?? null`, which only matters when `clearPerson` is `0`). Supabase's branch has no such issue — `.update({ person_id: null })` sets NULL natively; only the SQLite COALESCE-style branch needs the CASE.

## Types
`lib/persons/types.ts`:
```ts
export interface PersonAddress {
  id: string;
  personId: string;
  address: string;
  label?: string;
  addedAt: number;
}

export interface Person {
  id: string;
  name: string;
  role?: string;
  notes?: string;
  addresses: PersonAddress[];
  createdAt: number;
  updatedAt: number;
}
```

`lib/asset-groups/types.ts`: remove `personName`/`personRole`; add `personId?: string`.

## API
`app/api/db/persons/route.ts` — GET (all persons with nested addresses), POST (`type: "person" | "address"`), PATCH, DELETE — same dual-mode (`isSupabaseOnly()`, `requireAuth`, `syncToSupabase`) shape as `app/api/db/groups/route.ts`, adapted for the person/address entities instead of group/member.

`app/api/db/groups/route.ts`: remove `personName`/`personRole` wiring from `rowToGroup`/insert/PATCH; add `person_id`/`personId` wiring, including the CASE-based clear logic above.

## Hook
`hooks/use-persons.ts` — same `createDbCache<Person>()` shape as `hooks/use-asset-groups.ts`: `createPerson`, `updatePerson`, `deletePerson`, `addPersonAddress`, `removePersonAddress`.

`hooks/use-asset-groups.ts`: `updateGroup`'s patchable field set drops `personName`/`personRole`, adds `personId?: string | null`.

## UI

### `/persons` page
Standard shell (`app/(data)/persons/page.tsx`) + `components/persons/PersonsPanel.tsx` (single file — no tabs needed, simpler than the tabbed-module threshold). Add-person form (Name, Role, Notes). List of persons, each showing: name, role, notes, its addresses (`ShortAddress` per row, inline add via address+label input, remove button), and a read-only "Attributed to N asset groups" list — computed client-side via `useAssetGroups().groups.filter(g => g.personId === person.id)`, rendered as links to `/groups?open={id}` (existing deep-link param). Delete person: confirm dialog (cascades addresses via FK, unlinks any asset groups via `ON DELETE SET NULL` — no orphaned references either way).

Nav: add a `Persons` entry (lucide `Users` icon) to the My Data section in `lib/navigation.ts`.

### Asset Group card
Replace the `personName`/`personRole` free-text editor added earlier this session:
- **Linked** (`group.personId` set): look up the person via `usePersons()`, render `"{name} — {role}"` (falling back to whichever half is set) as a link to `/persons?open={personId}`, plus an unlink (X) button calling `updateGroup(group.id, { personId: null })`.
- **Unlinked**: a "+ Attribute Person" button opens a `Dialog` with a `Select` of existing persons (label `"{name} — {role}"`) plus a "+ New Person" inline quick-create (name + role inputs) — mirrors the existing `ChainDisplay` "+ Group" dialog pattern (inline create without leaving the page). Confirming either path calls `updateGroup(group.id, { personId })`.

## Testing
No new pure-logic module this pass (CRUD only, no derivation logic comparable to `lib/asset-groups/links.ts`) — manual browser verification against the real local DB, same protocol as the prior two asset-groups rounds (temporary `DB_PROVIDER=""` override, `sb-logged-in` cookie, clean up test data afterward).

## Non-goals
No grouping/clustering-by-person-or-Telegram view. No per-group multiple persons (one only). No per-group role override (role lives on the person). No Person integration into `ShortAddress`'s badge-resolution priority chain.
