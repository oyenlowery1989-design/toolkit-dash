# Ghost Payments Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Ghost Payments module that submits intentionally-failing Stellar transactions (expired timebounds) so they appear permanently on Horizon without moving any funds.

**Architecture:** Extend `lib/bulk-payments/builder.ts` with a `ghost` flag that sets `maxTime` 1 second in the past. Create a standalone `GhostPaymentsPanel` component that reuses the same runner, recipient sources (manual, asset holders, from group), and UI patterns as Bulk Payments — but with a persistent danger banner, ghost-only labels, and tx proof export.

**Tech Stack:** Next.js App Router, stellar-sdk `TransactionBuilder` timebounds, existing `runBulkPayments` runner, `useAssetGroups` + `useBulkRecipients` hooks, shadcn/ui components.

---

### Task 1: Add `ghost` flag to builder

**Files:**
- Modify: `lib/bulk-payments/builder.ts`

**Step 1: Add `ghost?: boolean` param to `buildBatchTransaction`**

In `buildBatchTransaction`, replace the `builder.setTimeout(30).build()` call with:

```ts
export function buildBatchTransaction(
  account: Account,
  recipients: string[],
  memo: string,
  keypair: Keypair,
  networkPassphrase: string,
  feeMultiplier: number = 1,
  amount: string = MIN_PAYMENT_AMOUNT,
  asset: Asset = Asset.native(),
  ghost: boolean = false,   // <-- add this
): Transaction {
  // ... existing fee + builder setup unchanged ...

  let tx: Transaction;
  if (ghost) {
    // Expired timebounds — tx will fail with txTOO_LATE but IS recorded on-chain
    tx = builder
      .setTimeBounds(0, Math.floor(Date.now() / 1000) - 1)
      .build();
  } else {
    tx = builder.setTimeout(30).build();
  }
  tx.sign(keypair);
  return tx;
}
```

**Step 2: Add `ghost?: boolean` to `RunBulkOptions` in runner.ts**

In `lib/bulk-payments/runner.ts`, add to `RunBulkOptions`:
```ts
/** When true, transactions use expired timebounds and will fail visibly on-chain. */
ghost?: boolean;
```

And in `runBulkPayments`, destructure and pass it through:
```ts
export async function runBulkPayments({
  ...,
  ghost,
  ...
}: RunBulkOptions) {
  // ...
  const tx = buildBatchTransaction(
    account, batch, memo, keypair, networkPassphrase,
    feeMultiplier, amount, asset,
    ghost,  // <-- new
  );
```

**Step 3: Verify types compile**

```bash
cd "C:\Users\Windows\Downloads\stellar-toolkit-dash" && npx tsc --noEmit 2>&1 | head -30
```
Expected: no errors in builder.ts or runner.ts.

---

### Task 2: Create the Ghost Payments panel component

**Files:**
- Create: `components/ghost-payments/GhostPaymentsPanel.tsx`

This is a standalone panel. It shares logic with Bulk Payments but is NOT a copy — it imports from the same `runner.ts` and `builder.ts`. Key differences from `BulkPaymentsPanel`:

- **No phase-based routing** — simpler linear flow: configure → preview → sending → done
- **Ghost banner** always visible (red/orange warning): "These transactions will FAIL on-chain. No funds will move. Each transaction is permanently visible on Horizon with the memo."
- **Amount field** present (same as Bulk Payments — user sets amount to appear in the op, even though tx fails)
- **Asset selector** (XLM / Custom, same as Bulk Payments)
- **Recipient sources**: Manual List, Asset Holders, From Group (same as Bulk Payments)
- **Min balance filter** in Asset Holders tab
- **Exclude list** collapsible section
- **`ghost: true`** always passed to `runBulkPayments`
- **Preview card** says "Ghost send" not "Send Now"; shows "Each transaction will fail with txTOO_LATE"
- **Results table**: same BatchRow component, but column header says "Proof (Tx Hash)" instead of "Tx / Error" — failed txs with a hash ARE the success state
- **Done phase**: "success" batches show green "Recorded on-chain" (not "Sent"); failed-with-hash are the expected outcome; truly failed (no hash) = node rejected

Full component structure:

```tsx
"use client";

import { useRef, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Asset, StrKey, Keypair } from "stellar-sdk";
import { useAssetGroups } from "@/hooks/use-asset-groups";
import { useBulkRecipients } from "@/hooks/use-bulk-recipients";
import { useHorizonServer } from "@/hooks/use-horizon-server";
import { useSettings, type Network } from "@/lib/settings";
import { runBulkPayments } from "@/lib/bulk-payments/runner";
import { estimateCost } from "@/lib/bulk-payments/builder";
import { fetchAllHolders } from "@/lib/asset-lookup/fetchers";
import { getErrorMessage } from "@/lib/stellar-helpers";
import { ShortAddress } from "@/components/asset-lookup";
import { downloadCSV } from "@/lib/csv-export";
import { formatXlm, parseAddresses as parseValidAddresses } from "@/lib/format";
import type { BatchResult, AssetSource } from "@/lib/bulk-payments/types";
import {
  Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertTriangle, CheckCircle2, Download, ExternalLink, Eye, EyeOff,
  Ghost, Loader2, RefreshCw, Send, Users, X, XCircle,
} from "lucide-react";
```

**State** (same fields as BulkPaymentsPanel except no `batches` state needed for retry, ghost always enabled):

```tsx
const [memo, setMemo] = useState("");
const [secretKey, setSecretKey] = useState("");
const [batchSize, setBatchSize] = useState(100);
const [feeMultiplier, setFeeMultiplier] = useState(1);
const [showSecret, setShowSecret] = useState(false);
const [amount, setAmount] = useState("0.0000001");
const [assetType, setAssetType] = useState<"xlm" | "custom">("xlm");
const [customAssetCode, setCustomAssetCode] = useState("");
const [customAssetIssuer, setCustomAssetIssuer] = useState("");
const [sourceTab, setSourceTab] = useState<"manual" | "assets" | "group">("manual");
const [manualText, setManualText] = useState("");
const [assetsText, setAssetsText] = useState(urlAssets ?? "");
const [assetSources, setAssetSources] = useState<AssetSource[]>([]);
const [fetchingHolders, setFetchingHolders] = useState(false);
const [fetchProgress, setFetchProgress] = useState<string | null>(null);
const [minBalance, setMinBalance] = useState(0);
const [excludeText, setExcludeText] = useState("");
const [showExclude, setShowExclude] = useState(false);
const [selectedGroupId, setSelectedGroupId] = useState("");
const [recipients, setRecipients] = useState<string[]>([]);
const [phase, setPhase] = useState<"configure" | "preview" | "sending" | "done">("configure");
const [batchResults, setBatchResults] = useState<BatchResult[]>([]);
const [error, setError] = useState<string | null>(null);
```

**Ghost banner** — place at the top of configure phase AND preview phase:

```tsx
<div className="rounded-md bg-orange-500/10 border border-orange-500/40 p-4 flex items-start gap-3">
  <Ghost className="h-5 w-5 text-orange-500 shrink-0 mt-0.5" />
  <div className="space-y-1">
    <p className="text-sm font-semibold text-orange-500">Ghost Payment Mode</p>
    <p className="text-xs text-muted-foreground">
      Transactions use expired time bounds and will fail with{" "}
      <code className="font-mono text-orange-400">txTOO_LATE</code> on the Stellar network.{" "}
      <strong>No funds will move.</strong> Each transaction is permanently visible on Horizon
      as proof of the send attempt, with your memo attached.
    </p>
  </div>
</div>
```

**`parseAssetPairs` helper** — copy verbatim from `BulkPaymentsPanel.tsx` (handles bare `CODE:ISSUER` and Lobstr URLs):

```ts
function parseAssetPairs(text: string): { assetCode: string; issuer: string }[] {
  const seen = new Set<string>();
  const results: { assetCode: string; issuer: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/([A-Za-z0-9]{1,12}):([A-Z2-7]{56})/);
    if (!match) continue;
    const assetCode = match[1].toUpperCase();
    const issuer = match[2];
    if (!StrKey.isValidEd25519PublicKey(issuer)) continue;
    const key = `${assetCode}:${issuer}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ assetCode, issuer });
  }
  return results;
}
```

**`handleSend`** — identical to BulkPaymentsPanel but with `ghost: true` added:

```ts
await runBulkPayments({
  horizonUrl,
  network,
  secretKey: secretKey.trim(),
  recipients,
  memo: memo.trim(),
  batchSize,
  feeMultiplier,
  amount: amount.trim(),
  asset: getPaymentAsset(),
  ghost: true,   // <-- the only difference
  signal: abortRef.current.signal,
  onBatchUpdate: (result) => {
    setBatchResults((prev) => {
      const next = [...prev];
      next[result.batchIndex] = result;
      return next;
    });
  },
});
```

**Results table** — same `BatchRow` but change column header and interpret `success` as "Recorded":

```tsx
<th className="text-left px-3 py-2">Proof (Tx Hash)</th>
```

In `BatchRow` for ghost panel, the `success` state label should say:
```tsx
{result.status === "success" && (
  <span className="flex items-center gap-1 text-green-500">
    <CheckCircle2 className="h-3 w-3" /> Recorded
  </span>
)}
```

Note: In Stellar, a `txTOO_LATE` failure still returns a transaction hash and the tx IS stored on Horizon. The runner's `submitTransaction` call will throw, so we need to handle `txTOO_LATE` specially — extract the hash from the error response if present. See Task 3.

**Export CSV** — same as BulkPaymentsPanel but filename `ghost-payments-proof.csv`.

---

### Task 3: Handle txTOO_LATE result code — extract hash from error

**Files:**
- Modify: `lib/bulk-payments/runner.ts`

The stellar-sdk throws on any non-success submission. For ghost mode, `txTOO_LATE` is expected and the response still contains a tx hash. We need to extract it.

**Step 1: Update `extractHorizonError` to also return hash**

Replace `extractHorizonError` with a function that returns both message and hash:

```ts
function extractHorizonResult(err: unknown): { error: string; txHash?: string } {
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    // Horizon submission errors include the full response
    const resp = e["response"] as Record<string, unknown> | undefined;
    // Try to get tx hash from response
    const hash = (resp?.["hash"] as string | undefined) ??
                 (e["hash"] as string | undefined);
    const extras = resp?.["extras"] as Record<string, unknown> | undefined;
    const codes = extras?.["result_codes"] as Record<string, unknown> | undefined;
    let errorMsg = getErrorMessage(err);
    if (codes) {
      const tx = codes["transaction"];
      const ops = codes["operations"];
      const parts: string[] = [];
      if (tx) parts.push(`tx: ${tx}`);
      if (Array.isArray(ops)) parts.push(`ops: ${ops.join(", ")}`);
      if (parts.length) errorMsg = parts.join(" | ");
    }
    return { error: errorMsg, txHash: hash };
  }
  return { error: getErrorMessage(err) };
}
```

**Step 2: Use `extractHorizonResult` in the catch block**

```ts
} catch (err) {
  if (signal.aborted) break;

  const { error, txHash } = extractHorizonResult(err);

  // Ghost mode: txTOO_LATE is expected — if we got a hash, it's "success" for our purposes
  if (ghost && txHash) {
    onBatchUpdate({
      batchIndex: i,
      count: batch.length,
      status: "success",
      txHash,
    });
  } else {
    onBatchUpdate({
      batchIndex: i,
      count: batch.length,
      status: "failed",
      error,
    });
  }

  // Reload account sequence for next batch
  try {
    account = await server.loadAccount(keypair.publicKey());
  } catch {
    break;
  }
}
```

**Step 3: Verify types compile**

```bash
cd "C:\Users\Windows\Downloads\stellar-toolkit-dash" && npx tsc --noEmit 2>&1 | head -30
```

---

### Task 4: Create the page route

**Files:**
- Create: `app/(tools)/ghost-payments/page.tsx`

```tsx
import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { GhostPaymentsPanel } from "@/components/ghost-payments/GhostPaymentsPanel";

export default function GhostPaymentsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Ghost Payments</h1>
        <p className="text-muted-foreground mt-2">
          Send on-chain proof transactions that intentionally fail. Transactions
          appear permanently on Horizon with your memo — but no funds ever move.
          Uses expired time bounds (<code>txTOO_LATE</code>).
        </p>
      </div>

      <Suspense
        fallback={
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        }
      >
        <GhostPaymentsPanel />
      </Suspense>
    </div>
  );
}
```

---

### Task 5: Add Ghost Payments to navigation

**Files:**
- Modify: `lib/navigation.ts`

**Step 1: Add `Ghost` icon import**

```ts
import {
  // ... existing imports ...
  Ghost,
} from "lucide-react";
```

**Step 2: Add menu entry after Bulk Payments**

```ts
{
  title: "Bulk Payments",
  href: "/bulk-payments",
  icon: Megaphone,
},
{
  title: "Ghost Payments",
  href: "/ghost-payments",
  icon: Ghost,
},
```

---

### Task 6: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

Add to the Module Inventory table:
```
| `ghost-payments` | Working — expired timebounds, on-chain proof, same recipient sources as Bulk Payments |
```

Add a new section `## Ghost Payments`:
```markdown
## Ghost Payments
- Route: `app/(tools)/ghost-payments/page.tsx`
- Panel: `components/ghost-payments/GhostPaymentsPanel.tsx`
- **Mechanism**: `ghost: true` in `RunBulkOptions` → `buildBatchTransaction` uses `setTimeBounds(0, now-1)` instead of `setTimeout(30)` → tx fails with `txTOO_LATE` but IS included in ledger and visible on Horizon
- **Hash extraction**: `txTOO_LATE` errors from Horizon still contain a tx hash in the error response — `extractHorizonResult()` pulls it out; if hash present + ghost mode → batch marked `success` (recorded on-chain)
- **Security purpose**: proves an address signed and submitted a transaction at a specific time, with a specific memo — useful for claim proofs, eligibility signals, on-chain messaging
- **No funds move**: amount field is present (appears in op data) but tx always fails before settlement
- Reuses: `runBulkPayments` runner, `estimateCost`, `fetchAllHolders`, `useAssetGroups`, `useBulkRecipients`
- Do NOT add a ghost toggle to Bulk Payments — keep modules separate for safety clarity
```

---

### Task 7: Verify the full flow

**Manual test steps:**

1. Run dev server: `npm run dev`
2. Navigate to `/ghost-payments`
3. Confirm orange Ghost banner is visible
4. Enter a signing secret key (testnet recommended)
5. Add 1-2 testnet addresses to Manual List
6. Click "Preview & Confirm" — verify "Ghost send" button label
7. Click "Ghost Send" — verify txs appear in results table as "Recorded" with tx hashes
8. Click a tx hash link → opens Stellar.Expert → confirm tx shows `txTOO_LATE` result code
9. Export CSV → confirm file is named `ghost-payments-proof.csv`
10. Navigate to `/bulk-payments` → confirm it is unchanged (no ghost banner, sends normally)
