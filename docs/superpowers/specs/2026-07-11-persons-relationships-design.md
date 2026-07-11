# Persons: Telegram Fields, Address→Group Membership, Relationships

## Problem

The Persons module (`components/persons/PersonsPanel.tsx`, signed off) tracks
name/role/notes + linked addresses, attributable to Asset Groups via a single
`personId` FK. Three gaps:

1. No Telegram identity on the person record itself (only asset *groups* carry
   a `telegramChannel` field today).
2. A person's linked addresses may independently be members of asset groups
   they aren't "attributed" to (e.g. as a bank/distrib address in someone
   else's group) — there's no way to see that from the person's card.
3. No way to record that two persons are connected (friends, colleagues, or
   one invited the other), or to see the transitive clusters that emerge from
   those connections.

## Design

### A. Person Telegram fields

- `lib/persons/types.ts` — add `telegramUsername?: string` to `Person`.
  Manually entered, same UI pattern as the existing `role`/`notes` fields
  (edit mode on `PersonCard`).
- "Related Telegram channels" is **not** a stored field. Computed live on
  render: the union of `telegramChannel` (normalized — lowercase, strip
  leading `@`/`/`, same as `TelegramChannelClusters.normalizeChannel`) from:
  - groups attributed to this person via `personId`
  - groups where any of this person's linked addresses is a member (part B)
- Rendered as a read-only pill list on `PersonCard`, each pill linking out via
  `resolveTelegramUrl` (`lib/asset-groups/links.ts`).

### B. Per-address group membership

New pure helper, `lib/persons/address-groups.ts`:

```ts
export function groupsForAddress(address: string, groups: AssetGroup[]): AssetGroup[]
```

Returns every group where `address` appears in `members` under **any** role —
unlike `resolveAddress` (`lib/address-resolver.ts`), which only returns the
single highest-priority match for badge purposes. This is a new, separate
lookup, not a change to `resolveAddress`.

Rendered inline under each address row on `PersonCard`: small pills (group
name + role badge, `ROLE_COLORS` from `lib/asset-groups/types.ts`), each
linking to `/groups?open={id}`. Visually distinct from and additional to the
existing "Attributed to N asset group(s)" section (which stays as-is, driven
by `personId` only).

### C. Relationships

**Data model** — new table `person_relationships`:

| column | type |
|---|---|
| `id` | text/uuid PK |
| `person_a_id` | FK → persons |
| `person_b_id` | FK → persons |
| `type` | `"friend" \| "colleague" \| "invited_by"` |
| `created_at` | timestamp |

- `friend`/`colleague`: symmetric — order of `a`/`b` doesn't matter, queries
  check both directions.
- `invited_by`: directional — `person_a_id` = inviter, `person_b_id` =
  invitee. UI renders "invited by {a}" on b's card and "invited {b}" on a's
  card, using the same edge.
- Cascade: deleting a person removes every relationship row where they are
  `person_a_id` or `person_b_id` (mirrors `person_addresses` → `ON DELETE
  CASCADE`).
- Add to both `lib/db.ts` and `supabase-schema.sql` in the same edit (per
  project's own checklist rule — a table missing from one silently breaks
  Vercel deploys).
- API route `/api/db/person-relationships`, dual-mode (`isSupabaseOnly()`),
  same shape as every other table route.
- Hook: extend `hooks/use-persons.ts` if it stays simple, or split into
  `hooks/use-person-relationships.ts` if `use-persons.ts` gets unwieldy —
  decided during implementation planning, not a spec-level decision.

**UI** — "+ Add relationship" on `PersonCard`: pick target person (dropdown of
all other persons) + type (friend/colleague/invited by), mirrors the existing
"+ Add address" inline-form interaction (click to reveal inputs, Check to
save). Relationships rendered as pills on the card, same visual language as
the existing "Attributed to N asset group(s)" pills, each showing the other
person's name + relationship type, clickable to nothing (no per-person detail
page exists — stays a flat pill).

### D. Relationship Clusters section

New component `components/persons/RelationshipClusters.tsx`, sibling to
`TelegramChannelClusters.tsx`, same visual pattern (collapsed-by-default
`Card` + table, `useState` for expand toggle):

- Computes connected components via union-find over all `person_relationships`
  edges (undirected for clustering purposes — `invited_by` still counts as a
  connection even though direction is preserved for display elsewhere).
- Each cluster = one table row: member names (with relationship-type pills),
  edge count, sorted by cluster size descending.
- Clusters of size 1 (no relationships) are not shown — matches
  `TelegramChannelClusters`' pattern of only showing multi-item groupings.
- No new visualization engine. Explicitly not reusing Tracer v2's
  `graph-builder.ts`/`force-sim.ts` — list/table style only, per user
  decision to keep this section simple and consistent with the existing
  Telegram-clusters section.

## Out of scope

- No dedicated per-person detail/profile page — everything stays on the
  existing card-grid layout.
- No editing/removing a relationship's type after creation (delete + re-add
  if wrong — same minimal-surface approach as other v1 features in this
  module).
- No graph visualization (see part D).
- No changes to `resolveAddress`/`ShortAddress` badge logic — part B is an
  additive, separate lookup.
