# ShortAddress Actions Menu

## Problem

`ShortAddress` (`components/shared/ShortAddress.tsx`) is the shared component for
rendering any Stellar address across the app — 37 call sites. Today it exposes,
inline, next to the truncated address:

- click-to-copy on the address text itself
- a hover-only external-link icon to Stellar.Expert
- a hover-only "+" quick-add-to-Address-Book icon (only when the address is
  fully unrecognised)

We want to add two more per-address actions everywhere this component is used:

1. **Investigate** — jump to `/address-investigator?address=...`
2. **Show XLM Balance** — lazily fetch and display the address's live XLM
   balance in place

Adding two more inline icons makes already-tight rows (see: Issuer/Distrib rows
in Asset Lookup, holder tables in Asset Manager) more cramped. Consolidate into
a dropdown instead.

## Design (revised — adaptive inline/overflow, per Fable review 2026-07-11)

Always-on `⋮` was rejected: it adds permanent visual noise to already-dense
rows and turns one-click actions into two-click. Instead, actions render as
inline icon-buttons next to the address whenever there's room, and collapse
to a single `⋮` overflow menu only when there isn't.

### Action list (single source of truth)

One `actions` array (id, icon, label, onSelect, `visible` gate) drives both
render paths — mapped once to inline icon-buttons, once to
`<DropdownMenuItem>`s, no duplicated logic:

1. **Copy address** — same `navigator.clipboard.writeText` as clicking the
   address text
2. **Open in Stellar.Expert** — external link, same URL construction as today
   (`https://stellar.expert/explorer/{network}/account/{address}`); hidden
   entirely when `network` isn't `"public"`/`"testnet"` (same gating as today)
3. **Add to Address Book** — same `handleQuickAdd` navigation to
   `/address-book?add=...`; only rendered when
   `resolved.source === "none" && !role` (same gating as today)
4. **Investigate** — `router.push(\`/address-investigator?address=${address}\`)`
5. **Show XLM Balance** — see below

Address text, dot, and badge are **never** part of the collapsible group —
always rendered inline, unchanged from today.

### Adaptive collapse behavior

- **All-or-nothing**: either all action icons render inline (no `⋮` at all),
  or none do and a single always-visible `⋮` (MoreVertical) opens a dropdown
  containing all applicable actions. No partial priority-nav partitioning —
  overkill for ~4 icons and avoids the hardest part of that pattern entirely.
- **Detection is wrap-based, not width-measured**: the address+badge cluster
  and the icon cluster sit in the same `flex-wrap` row. A `ResizeObserver` on
  the parent element (`useLayoutEffect`-set-up) checks whether the icon
  cluster's `offsetTop` exceeds the address cluster's `offsetTop` — if so, it
  wrapped to a second line, meaning there's not enough room; collapse to `⋮`.
- **Hysteresis to prevent flicker**: on collapse, record the pixel width that
  was needed (address cluster + icon cluster, measured just before
  collapsing). Only re-expand once the parent's `clientWidth` exceeds that
  recorded width plus a small slack margin.
- **SSR/hydration-safe default**: initial render state is **collapsed**
  (`⋮` only) — deterministic on server and client, no mismatch.
  `useLayoutEffect` expands to inline icons before first paint if space
  allows, so there's no visible flicker in the common case.
- Guard the ResizeObserver callback with a compare-before-`setState` (and
  wrap in `requestAnimationFrame`) to avoid resize-observer loop warnings/
  layout thrash in dense tables with many `ShortAddress` instances.

### Show XLM Balance behavior

- Result renders as a **small inline chip next to the badge**, not trapped
  inside the menu — so it survives the menu closing (click-away, Escape,
  scroll) and works identically whether triggered from an inline icon or a
  menu item.
- Chip states: hidden until triggered → spinner → `"12,345.67 XLM"` (2dp) or
  `"Error"` / `"Unfunded"` on failure/404.
- Fetch via the existing `fetchXlmBalance(horizonUrl, address, signal)` from
  `lib/horizon-balance.ts` — the same fetcher `ProceedsDestinationsTable`'s
  "Holds Now" column already uses. No new fetch logic. Abort in-flight fetch
  on unmount.
- `horizonUrl` resolved via `useSettings()` + `resolveHorizonUrl(settings)`
  (same pattern used throughout the codebase) — `ShortAddress` does not
  currently import `useSettings`, this is a new dependency for the component.
- Result is component-local state, not cached/shared across renders — a new
  fetch is triggered each time the action is invoked. No persistence.

### New shared UI primitive

`components/ui/dropdown-menu.tsx` does not exist yet. Add it via the standard
shadcn DropdownMenu (Radix `@radix-ui/react-dropdown-menu`), matching the
existing style of `components/ui/dialog.tsx` / `select.tsx`. This becomes
available to the whole `components/ui/` kit for future use, not just this
component.

### API surface

No new required props on `ShortAddressProps`. `address` and `network` already
exist on every call site today. This is a drop-in visual swap — zero call-site
code changes needed anywhere.

### Blast radius & mitigation

37 files import `ShortAddress`, including tabs marked "DO NOT TOUCH" in
`CLAUDE.md` (Intermediary Tracer's `TraceAccountTab`, `KnownIntermediariesManager`,
`KnownCreatorsManager`). That rule is about not editing a module's *own* files
while working on another — it doesn't freeze shared components other modules
depend on — but a visual restructuring of an already-signed-off shared piece
still carries regression risk in those screens.

**Mitigation**: after implementing, browser-check for layout regressions in:
- The three DO-NOT-TOUCH Intermediary Tracer tabs
- Asset Manager's Holders tab (dense table, many rows)
- `ProceedsDestinationsTable` (already has its own balance column — confirm no
  visual collision/duplication with the new per-row menu's balance item)

No code changes expected in those files; this is a read-only visual check.

## Out of scope

- No new actions beyond Investigate + Show Balance (confirmed with user —
  "Send payment" / "View recent activity" explicitly deferred)
- No caching/sharing of fetched balances across multiple `ShortAddress`
  instances of the same address on one page
- No changes to `resolveAddress` / badge priority logic
