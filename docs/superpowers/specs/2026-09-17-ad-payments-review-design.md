# Ad Payments Review Design

## Goal

Provide a fast, standalone Ad Payments review page beside Asset Sales without presenting incomplete history or unverified transfers as compliant payments.

## Scope

The existing global `adPaymentRecipient` and 25% XLM rule remain unchanged. Saved Analyses remains the source of snapshots, comparisons, notes, tags, and detailed evidence. This work adds no scheduler, notification system, allocation editor, or per-asset rule configuration.

## Data and classification

Saved-analysis summaries are produced on the server: one latest snapshot for each `(asset code, issuer, network)` group, with pagination/count metadata rather than the current global newest-snapshot cutoff.

An XLM settlement is compliant only when the selected recipient verifiably receives XLM. A path payment whose source is XLM but whose destination asset is different is exposed as observed spending and cannot satisfy the XLM rule. The summary records the evidence transaction IDs and a scan timestamp; unknown or incomplete source data stays `unknown`.

Evidence transaction IDs are deduplicated across asset summaries. If an ID appears on more than one asset, every affected item is marked `sharedEvidence`; aggregate paid/required/shortfall totals count that evidence only once. No allocation controls are added in v1.

## UI

Add `/ad-payments` and a sidebar entry directly next to Asset Sales. The page loads compact latest-summary results from a dedicated API. Its default queue contains unpaid, underpaid, unknown, stale, and shared-evidence items, sorted by shortfall; filters support status, network, and asset text. Rows expose required, verified received, observed non-settling spending, shortfall, evidence links, scan time, and a direct route to the existing saved-analysis or Asset Sales detail.

Saved Analyses keeps its Ad Payments tab, but uses the same server summaries and reports when history is truncated or cannot be fully evaluated.

## Failure handling

The summaries endpoint validates the configured recipient and returns structured errors. Empty history is a valid empty result. Failed summary fetches retain the prior page state and show a retry action. Saving, refreshing, and deleting a saved analysis must surface failure rather than silently reloading away an optimistic local change.

## Testing

Unit tests cover verified XLM receipts, non-XLM path-payment handling, shared evidence, and latest-per-asset selection. Route tests cover pagination and user scoping. Component tests cover the default review queue, filtering, and evidence warnings.
