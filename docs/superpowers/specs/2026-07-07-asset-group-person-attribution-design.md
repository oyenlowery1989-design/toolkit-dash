# Asset Group Person Attribution + Telegram Visibility — Design

## Goal
Attribute a person (e.g. CEO/founder) to every Asset Group, and make the Telegram channel name visible as text in the header (not just an icon whose channel name only appears in a hover tooltip).

## Scope
Group-level only, same tier as `domain`/`telegramChannel`/`telegramLink` added previously. No clustering/grouping-by-person-or-channel view in this pass — deferred to a later phase per this project's step-by-step rule.

## Schema
Add 2 nullable `TEXT` columns to `asset_groups`: `person_name`, `person_role`. Both independent/optional (a group may set either alone).

- `lib/db.ts`: `CREATE TABLE` gets the 2 columns; migration block mirrors the `domain`/`telegram_channel`/`telegram_link` migration added previously.
- `supabase-schema.sql`: same 2 columns added to the `asset_groups` table definition (same edit, per project convention).

## Types
`lib/asset-groups/types.ts` — `AssetGroup` gains `personName?: string; personRole?: string;`.

## API (`app/api/db/groups/route.ts`)
Thread the 2 fields through GET mapping, POST insert, PATCH — identical pattern to `domain`/`telegramChannel`/`telegramLink`.

## Hook (`hooks/use-asset-groups.ts`)
`updateGroup`'s `Pick<AssetGroup, ...>` extended to include `personName` and `personRole`.

## UI (`GroupsPanel.tsx`)
- **One combined inline editor** below the Telegram Link row, labeled "Attributed Person" — two `Input`s (Name, Role) edited together with a single Save button, mirroring the existing member-edit pattern (multiple fields committed as one `updateGroup` call) rather than the one-field-per-row Notes pattern, since name+role are a single conceptual unit. Enter in either input saves both; Escape cancels both.
- **Display when collapsed** (not editing): renders `"{name} — {role}"` if both set, or whichever one is set alone, or the placeholder "Add attributed person…" if neither is set.
- **Header**: Telegram link changes from icon-only to icon + visible channel-name text (e.g. `✈ @channelname`), same href/derivation logic (`resolveTelegramUrl`) as now. Domain/website header link is unchanged (icon-only) — not requested. No header change for person (person is investigative metadata, not a "link out" like domain/Telegram; only shown in the expanded card per the design questions — not asked to add to the collapsed header).

## Non-goals
No clustering/grouping-by-CEO-or-channel view. No validation on person name/role (free text, like `notes`). No new shared component — same one-off pattern as the prior social-links rows.
