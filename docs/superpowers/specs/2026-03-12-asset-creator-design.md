# Asset Creator Module — Design Spec

**Date:** 2026-03-12
**Status:** Draft

---

## Overview

A new tool module that guides users through creating a custom Stellar asset end-to-end — from account setup and funding through trustline creation, initial issuance, and auto-saving the result to Asset Groups.

The module lives at `app/(tools)/asset-creator/` and is implemented as a 4-step wizard using Radix Tabs, consistent with existing patterns (Intermediary Tracer).

---

## Goals

- Allow users to create a Stellar asset with issuer + distributor accounts in a single guided flow
- Support both testnet (friendbot funding) and mainnet (XLM transfer from funding wallet)
- Validate preconditions before any signing (preflight checklist)
- Generate a `stellar.toml` snippet the user can copy and host
- Auto-save the created asset to Asset Groups on success via direct DB write (no navigation)
- Be extensible: creation strategies are pluggable for future variants (multisig, pre-auth, etc.)

## Non-Goals

- Asset flags (authorization required, clawback, etc.) — deferred to future version
- Max supply lock — deferred to future version
- Hosted TOML file management — snippet only, user hosts it themselves
- Multi-asset batch creation

---

## Route & Navigation

- **Route:** `app/(tools)/asset-creator/page.tsx`
- **Nav group:** `(tools)` — new sidebar entry "Asset Creator"
- **Panel:** `components/asset-creator/AssetCreatorPanel.tsx`

---

## Wizard Steps

### Step 1 — Accounts

Fields:
- **Network** selector (mainnet / testnet) — drives funding strategy
- **Funding source**: active wallet shown as green pill if connected (`useActiveWallet`); manual secret key input if not. Used only to fund new accounts on mainnet (Tx A).
- **Issuer keypair**: public key + secret key inputs (show/hide toggle). "Generate new" creates a fresh keypair inline via `Keypair.random()`.
- **Distributor keypair**: same pattern as issuer.

Validation before advancing:
- Both public keys are valid Stellar Ed25519 addresses (`StrKey.isValidEd25519PublicKey`)
- Both secret keys valid and match the provided public keys
- Network is selected

### Step 2 — Asset Config

Fields:
- **Asset code** (1–12 alphanumeric chars, regex `^[A-Za-z0-9]{1,12}$`, case preserved — never force-uppercased per project rules)
- **Token name** (optional — shown in TOML snippet `name` field; displayed in UI but not used on-chain)
- **Initial supply** (number, default 1,000,000)
- **Memo** (optional — applied to the issuance transaction Tx D only; validated as `Buffer.byteLength(memo, 'utf8') <= 28` to handle multi-byte UTF-8 correctly)
- **Home domain** (optional — applied to issuer account via `set_options`; also used in TOML snippet)
- **TOML snippet preview** — live-generated `[[CURRENCIES]]` block, copy button. Uses the **full 56-character issuer public key** — never `shortAddr()`. The `code` field preserves exact user input case (never uppercased). `display_decimals` hardcoded to `7`; users edit after copying if needed.

Validation before advancing:
- Asset code matches `^[A-Za-z0-9]{1,12}$`
- Supply is a positive number
- Memo ≤ 28 bytes if provided
- Home domain is valid domain format if provided

### Step 3 — Preflight & Execute

Preflight checklist (all Horizon calls pass `onLog` for activity logging):
- ✓/✗ Issuer account exists — blocking if missing without funding wallet
- ✓/✗ Issuer account balance ≥ 1.5 XLM — blocking if fails without funding wallet
- ✓/✗ Distributor account exists — blocking if missing without funding wallet
- ✓/✗ Distributor account balance ≥ 1.5 XLM (needs base reserve 1 XLM + trustline subentry reserve 0.5 XLM) — blocking if fails without funding wallet
- ✓/✗ Asset code not already issued by this issuer — **non-blocking warning only**; user acknowledges via a "Proceed anyway" checkbox before the Execute button is enabled

Stellar reserve reference: base reserve unit = 0.5 XLM; minimum account balance = 1 XLM (2 × base reserve). Each subentry (e.g. trustline) locks an additional 0.5 XLM.

Fee estimation: calls `server.feeStats()`, reads `fee_charged.p50`, multiplies by 4 (max transactions in this flow), converts stroops to XLM, displays as "~X XLM in fees."

"Create missing accounts" toggle (visible when accounts are missing):
- **Testnet**: two separate GET requests to `https://friendbot.stellar.org?addr={address}`. HTTP 400 with `createAccountAlreadyExist` is treated as success.
- **Mainnet**: builds a **single transaction** (Tx A) with two `create_account` ops signed by the funding wallet to avoid sequence number conflicts. Funding amounts:
  - Issuer: **2.1 XLM** (base 1 XLM + fee buffer 1.1 XLM — generous to cover subsequent ops)
  - Distributor: **2.0 XLM** (base 1 XLM + trustline reserve 0.5 XLM + fee buffer 0.5 XLM). Note: after trustline is established, distributor will have ~0.5 XLM spendable; this is sufficient for this flow.

Execute button enabled only when all blocking checks pass and any non-blocking warnings are acknowledged.

Activity log panel (manual scroll, `userScrolledUp` ref pattern). Preflight and execution calls both log here.

### Step 4 — Result

Per-transaction status rows:
- **Tx A** `fund-accounts`: fund issuer + distrib in one tx — hash + Stellar.Expert link. Skipped if both accounts existed. On testnet, replaced by "Friendbot requests" row.
- **Tx B** `set-home-domain`: `set_options` on issuer — hash + Stellar.Expert link. Skipped if no home domain.
- **Tx C** `trustline`: `change_trust` by distributor — hash + Stellar.Expert link.
- **Tx D** `issuance`: `payment` issuer → distrib with memo (if provided) — hash + Stellar.Expert link.

On full success:
- `useAssetGroups` hook is called in `AssetCreatorPanel.tsx` (wizard root) and `addGroup` is passed as a prop to `Step4Result`. The panel awaits `addGroup()`, captures the returned `groupId` in local state, and passes it to Step 4 for the "Open Group →" button.
- Auto-save passes `issuerHomeDomain` from the form's `homeDomain` field; `distribHomeDomain` is always `""` (distrib has no separate home domain in this flow).
- Green "Open Group →" button → `/groups?open={groupId}`, opens in new tab.

On partial failure:
- Each tx tracked independently — green / red with error message.
- **Retry**: panel passes `AbortSignal` to the runner; retry re-invokes the strategy's `buildTransactions` with only the remaining `stepId`s, re-fetches sequence numbers from Horizon, re-signs. Cached XDR from failed steps is discarded.
- Runner treats `op_already_exists` on any `create_account` as skippable success.
- On testnet, `fund-accounts` retry re-issues the friendbot GET requests (not `buildTransactions`).

"Start over" resets all wizard state.

---

## File Structure

```
app/(tools)/asset-creator/
  page.tsx                          — route shell, renders AssetCreatorPanel

components/asset-creator/
  AssetCreatorPanel.tsx             — wizard root: tab state, form state, useAssetGroups, addGroup prop
  steps/
    Step1Accounts.tsx               — keypair inputs, funding source, network selector
    Step2AssetConfig.tsx            — asset fields, TOML preview, copy button
    Step3Preflight.tsx              — checklist, fee estimate, execute button, activity log
    Step4Result.tsx                 — per-tx rows, group save, open group button

lib/asset-creator/
  types.ts                          — all types listed below
  preflight.ts                      — checkAccountExists, checkBalance, checkAssetExists, estimateFees
  builder.ts                        — StandardStrategy.buildTransactions implementation
  runner.ts                         — runAssetCreation: orchestrates steps, manages retry, calls strategy
  toml.ts                           — generateTomlSnippet (pure, case-preserving, full public key)
```

---

## Key Types (`lib/asset-creator/types.ts`)

```ts
import type { Network } from "@/lib/settings";

interface AssetCreatorForm {
  network: Network;
  issuerPublicKey: string;
  issuerSecretKey: string;
  distributorPublicKey: string;
  distributorSecretKey: string;
  // Resolved before passing to runner: activeWallet.secretKey ?? manualFundingSecretKey
  // Never "" when actually needed — panel resolves this before calling runner
  resolvedFundingSecretKey: string;
  assetCode: string;        // case preserved
  tokenName: string;        // "" if not provided; TOML only
  supply: number;
  memo: string;             // "" if not provided; applied to Tx D only
  homeDomain: string;       // "" if not provided
}

interface SignedTx {
  stepId: "fund-accounts" | "set-home-domain" | "trustline" | "issuance";
  label: string;
  xdr: string;              // base64 XDR of signed transaction envelope
  sourceAccount: string;    // account whose sequence number was used (may differ from signer in future multisig strategies)
}

type StepStatus = "pending" | "running" | "success" | "failed" | "skipped";

interface StepResult {
  stepId: string;
  status: StepStatus;
  txHash?: string;
  error?: string;
}

interface PreflightCheck {
  id: string;
  label: string;
  status: "pass" | "fail" | "warning" | "loading";
  message?: string;     // shown on fail/warning
  blocking: boolean;    // if true, blocks execute; if false, requires checkbox acknowledgement
}

interface PreflightResult {
  checks: PreflightCheck[];
  estimatedFeesXlm: string;   // e.g. "0.0001"
  allBlockingPassed: boolean;
}

interface CreationResult {
  steps: StepResult[];
  groupId?: string;
}

interface CreationStrategy {
  id: string;
  label: string;
  // steps: which stepIds to build — allows incremental/retry invocation
  // signal: AbortSignal for cancellation of Horizon calls inside build
  buildTransactions(
    form: AssetCreatorForm,
    steps: Array<SignedTx["stepId"]>,
    server: Horizon.Server,
    networkPassphrase: string,
    signal: AbortSignal,
  ): Promise<SignedTx[]>;
}
```

---

## Transaction Sequencing

4 transactions, strict order. Each must succeed before the next is built:

| stepId | Operations | Source/Signer | Skip when |
|---|---|---|---|
| `fund-accounts` | `create_account` (issuer) + `create_account` (distrib) in one tx | Funding wallet | Both accounts already exist; testnet uses friendbot instead |
| `set-home-domain` | `set_options` on issuer | Issuer keypair | `homeDomain` is `""` |
| `trustline` | `change_trust` (distrib trusts asset) | Distributor keypair | — |
| `issuance` | `payment` issuer → distrib (with memo if provided) | Issuer keypair | — |

- Both `create_account` ops combined in one transaction to share a single funding wallet sequence number.
- Sequence numbers fetched from Horizon **immediately before building each transaction** — never pre-fetched.
- `resolvedFundingSecretKey` is resolved in the panel (from `activeWallet.secretKey ?? manualFundingSecretKey`) before the form is passed to the runner — lib functions never call hooks.

---

## Settings Utilities

From `lib/settings.ts` (already exists):
- `resolveHorizonUrl(settings): string` — returns Horizon URL for the selected network
- `resolveNetworkPassphrase(settings): string` — returns `Networks.PUBLIC` or `Networks.TESTNET`

These are imported directly into `AssetCreatorPanel.tsx` and passed into the runner/builder.

---

## TOML Snippet

`lib/asset-creator/toml.ts` — pure function:

```ts
generateTomlSnippet(form: AssetCreatorForm): string
```

- `code` field: **exact case from `form.assetCode`** — never uppercased
- `issuer` field: **full 56-character public key** from `form.issuerPublicKey`
- `name` field: `form.tokenName` if provided, otherwise `""`
- `display_decimals`: hardcoded `7`

Example (if user typed `myTOKEN`):
```toml
[[CURRENCIES]]
code = "myTOKEN"
issuer = "GABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234567890123456789"
display_decimals = 7
name = "My Token"
desc = ""
is_asset_anchored = false
anchor_asset_type = "other"
```

---

## Address Display

All Stellar address display in UI uses `shortAddr()` from `lib/format.ts`. Never define inline. Never use in TOML output or transaction building.

---

## Error Handling

- Blocking preflight failures: inline message with suggested fix (e.g. "Connect a funding wallet to create missing accounts on mainnet")
- Non-blocking warnings: checkbox "Proceed anyway" must be checked before Execute is enabled
- Friendbot HTTP 400 `createAccountAlreadyExist` → treated as success
- Runner treats `op_already_exists` on `create_account` as skippable success
- Partial execution: each tx tracked independently; retry re-fetches sequence numbers via strategy
- All Horizon fetches log via `onLog(\`  GET ${url}\`)` per project rules
- `AbortSignal` threaded through strategy interface and preflight functions
- Secret keys never logged

---

## Testing

| File | What to test |
|---|---|
| `lib/asset-creator/toml.ts` | All field combinations; `code` preserves case; full public key (not truncated); `name` empty when not provided; `display_decimals=7` always present |
| `lib/asset-creator/preflight.ts` | Mock Horizon: account exists/missing, balance pass/fail thresholds, asset already issued, `onLog` called with correct URL, `estimateFees` reads p50 correctly |
| `lib/asset-creator/builder.ts` | Correct operations per stepId; `fund-accounts` combines two ops; memo applied only to `issuance`; home domain skipped when `""`; correct `networkPassphrase` used; `sourceAccount` matches expected signer |

---

## Future Extensions

- Additional creation strategies: multisig issuer, sponsored reserves, pre-auth
- Asset flags: authorization required, clawback enabled, immutable supply lock
- Batch creation: multiple assets in one session
- TOML file hosting integration
- Strategy selector in Step 1 UI (infrastructure already in place via `CreationStrategy` interface)
- Configurable `display_decimals` in TOML snippet
