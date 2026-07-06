# Tracer v2 — Design Spec

Date: 2026-07-06
Status: Approved design, pending implementation plan

## Purpose

New standalone module for operator-level analysis on top of data the toolkit already collects. Four capabilities: cross-group operator fingerprinting, bulk origin tracing, live intermediary watchlist, and a money-flow network graph.

**Hard constraint:** the existing `intermediary-tracer` module is signed off and must not be modified. Tracer v2 may **import** its exported functions (`traceAccountOrigin`, `findFunderCandidates`, types) but never edits any file under `components/intermediary-tracer/` or changes existing exports in `lib/intermediary-tracer/`.

## Architecture

One module, four tabs (mirrors the intermediary-tracer tab pattern):

- Route: `app/(analysis)/tracer-v2/page.tsx` — standard page shell (h1 + description + Suspense, no extra max-w/padding per project rules)
- Panel: `components/tracer-v2/TracerV2Panel.tsx` — Tabs shell, shared state (network from `useSettings()`, known-entity caches)
- Tabs: `FingerprintTab.tsx`, `BulkTraceTab.tsx`, `WatchlistTab.tsx`, `FlowGraphTab.tsx`
- Lib: `lib/tracer-v2/` — `fingerprint.ts`, `graph-builder.ts`, `watcher.ts`, `types.ts`
- Sidebar entry: "Tracer v2" under the analysis section

Build order (each phase browser-verified and user-signed-off before the next starts):

1. Fingerprint
2. Bulk Trace
3. Watchlist
4. Flow Graph

No UI controls are added for phases not yet implemented.

## Phase 1 — Fingerprint tab

Cross-group operator correlator. Pure DB read, zero Horizon calls.

**Inputs** (all from existing DB-cache hooks): asset groups + members, known intermediaries, known creators, creator children, saved analyses (`topDestinations`).

**Engine:** `lib/tracer-v2/fingerprint.ts` — pure function `computeFingerprints(datasets): OperatorMatch[]`. Unit-testable with fixtures.

Signals, scored per group-pair:

| # | Signal | Detail | Weight |
|---|--------|--------|--------|
| 1 | Shared address | Same address member of ≥2 groups. Role-weighted: intermediary/bank/withdrawal high, destination medium, other low | high |
| 2 | Shared top destination | Address appears in `topDestinations` of saved analyses for ≥2 different assets | medium-high |
| 3 | Shared home domain | Same non-empty home_domain across members of different groups | medium |
| 4 | Shared lineage | Members of different groups appear in the same known creator's children list | high |

Score per pair = weighted sum normalized to 0–100. Exact weights tuned at implementation time; engine keeps them as named constants in one place.

**Output:** ranked list of group pairs with evidence rows (signal type, the shared address/domain, roles on each side).

**UI:** table of pairs sorted by score desc, expandable evidence rows, `ShortAddress` everywhere, "Open Group →" links, min-score filter. Recompute button (cheap, pure in-memory).

## Phase 2 — Bulk Trace tab

Paste N addresses, trace all origins in one run.

- Input textarea parsed with `parseAddresses` from `lib/format.ts`; dedup; invalid lines reported
- Runs `traceAccountOrigin` (imported from `lib/intermediary-tracer/fetchers.ts`) per address
- Worker pool, 4 concurrent (same pattern as scan enrichment)
- Streams rows live (`onResult` accumulate pattern: `prev => [...prev, result]`, merge by `account` key); Stop keeps partial results
- Row: address, creator, creator-is-known-intermediary badge, top real-funder candidate + confidence, home domain, status (pending/done/error)
- Activity log panel with scroll-guard (`userScrolledUp` ref pattern); every fetched URL logged
- Per-row actions: "+ Group", Address Investigator link, Stellar.Expert link
- Export CSV
- Deep-link prefill: `?addresses=A,B,C` (hydration-safe, `useRef` prefill sentinel)
- Per-run abort via `useAbortableRun`; abort on unmount

## Phase 3 — Watchlist tab

Live monitor: poll watched addresses for new `create_account` operations. Read-only Horizon polling — no transaction submission, none of the auto-send money risk.

**DB tables** (added to `lib/db.ts`, API routes under `/api/db/`, DB-cache hook pattern — no localStorage):

- `tracer_watchlist`: `id, address, label, network, enabled, poll_cursor, last_checked_at, created_at`
- `tracer_watch_events`: `id, watch_id, event_type, account_created, funder, amount, tx_hash, ledger_time, seen (0/1), created_at`

**Poller** `lib/tracer-v2/watcher.ts`:

- node-cron singleton, same guards as auto-send scheduler (`global._tracerWatchStarted`), started from `instrumentation.ts`, skipped on Vercel/serverless
- Fixed 5-minute interval for all enabled watches
- Per watch: `GET /accounts/{addr}/operations?type=create_account&cursor={poll_cursor}&order=asc`, insert new events, advance `poll_cursor`
- First run per watch seeds the cursor at latest — no historical backfill flood
- Per-watch try/catch: one failing watch never kills the cron loop

**UI:**

- Add/remove/pause watches; picker to add directly from Known Intermediaries
- Events feed newest-first, unseen highlighted, "mark all seen"
- Sidebar badge with unseen-event count
- Per event: created account `ShortAddress`, funder, amount, time, "+ Group", "Trace" link deep-linking Bulk Trace

## Phase 4 — Flow Graph tab

Force-directed network graph of all known entities and flows. No new Horizon calls — renders what the DB already knows.

**Data assembly:** `lib/tracer-v2/graph-builder.ts` — pure function `buildGraph(datasets, filters): { nodes, edges }`. Unit-testable.

- **Nodes:** group members (colored by role), known intermediaries (yellow), known creators (green), creator children, saved-analysis top destinations. Dedup by address; a node can carry multiple badges.
- **Edges:** creator→child, intermediary→created account, distrib→top destination (weighted by XLM), group co-membership (dashed, off by default)

**Rendering:** own SVG rendering; layout via `d3-force` (layout math only — no full d3 DOM manipulation). Pan/zoom, node drag, click opens side card (address, badges, links to Investigator/Groups), hover highlights neighbors.

**Filters:** network, group, node type, min-edge-weight slider. **Focus mode:** pick an address, render only its N-hop neighborhood (default on when graph exceeds ~200 nodes).

**Cross-highlight:** group pairs flagged by the Phase 1 fingerprint engine get a red halo link — the visual payoff of Phase 1.

## Shared decisions

- Network always from global `useSettings()` — no module-local network selector
- All addresses rendered via `ShortAddress`; asset codes never force-uppercased
- Horizon calls follow project rules (`/accounts/{addr}/operations`, never `?account=`); every URL logged to the activity log
- Error handling: per-run `AbortController` via `useAbortableRun`; Horizon `result_codes` extracted for display
- New persistent data → SQLite tables + API routes (watchlist only; fingerprint and graph are computed on the fly)

## Testing

- `fingerprint.ts` and `graph-builder.ts`: unit tests with fixture datasets
- Bulk Trace + Watchlist: manufactured testnet fixture (C pays I, I creates A — same setup previously verified for Creator's Accounts)
- Each phase browser-verified end-to-end before user sign-off

## Out of scope (YAGNI)

- Watchlist payment-monitoring (creations only for now)
- Per-watch poll intervals
- Push/Telegram notifications (in-app badge only)
- Historical backfill on watch creation
- Graph export/screenshot
