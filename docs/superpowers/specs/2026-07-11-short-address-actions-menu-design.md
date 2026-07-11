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

## Design

### Component changes — `components/shared/ShortAddress.tsx`

- Address text: **unchanged**. Click still copies to clipboard; Copy/Check icon
  still swaps on hover.
- Badge (INTERMEDIARY / CREATOR / role / group) and colored dot: **unchanged**,
  stay inline next to the address text.
- **Removed**: the existing hover-only external-link icon and hover-only "+"
  quick-add icon.
- **Added**: one always-visible `⋮` (MoreVertical) icon-button trigger that
  opens a dropdown menu, in this order:
  1. **Copy address** — same `navigator.clipboard.writeText` as clicking the
     address text; closes menu on click (standard item behavior)
  2. **Open in Stellar.Expert** — external link, same URL construction as
     today (`https://stellar.expert/explorer/{network}/account/{address}`);
     hidden entirely when `network` isn't `"public"`/`"testnet"` (same gating
     as today's icon)
  3. **Add to Address Book** — same `handleQuickAdd` navigation to
     `/address-book?add=...`; only rendered when
     `resolved.source === "none" && !role` (same gating as today's icon)
  4. **Investigate** — `router.push(\`/address-investigator?address=${address}\`)`
  5. **Show XLM Balance** — see below

### Show XLM Balance behavior

- Clicking this item does **not** close the menu (Radix `onSelect` calls
  `e.preventDefault()`).
- The item's own label swaps in place: `"Show XLM Balance"` → spinner →
  `"12,345.67 XLM"` (2dp, via existing `formatXlm`-style formatting) or
  `"Error"` / `"Unfunded"` on failure/404.
- Fetch via the existing `fetchXlmBalance(horizonUrl, address, signal)` from
  `lib/horizon-balance.ts` — the same fetcher `ProceedsDestinationsTable`'s
  "Holds Now" column already uses. No new fetch logic.
- `horizonUrl` resolved via `useSettings()` + `resolveHorizonUrl(settings)`
  (same pattern used throughout the codebase) — `ShortAddress` does not
  currently import `useSettings`, this is a new dependency for the component.
- Result is component-local state, not cached/shared across renders — re-
  opening the menu re-fetches. No persistence.

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
