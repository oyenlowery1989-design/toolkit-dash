## Asset Groups — URL Params (groups page)
Full `autoCreate` URL param spec:
- `autoCreate=1` — trigger auto-create/add flow on mount (requires `isLoaded` guard + `useRef` prefill sentinel)
- `name` — group name; if assetCode present, group name becomes `${assetCode.toUpperCase()} Asset`
- `assetCode`, `issuer`, `network` — group metadata; used for duplicate detection (by assetCode+issuer+network OR name)
- `distrib` — added as `distributor` role member
- `issuerHomeDomain`, `distribHomeDomain` — separate home domains for issuer and distrib members
- `addAddress`, `addRole`, `addLabel`, `addHomeDomain` — add a single extra member to new OR existing group
- If group already exists (by assetCode+issuer+network): adds `addAddress` if not already a member, then navigates — **no duplicate group created**
- `open=GROUP_ID` — opens that group expanded on load (no autoCreate needed)

## Asset Groups
- Tables: `asset_groups`, `asset_group_members` (FK cascade on delete)
- 9 roles: `issuer`, `distributor`, `creator`, `intermediary`, `bank`, `withdrawal`, `destination`, `service`, `other`
- Types + role constants: `lib/asset-groups/types.ts` (`GroupMemberRole`, `ROLE_LABELS`, `ROLE_COLORS`)
- Hook: `hooks/use-asset-groups.ts` — uses DB cache pattern; delete uses custom fetch (not `dbDelete`) because body needs `type` discriminator
- **Social links** (group-level, optional, independent): `domain`, `telegramChannel`, `telegramLink` — editable inline in the expanded card (same click-to-edit pattern as Notes), surfaced as Globe icon + Telegram icon-with-channel-name-text next to the group name in the collapsed header. URL derivation (scheme prefixing, explicit link wins over derived `t.me/{channel}`) lives in `lib/asset-groups/links.ts` (`normalizeExternalUrl`, `resolveTelegramUrl`)
- **Attributed person** (group-level, optional): `personId` FK to the `persons` table (see `persons` module below) — replaces the earlier flat `personName`/`personRole` fields. "+ Attribute Person" opens a dialog to pick an existing Person or create one inline; unlink via `unlinkGroupPerson(groupId)`. One person per group.
- API: `/api/db/groups` — POST/PATCH/DELETE body must include `type: "group"` or `type: "member"`
- Page: `app/(data)/groups/page.tsx` is a standard Suspense shell; all logic lives in `components/groups/GroupsPanel.tsx` — handles `?autoCreate=1&name=...&assetCode=...&issuer=...&distrib=...&issuerHomeDomain=...&distribHomeDomain=...&network=...` to auto-create group on mount; `?open=ID` syncs on same-tab nav, bypasses search filter, scrolls card into view (once per id)
- "Save to Group" always opens in a **new tab** (`target="_blank"` or `window.open(..., "_blank")`) — never navigate away from source page
- **Context-aware group buttons** — always check `useAssetGroups()` before rendering:
  - If group already exists for that asset (by `assetCode+issuer+network`): show green **"Open Group →"** linking to `/groups?open={group.id}`
  - If not yet: show purple **"Save to Group"** with `autoCreate=1` URL params
  - If a destination address is already a member: show green **"✓ in group"**; otherwise show **"+ Bank"**
- "Save to Group" in Bulk Asset Sales: purple pill-style per row, switches to green "Open Group" if group exists
- "Save to Group" in Asset Sales (single): same pattern in toolbar next to Save Analysis
- **Top Destinations table** (both Bulk Asset Sales and Asset XLM Proceeds): Layers icon per row — green if already in group, purple "+ Bank" otherwise
- Auto-infer distrib: Asset Sales `handleRun` calls `inferDistribLite` automatically if `accountsText` is empty, populates the field and proceeds without extra click
- Home domain: pass **separate** `issuerHomeDomain` and `distribHomeDomain` params — never share one domain for both
- Cross-group correlation: shared intermediary/bank/withdrawal address across multiple groups = same operator fingerprint

## Fixed — autoCreate perceived slowness (2026-07-17)
`?autoCreate=1` save-to-group navigation felt slow ("loads all groups for minutes"): the 3 parallel `fetchHomeDomain()` calls in the autoCreate effect had no timeout, so an unresponsive Horizon account lookup could hang the whole create indefinitely. Fixed by capping `fetchHomeDomain` (`components/shared/ChainDisplay.tsx`) at 5s via `AbortSignal.any([signal, AbortSignal.timeout(5000)])` — degrades to `undefined` like any other failure, same as a 404. Still a full foreground page nav that loads GroupsPanel + all groups via `useAssetGroups()` before the effect starts — that part is inherent to the current architecture, not changed here.
