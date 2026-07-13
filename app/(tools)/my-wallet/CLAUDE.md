## My Wallet Page
- Route: `app/(tools)/my-wallet/page.tsx` — all UI in one file, no separate components
- **`Section` component** (defined inline in the file): collapsible card wrapper with chevron toggle, badge, and optional `right` slot (for external links, etc.)
- **Always use `Section` for any new card-style panel** in this page — never use raw `<div className="rounded-xl border...">` with a manual header
- `defaultOpen` prop: `true` for primary data (XLM, assets), `false` for secondary (offers, txs, quick actions, signers)
- Claimable balances: can only be **claimed**, not deleted — recipients have no cancel action on Stellar protocol level
