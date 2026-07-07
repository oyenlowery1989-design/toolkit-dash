# Asset Group Social Links — Design

## Goal
Every Asset Group needs 3 optional group-level metadata fields: public website domain, Telegram channel name, Telegram channel link — for quick reference/research when investigating a project.

## Scope
Group-level only (`asset_groups` table), not per-member. Distinct from the existing per-member `home_domain` field (which is the Stellar `stellar.toml` domain on issuer/distrib accounts) — this new `domain` is the project's marketing/public website, purely informational, no TOML fetch or validation against it.

## Schema
Add 3 nullable `TEXT` columns to `asset_groups`: `domain`, `telegram_channel`, `telegram_link`. All independent and optional — a group may set any combination (name without link, link without name, etc). No format validation blocks save; free text like `notes`.

- `lib/db.ts`: `CREATE TABLE` gets the 3 columns; migration block (mirrors the existing `known_creators.parent_address` migration at ~line 484) adds them via `ALTER TABLE ... ADD COLUMN` guarded by `pragma table_info` column-presence check.
- `supabase-schema.sql`: same 3 columns added to the `asset_groups` table definition (same edit, per project convention).

## Types
`lib/asset-groups/types.ts` — `AssetGroup` gains `domain?: string; telegramChannel?: string; telegramLink?: string;`.

## API (`app/api/db/groups/route.ts`)
Thread the 3 fields through: GET row mapping, POST insert (`type: "group"`), PATCH (`COALESCE` pattern identical to `notes`).

## Hook (`hooks/use-asset-groups.ts`)
`createGroup` input type and `updateGroup`'s `Pick<AssetGroup, ...>` extended to include the 3 fields.

## UI (`components/groups/GroupsPanel.tsx`)
- **Expanded card**: 3 new inline-editable rows below "Investigation Notes", each a copy of the existing notes editor (own state var + editing-toggle + Enter/Escape handlers). Labels: "Website", "Telegram Channel", "Telegram Link".
- **Collapsed card header**: small icon links next to the group name, shown only when the corresponding field is non-empty — `Globe` icon → `domain` (auto-prefixed `https://` if no scheme present), `Send` icon (lucide has no literal Telegram glyph; paper-plane is the closest match and keeps to the project's no-emoji-icon rule) → `telegramLink` if set, else derived `https://t.me/{telegramChannel}` if only the channel name is given. Both `target="_blank" rel="noopener noreferrer"`.

## Non-goals
No validation/fetching against the domain or Telegram link (no TOML check, no channel existence check). No per-member equivalent. No new "Social Links" grouped mini-form — matches the existing one-row-per-field Notes pattern for consistency.
