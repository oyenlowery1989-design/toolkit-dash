# Telegram Channel Clustering View — Design

## Goal
Phase 2 of the Persons module: surface asset groups that share a Telegram channel, regardless of attributed person, as an investigative signal (same channel, possibly-undisclosed same operator). Person-based clustering needs no new UI — each Person card's existing "Attributed to N asset group(s)" list already is that view.

## Scope
One new component rendered on `/persons`, read-only aggregation over existing data (`useAssetGroups()` + `usePersons()`). No new tables, no new API routes, no new fields.

## Component
`components/persons/TelegramChannelClusters.tsx` — mirrors `CrossAssetDestinations` (`components/saved-analyses/SavedAnalysesPanel.tsx:767`) exactly: collapsed-by-default `Card`, toggle button, table, "shared"-style badge for the anomaly case.

**Aggregation**: group all `useAssetGroups().groups` by `group.telegramChannel` normalized (`.trim().toLowerCase().replace(/^[@/]+/, "")`), skipping groups with no channel set. For each channel: the list of groups, and the set of distinct non-null `personId`s among them (via `usePersons()` to resolve id → name for display).

**Row shape**: channel name, group count, group name links (`/groups?open={id}`), person name(s) attributed across those groups. **"Mixed persons" badge** (same yellow/shared visual treatment as `CrossAssetDestinations`) when a channel's groups carry more than one distinct attributed person — that mismatch is the actual signal.

**Display rules**: channels with zero groups are never shown (nothing to aggregate — there's no "channel registry" independent of groups). A channel with exactly one group still shows as a baseline row (no badge) — matches `CrossAssetDestinations`' behavior of listing every destination, not just shared ones. Sort by group count desc, then distinct-person count desc.

**Placement**: rendered in `PersonsPanel.tsx`, below the person cards grid.

## Non-goals
No clustering on domain/website. No clustering restricted to same-Person groups (explicitly cross-cuts Person). No new nav entry, no new route — lives inside the existing `/persons` page.
