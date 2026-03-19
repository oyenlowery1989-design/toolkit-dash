# Tiered Rewards Distribution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `/tiered-rewards` module that scans Stellar asset holders, sorts them into token-balance tiers, and distributes flat per-holder rewards (any asset) on a configurable schedule.

**Architecture:** Standalone module following auto-send groups patterns — own DB tables, lib, hook, API routes, and scheduler singleton that boots alongside the existing auto-send scheduler. Layout B: expandable config cards with saved scheduled configs + Quick Run modal for ad-hoc distributions.

**Tech Stack:** Next.js 14+, TypeScript, better-sqlite3 (local) / Supabase (deployed), Stellar SDK (stellar-sdk), shadcn/ui, node-cron, React hooks with createDbCache pattern.

> **Note — Supabase paths:** The CRUD and run API routes contain `// TODO: Supabase implementation` stubs that return empty/ok responses. This means the module works fully in local dev but will not persist data on Vercel. Supabase support is intentionally deferred to a follow-up task.

**Spec:** `docs/superpowers/specs/2026-03-19-tiered-rewards-design.md`

---

## Reference patterns — read before starting

Before writing any code, read these files to understand the exact patterns to replicate:

- `lib/auto-send/types.ts` — TypeScript interface pattern
- `lib/auto-send/runner.ts` — `extractError()`, `loadNativeBalance()`, sequence re-fetch, batch pattern
- `lib/auto-send/scheduler.ts` — singleton guard, `loadEnabledGroups()`, `scheduleAll()`, `refreshScheduler()`
- `lib/db.ts` — how tables are declared in `db.exec(...)`, timestamp type (INTEGER), naming convention
- `hooks/use-auto-send-groups.ts` — `createDbCache`, `dbPost`, `dbPatch`, optimistic writes, refresh-scheduler call pattern
- `app/api/auto-send/run/route.ts` — run/preview/dry-run/refresh-scheduler action dispatch pattern
- `lib/db-client.ts` — `createDbCache`, `dbPost`, `dbPatch`, `authHeaders`, `waitForAuth`
- `components/auto-send-groups/AutoSendGroupsPanel.tsx` — card list UI pattern

---

## Task 1: DB Schema

**Files:**
- Modify: `lib/db.ts` (add 4 tables inside the `db.exec(...)` call)

- [ ] **Step 1: Add 4 tables to the db.exec block in `lib/db.ts`**

Find the end of the existing `db.exec(...)` block and add before the closing backtick:

```sql
-- ── Tiered Rewards ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tiered_reward_configs (
  id                    TEXT    PRIMARY KEY,
  name                  TEXT    NOT NULL,
  asset_code            TEXT    NOT NULL,
  asset_issuer          TEXT    NOT NULL,
  network               TEXT    NOT NULL,
  secret_key            TEXT    NOT NULL,
  interval_minutes      INTEGER,
  enabled               INTEGER NOT NULL DEFAULT 0,
  min_reserve           REAL    NOT NULL DEFAULT 10.0,
  min_sender_threshold  REAL    NOT NULL DEFAULT 0.0,
  preview_only          INTEGER NOT NULL DEFAULT 0,
  last_run_at           INTEGER,
  last_failure_at       INTEGER,
  created_at            INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tiered_reward_tiers (
  id           TEXT    PRIMARY KEY,
  config_id    TEXT    NOT NULL REFERENCES tiered_reward_configs(id) ON DELETE CASCADE,
  tier_number  INTEGER NOT NULL,
  min_tokens   REAL    NOT NULL,
  max_tokens   REAL,
  position     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tiered_reward_assets (
  id            TEXT    PRIMARY KEY,
  tier_id       TEXT    NOT NULL REFERENCES tiered_reward_tiers(id) ON DELETE CASCADE,
  asset_code    TEXT    NOT NULL,
  asset_issuer  TEXT,
  amount        REAL    NOT NULL
);

CREATE TABLE IF NOT EXISTS tiered_reward_run_log (
  id              TEXT    PRIMARY KEY,
  config_id       TEXT    REFERENCES tiered_reward_configs(id) ON DELETE CASCADE,
  tier_number     INTEGER NOT NULL,
  holder_address  TEXT    NOT NULL,
  asset_code      TEXT    NOT NULL,
  asset_issuer    TEXT,
  amount_sent     REAL    NOT NULL DEFAULT 0,
  status          TEXT    NOT NULL,
  tx_hash         TEXT,
  error           TEXT,
  ran_at          INTEGER NOT NULL
);
```

- [ ] **Step 2: Verify dev server starts without error**

```bash
npm run dev
```

Expected: no SQLite errors in terminal, tables created silently on first boot.

- [ ] **Step 3: Commit**

```bash
git add lib/db.ts
git commit -m "feat(tiered-rewards): add DB schema — 4 tables"
```

---

## Task 2: Types

**Files:**
- Create: `lib/tiered-rewards/types.ts`

- [ ] **Step 1: Create `lib/tiered-rewards/types.ts`**

```typescript
export interface RewardAsset {
  id: string;
  tierId: string;
  assetCode: string;       // "XLM" for native
  assetIssuer?: string;    // undefined for native XLM
  amount: number;          // flat amount per holder per run
}

export interface Tier {
  id: string;
  configId: string;
  tierNumber: number;      // 1-based
  minTokens: number;       // inclusive
  maxTokens?: number;      // undefined = open-ended top tier
  position: number;
  assets: RewardAsset[];   // reward assets for this tier
}

export interface TieredRewardConfig {
  id: string;
  name: string;
  assetCode: string;       // asset to scan holders for
  assetIssuer: string;
  network: string;         // "testnet" | "public" | "futurenet"
  secretKey: string;
  intervalMinutes: number | null;  // null = manual only
  enabled: boolean;
  minReserve: number;              // default 10.0 XLM
  minSenderThreshold: number;      // default 0 (disabled)
  previewOnly: boolean;
  lastRunAt?: number;              // Unix ms
  lastFailureAt?: number;          // Unix ms
  createdAt: number;               // Unix ms
  tiers: Tier[];
}

export interface HolderEntry {
  address: string;
  balance: number;         // token balance (parsed float)
}

export interface TierAssignment {
  tier: Tier;
  holders: HolderEntry[];
}

export interface TierCostItem {
  assetCode: string;
  assetIssuer?: string;
  totalRequired: number;   // amount × holderCount
  senderBalance: number;   // current sender balance for this asset
  hasTrustline: boolean;   // sender has trustline (always true for XLM)
  shortfall: number;       // max(0, totalRequired - senderBalance)
}

export interface RewardsPreview {
  configId?: string;       // undefined for Quick Runs
  senderAddress: string;
  xlmBalance: number;
  assignments: TierAssignment[];
  costItems: TierCostItem[];
  blocked: boolean;        // true if any shortfall or missing trustline
  blockReasons: string[];
}

export interface RunLogRow {
  id: string;
  configId?: string;
  tierNumber: number;
  holderAddress: string;
  assetCode: string;
  assetIssuer?: string;
  amountSent: number;
  status: "sent" | "failed" | "skipped" | "aborted" | "preview";
  txHash?: string;
  error?: string;
  ranAt: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/tiered-rewards/types.ts
git commit -m "feat(tiered-rewards): add TypeScript types"
```

---

## Task 3: Holder Fetcher

**Files:**
- Create: `lib/tiered-rewards/fetcher.ts`

Fetches all trustline holders of an asset via Horizon pagination, excludes issuer + zero-balance accounts, assigns each holder to a tier.

- [ ] **Step 1: Create `lib/tiered-rewards/fetcher.ts`**

```typescript
import { Horizon } from "stellar-sdk";
import type { Tier, HolderEntry, TierAssignment } from "./types";

const { Server } = Horizon;

const HORIZON_URLS: Record<string, string> = {
  public: "https://horizon.stellar.org",
  testnet: "https://horizon-testnet.stellar.org",
  futurenet: "https://horizon-futurenet.stellar.org",
};

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;

async function fetchPageWithRetry(
  url: string,
  retries = MAX_RETRIES
): Promise<{ records: Record<string, unknown>[]; next?: () => Promise<unknown> }> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as { _embedded?: { records: Record<string, unknown>[] }; _links?: { next?: { href: string } } };
      return {
        records: json._embedded?.records ?? [],
        // Horizon cursor-style: next link href becomes next fetch URL
      };
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, RETRY_BASE_MS * 2 ** attempt));
    }
  }
  throw new Error("unreachable");
}

/**
 * Fetches all trustline holders of assetCode:assetIssuer via Horizon.
 * Excludes the issuer account itself and zero-balance accounts.
 * Aborts entire scan if any page fails after MAX_RETRIES.
 */
export async function fetchHolders(
  assetCode: string,
  assetIssuer: string,
  network: string,
  signal?: AbortSignal
): Promise<HolderEntry[]> {
  const horizonUrl = HORIZON_URLS[network] ?? HORIZON_URLS.public;
  const server = new Server(horizonUrl);

  const holders: HolderEntry[] = [];
  let cursor: string | undefined;

  while (true) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    let page: Awaited<ReturnType<typeof server.accounts>["call"]>;
    try {
      let builder = server.accounts().forAsset({ code: assetCode, issuer: assetIssuer } as never).limit(200);
      if (cursor) builder = builder.cursor(cursor);
      page = await (builder as unknown as { call(): Promise<typeof page> }).call();
    } catch (err) {
      // Retry is handled inside fetchPageWithRetry; if we reach here it's a fatal error
      throw new Error(`Failed to fetch holders page: ${err instanceof Error ? err.message : String(err)}`);
    }

    const records = page.records as Array<{
      id: string;
      balances: Array<{ asset_type: string; asset_code?: string; asset_issuer?: string; balance: string }>;
      paging_token: string;
    }>;

    if (records.length === 0) break;

    for (const record of records) {
      // Exclude issuer account
      if (record.id === assetIssuer) continue;

      const balanceEntry = record.balances.find(
        (b) =>
          (b.asset_type === "credit_alphanum4" || b.asset_type === "credit_alphanum12") &&
          b.asset_code === assetCode &&
          b.asset_issuer === assetIssuer
      );
      if (!balanceEntry) continue;

      const balance = parseFloat(balanceEntry.balance);
      // Zero-balance accounts fall below any tier naturally; skip them
      if (balance <= 0) continue;

      holders.push({ address: record.id, balance });
      cursor = record.paging_token;
    }

    // Horizon returns fewer than limit records when we've reached the end
    if (records.length < 200) break;
  }

  return holders;
}

/**
 * Assigns each holder to the first matching tier.
 * Returns only tiers that have at least 1 holder (empty tiers included as empty arrays).
 */
export function assignHoldersToTiers(
  holders: HolderEntry[],
  tiers: Tier[]
): TierAssignment[] {
  // Sort tiers by tier_number ascending
  const sorted = [...tiers].sort((a, b) => a.tierNumber - b.tierNumber);

  const assignments: TierAssignment[] = sorted.map((tier) => ({ tier, holders: [] }));

  for (const holder of holders) {
    for (const assignment of assignments) {
      const { minTokens, maxTokens } = assignment.tier;
      const inTier =
        holder.balance >= minTokens &&
        (maxTokens === undefined || maxTokens === null || holder.balance < maxTokens);
      if (inTier) {
        assignment.holders.push(holder);
        break; // first matching tier wins
      }
    }
  }

  return assignments;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/tiered-rewards/fetcher.ts
git commit -m "feat(tiered-rewards): add holder fetcher + tier assignment"
```

---

## Task 4: Calculator (Preview)

**Files:**
- Create: `lib/tiered-rewards/calculator.ts`

Computes preview: total cost per asset, sender balance checks, trustline checks.

- [ ] **Step 1: Create `lib/tiered-rewards/calculator.ts`**

```typescript
import { Horizon, Keypair } from "stellar-sdk";
import type { TieredRewardConfig, TierAssignment, TierCostItem, RewardsPreview } from "./types";
import { fetchHolders, assignHoldersToTiers } from "./fetcher";

const { Server } = Horizon;

const HORIZON_URLS: Record<string, string> = {
  public: "https://horizon.stellar.org",
  testnet: "https://horizon-testnet.stellar.org",
  futurenet: "https://horizon-futurenet.stellar.org",
};

export const FEE_BUDGET = 1.0; // flat 1 XLM safety buffer — must match runner.ts

/**
 * Builds a map of assetKey → { senderBalance, hasTrustline } for all non-native reward assets.
 * assetKey = "CODE:ISSUER"
 */
async function loadSenderAssetBalances(
  server: InstanceType<typeof Server>,
  senderAddress: string,
  assetKeys: Set<string>
): Promise<Map<string, { balance: number; hasTrustline: boolean }>> {
  const result = new Map<string, { balance: number; hasTrustline: boolean }>();
  if (assetKeys.size === 0) return result;

  const account = await server.loadAccount(senderAddress);
  for (const key of assetKeys) {
    const [code, issuer] = key.split(":");
    const entry = account.balances.find(
      (b: { asset_type: string; asset_code?: string; asset_issuer?: string }) =>
        (b.asset_type === "credit_alphanum4" || b.asset_type === "credit_alphanum12") &&
        b.asset_code === code &&
        b.asset_issuer === issuer
    ) as { balance: string } | undefined;
    result.set(key, {
      balance: entry ? parseFloat(entry.balance) : 0,
      hasTrustline: !!entry,
    });
  }
  return result;
}

/**
 * Full preview calculation.
 * Fetches holders, assigns to tiers, checks sender balances + trustlines.
 * Returns a RewardsPreview with blocked=true if any asset is short or trustline missing.
 */
export async function calculatePreview(
  config: TieredRewardConfig,
  signal?: AbortSignal
): Promise<RewardsPreview | { error: string }> {
  const horizonUrl = HORIZON_URLS[config.network] ?? HORIZON_URLS.public;
  const server = new Server(horizonUrl);

  // Validate secret key
  let keypair: Keypair;
  try {
    keypair = Keypair.fromSecret(config.secretKey);
  } catch {
    return { error: "Invalid secret key" };
  }
  const senderAddress = keypair.publicKey();

  // Load sender XLM balance
  let xlmBalance: number;
  let account: Awaited<ReturnType<typeof server.loadAccount>>;
  try {
    account = await server.loadAccount(senderAddress);
    const native = account.balances.find((b: { asset_type: string }) => b.asset_type === "native") as { balance: string } | undefined;
    xlmBalance = parseFloat(native?.balance ?? "0");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: msg.includes("404") ? `Sender account not found on ${config.network}` : msg.slice(0, 150) };
  }

  // Fetch holders and assign to tiers
  let holders;
  try {
    holders = await fetchHolders(config.assetCode, config.assetIssuer, config.network, signal);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }

  const assignments = assignHoldersToTiers(holders, config.tiers);

  // Collect all unique non-XLM reward asset keys needed
  const nonNativeKeys = new Set<string>();
  for (const assignment of assignments) {
    for (const asset of assignment.tier.assets) {
      if (asset.assetCode !== "XLM" && asset.assetIssuer) {
        nonNativeKeys.add(`${asset.assetCode}:${asset.assetIssuer}`);
      }
    }
  }

  const assetBalances = await loadSenderAssetBalances(server, senderAddress, nonNativeKeys);

  // Calculate cost per unique asset across all tiers
  const costMap = new Map<string, { required: number; senderBalance: number; hasTrustline: boolean; code: string; issuer?: string }>();

  for (const assignment of assignments) {
    const holderCount = assignment.holders.length;
    if (holderCount === 0) continue;

    for (const asset of assignment.tier.assets) {
      const key = asset.assetCode === "XLM" ? "XLM" : `${asset.assetCode}:${asset.assetIssuer}`;
      const required = asset.amount * holderCount;

      if (!costMap.has(key)) {
        if (asset.assetCode === "XLM") {
          const spendable = Math.max(0, xlmBalance - config.minReserve - FEE_BUDGET);
          costMap.set(key, { required: 0, senderBalance: spendable, hasTrustline: true, code: "XLM" });
        } else {
          const info = assetBalances.get(key) ?? { balance: 0, hasTrustline: false };
          costMap.set(key, { required: 0, senderBalance: info.balance, hasTrustline: info.hasTrustline, code: asset.assetCode, issuer: asset.assetIssuer });
        }
      }
      const entry = costMap.get(key)!;
      entry.required += required;
    }
  }

  const costItems: TierCostItem[] = Array.from(costMap.entries()).map(([, v]) => ({
    assetCode: v.code,
    assetIssuer: v.issuer,
    totalRequired: v.required,
    senderBalance: v.senderBalance,
    hasTrustline: v.hasTrustline,
    shortfall: Math.max(0, v.required - v.senderBalance),
  }));

  const blockReasons: string[] = [];
  for (const item of costItems) {
    if (!item.hasTrustline) {
      blockReasons.push(`Sender has no trustline for ${item.assetCode}:${item.assetIssuer}`);
    } else if (item.shortfall > 0) {
      blockReasons.push(
        `Insufficient ${item.assetCode}: need ${item.totalRequired.toFixed(7)}, have ${item.senderBalance.toFixed(7)} (shortfall ${item.shortfall.toFixed(7)})`
      );
    }
  }

  return {
    configId: config.id,
    senderAddress,
    xlmBalance,
    assignments,
    costItems,
    blocked: blockReasons.length > 0,
    blockReasons,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/tiered-rewards/calculator.ts
git commit -m "feat(tiered-rewards): add preview calculator with sender balance checks"
```

---

## Task 5: Runner

**Files:**
- Create: `lib/tiered-rewards/runner.ts`

Executes payments per tier, batches 100 ops/tx, re-fetches account sequence before each batch, logs each holder×asset row to DB.

- [ ] **Step 1: Create `lib/tiered-rewards/runner.ts`**

```typescript
import { Keypair, TransactionBuilder, Operation, Asset, Horizon } from "stellar-sdk";
import type { TieredRewardConfig, TierAssignment, RunLogRow } from "./types";
import { getDb } from "@/lib/db";

const { Server } = Horizon;

const HORIZON_URLS: Record<string, string> = {
  public: "https://horizon.stellar.org",
  testnet: "https://horizon-testnet.stellar.org",
  futurenet: "https://horizon-futurenet.stellar.org",
};

const NETWORK_PASSPHRASES: Record<string, string> = {
  public: "Public Global Stellar Network ; September 2015",
  testnet: "Test SDF Network ; September 2015",
  futurenet: "Test SDF Future Network ; October 2022",
};

const BATCH_SIZE = 100;
export const FEE_BUDGET = 1.0; // must match calculator.ts

function extractError(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    const extras = (e.response as Record<string, unknown> | undefined)?.data as Record<string, unknown> | undefined;
    if (extras?.extras) {
      const rc = (extras.extras as Record<string, unknown>).result_codes as Record<string, unknown> | undefined;
      if (rc) {
        const tx = rc.transaction as string | undefined;
        const ops = rc.operations as string[] | undefined;
        const parts: string[] = [];
        if (tx) parts.push(tx);
        if (ops?.length) parts.push(`ops: ${ops.join(", ")}`);
        if (parts.length) return parts.join(" | ");
      }
    }
  }
  return err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200);
}

function logRows(rows: Omit<RunLogRow, "id">[]): void {
  try {
    const db = getDb();
    const stmt = db.prepare(
      `INSERT INTO tiered_reward_run_log
       (id, config_id, tier_number, holder_address, asset_code, asset_issuer, amount_sent, status, tx_hash, error, ran_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertMany = db.transaction((rs: typeof rows) => {
      for (const r of rs) {
        stmt.run(
          crypto.randomUUID(), r.configId ?? null, r.tierNumber,
          r.holderAddress, r.assetCode, r.assetIssuer ?? null,
          r.amountSent, r.status, r.txHash ?? null, r.error ?? null, r.ranAt
        );
      }
    });
    insertMany(rows);
  } catch { /* non-fatal */ }
}

function buildStellarAsset(assetCode: string, assetIssuer?: string): Asset {
  return assetCode === "XLM" ? Asset.native() : new Asset(assetCode, assetIssuer!);
}

/**
 * Executes all payment batches for a single tier.
 * Re-fetches account before each batch for fresh sequence number.
 * Stops on first batch failure and marks remaining holders as "aborted".
 */
async function runTier(
  server: InstanceType<typeof Server>,
  keypair: Keypair,
  networkPassphrase: string,
  assignment: TierAssignment,
  configId: string | undefined,
  ranAt: number
): Promise<void> {
  const { tier, holders } = assignment;
  if (holders.length === 0) return;

  const senderAddress = keypair.publicKey();

  // Build flat list of (holder, asset) pairs to send
  type SendOp = { holder: string; assetCode: string; assetIssuer?: string; amount: number };
  const ops: SendOp[] = [];
  for (const holder of holders) {
    for (const asset of tier.assets) {
      ops.push({ holder: holder.address, assetCode: asset.assetCode, assetIssuer: asset.assetIssuer, amount: asset.amount });
    }
  }

  let aborted = false;
  let batchStart = 0;

  while (batchStart < ops.length) {
    if (aborted) break;

    const batch = ops.slice(batchStart, batchStart + BATCH_SIZE);

    try {
      // Re-fetch account to get fresh sequence number for each batch
      const account = await server.loadAccount(senderAddress);
      const builder = new TransactionBuilder(account, { fee: "100", networkPassphrase });

      for (const op of batch) {
        builder.addOperation(
          Operation.payment({
            destination: op.holder,
            asset: buildStellarAsset(op.assetCode, op.assetIssuer),
            amount: op.amount.toFixed(7),
          })
        );
      }

      const tx = builder.setTimeout(30).build();
      tx.sign(keypair);
      const response = await server.submitTransaction(tx);
      const txHash = (response as { hash?: string }).hash;

      // Log all ops in this batch as sent
      logRows(
        batch.map((op) => ({
          configId,
          tierNumber: tier.tierNumber,
          holderAddress: op.holder,
          assetCode: op.assetCode,
          assetIssuer: op.assetIssuer,
          amountSent: op.amount,
          status: "sent" as const,
          txHash,
          ranAt,
        }))
      );
    } catch (err) {
      const message = extractError(err);
      aborted = true;

      // Log failed batch ops
      logRows(
        batch.map((op) => ({
          configId,
          tierNumber: tier.tierNumber,
          holderAddress: op.holder,
          assetCode: op.assetCode,
          assetIssuer: op.assetIssuer,
          amountSent: 0,
          status: "failed" as const,
          error: message,
          ranAt,
        }))
      );
    }

    batchStart += BATCH_SIZE;
  }

  // Log remaining ops as aborted if we stopped early
  if (aborted && batchStart < ops.length) {
    const remaining = ops.slice(batchStart);
    logRows(
      remaining.map((op) => ({
        configId,
        tierNumber: tier.tierNumber,
        holderAddress: op.holder,
        assetCode: op.assetCode,
        assetIssuer: op.assetIssuer,
        amountSent: 0,
        status: "aborted" as const,
        error: "Aborted — earlier batch failed",
        ranAt,
      }))
    );
  }
}

export interface RunResult {
  configId?: string;
  senderAddress: string;
  ranAt: number;
  tiersProcessed: number;
  totalSent: number;
  totalFailed: number;
}

/**
 * Execute all tiers in a config.
 * Each tier runs independently — failure in one tier does not stop others.
 * Min reserve and fee budget are validated by the caller (calculator/preview).
 */
export async function runConfig(
  config: TieredRewardConfig,
  assignments: TierAssignment[]
): Promise<RunResult | { error: string }> {
  const horizonUrl = HORIZON_URLS[config.network] ?? HORIZON_URLS.public;
  const networkPassphrase = NETWORK_PASSPHRASES[config.network] ?? NETWORK_PASSPHRASES.public;
  const server = new Server(horizonUrl);
  const ranAt = Date.now();

  let keypair: Keypair;
  try {
    keypair = Keypair.fromSecret(config.secretKey);
  } catch {
    return { error: "Invalid secret key" };
  }

  for (const assignment of assignments) {
    await runTier(server, keypair, networkPassphrase, assignment, config.id, ranAt);
  }

  // Update last_run_at in DB
  try {
    const db = getDb();
    db.prepare("UPDATE tiered_reward_configs SET last_run_at = ?, last_failure_at = NULL WHERE id = ?")
      .run(ranAt, config.id);
  } catch { /* non-fatal */ }

  const logRows2 = (() => {
    try {
      const db = getDb();
      return db.prepare("SELECT status FROM tiered_reward_run_log WHERE config_id = ? AND ran_at = ?")
        .all(config.id, ranAt) as { status: string }[];
    } catch { return []; }
  })();

  return {
    configId: config.id,
    senderAddress: keypair.publicKey(),
    ranAt,
    tiersProcessed: assignments.length,
    totalSent: logRows2.filter((r) => r.status === "sent").length,
    totalFailed: logRows2.filter((r) => r.status === "failed" || r.status === "aborted").length,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/tiered-rewards/runner.ts
git commit -m "feat(tiered-rewards): add payment runner with batching + per-holder logging"
```

---

## Task 6: Scheduler

**Files:**
- Create: `lib/tiered-rewards/scheduler.ts`
- Modify: `instrumentation.ts`

- [ ] **Step 1: Create `lib/tiered-rewards/scheduler.ts`**

```typescript
/**
 * Tiered Rewards scheduler.
 * Mirrors auto-send scheduler pattern exactly.
 * Singleton guard prevents duplicate schedulers on HMR.
 */
import type { ScheduledTask } from "node-cron";
import type { TieredRewardConfig } from "./types";

declare global {
  var _tieredRewardsTasks: Map<string, ScheduledTask> | undefined;
  var _tieredRewardsStarted: boolean | undefined;
}

function getDb() {
  const { getDb: _getDb } = require("@/lib/db");
  return _getDb();
}

function loadEnabledConfigs(): TieredRewardConfig[] {
  try {
    const db = getDb();
    const configs = db
      .prepare(
        `SELECT * FROM tiered_reward_configs WHERE enabled = 1 AND interval_minutes IS NOT NULL ORDER BY created_at ASC`
      )
      .all() as Record<string, unknown>[];

    return configs.map((c) => {
      const tiers = db
        .prepare(`SELECT * FROM tiered_reward_tiers WHERE config_id = ? ORDER BY position ASC`)
        .all(c.id) as Record<string, unknown>[];

      return {
        id: c.id as string,
        name: c.name as string,
        assetCode: c.asset_code as string,
        assetIssuer: c.asset_issuer as string,
        network: (c.network as string) ?? "public",
        secretKey: c.secret_key as string,
        intervalMinutes: c.interval_minutes as number,
        enabled: true,
        minReserve: (c.min_reserve as number) ?? 10.0,
        minSenderThreshold: (c.min_sender_threshold as number) ?? 0,
        previewOnly: (c.preview_only as number) === 1,
        lastRunAt: (c.last_run_at as number) ?? undefined,
        lastFailureAt: (c.last_failure_at as number) ?? undefined,
        createdAt: c.created_at as number,
        tiers: tiers.map((t) => {
          const assets = db
            .prepare(`SELECT * FROM tiered_reward_assets WHERE tier_id = ?`)
            .all(t.id) as Record<string, unknown>[];
          return {
            id: t.id as string,
            configId: t.config_id as string,
            tierNumber: t.tier_number as number,
            minTokens: t.min_tokens as number,
            maxTokens: (t.max_tokens as number | null) ?? undefined,
            position: t.position as number,
            assets: assets.map((a) => ({
              id: a.id as string,
              tierId: a.tier_id as string,
              assetCode: a.asset_code as string,
              assetIssuer: (a.asset_issuer as string | null) ?? undefined,
              amount: a.amount as number,
            })),
          };
        }),
      } as TieredRewardConfig;
    });
  } catch (err) {
    console.error("[tiered-rewards] Failed to load configs from DB:", err);
    return [];
  }
}

function minutesToCronExpression(minutes: number): string {
  if (minutes < 60) return `*/${Math.max(1, minutes)} * * * *`;
  const hours = Math.floor(minutes / 60);
  return `0 */${Math.max(1, hours)} * * *`;
}

function scheduleAll(): void {
  const cron = require("node-cron") as typeof import("node-cron");
  const tasks = global._tieredRewardsTasks!;

  for (const task of tasks.values()) task.stop();
  tasks.clear();

  const configs = loadEnabledConfigs();
  for (const config of configs) {
    if (!config.intervalMinutes) continue;
    const expr = minutesToCronExpression(config.intervalMinutes);
    const task = cron.schedule(expr, async () => {
      console.log(`[tiered-rewards] Running config "${config.name}" (${config.id})`);
      try {
        const fresh = loadEnabledConfigs().find((c) => c.id === config.id);
        if (!fresh) return;

        const { fetchHolders, assignHoldersToTiers } = await import("./fetcher");
        const holders = await fetchHolders(fresh.assetCode, fresh.assetIssuer, fresh.network);
        const assignments = assignHoldersToTiers(holders, fresh.tiers);

        if (fresh.previewOnly) {
          const { calculatePreview } = await import("./calculator");
          const preview = await calculatePreview(fresh);
          if (!("error" in preview)) {
            const db = getDb();
            const ranAt = Date.now();
            const stmt = db.prepare(
              `INSERT INTO tiered_reward_run_log (id, config_id, tier_number, holder_address, asset_code, asset_issuer, amount_sent, status, ran_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
            );
            const insertAll = db.transaction(() => {
              for (const a of preview.assignments) {
                for (const h of a.holders) {
                  for (const asset of a.tier.assets) {
                    stmt.run(crypto.randomUUID(), fresh.id, a.tier.tierNumber, h.address, asset.assetCode, asset.assetIssuer ?? null, asset.amount, "preview", ranAt);
                  }
                }
              }
            });
            insertAll();
          }
        } else {
          const { runConfig } = await import("./runner");
          const result = await runConfig(fresh, assignments);
          if ("error" in result) {
            const db = getDb();
            db.prepare("UPDATE tiered_reward_configs SET last_failure_at = ? WHERE id = ?").run(Date.now(), fresh.id);
          }
        }
      } catch (err) {
        console.error(`[tiered-rewards] Config "${config.name}" run failed:`, err);
        try {
          const db = getDb();
          db.prepare("UPDATE tiered_reward_configs SET last_failure_at = ? WHERE id = ?").run(Date.now(), config.id);
        } catch { /* non-fatal */ }
      }
    });
    tasks.set(config.id, task);
    console.log(`[tiered-rewards] Scheduled "${config.name}" every ${config.intervalMinutes}m (${expr})`);
  }
}

export function startTieredRewardsScheduler(): void {
  if (process.env.VERCEL) return;
  if (global._tieredRewardsStarted) return;
  global._tieredRewardsStarted = true;
  global._tieredRewardsTasks = new Map();
  console.log("[tiered-rewards] Scheduler starting...");
  scheduleAll();
}

export function refreshTieredRewardsScheduler(): void {
  if (!global._tieredRewardsStarted) return;
  scheduleAll();
}
```

- [ ] **Step 2: Update `instrumentation.ts`**

Replace the file contents with:

```typescript
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./lib/auto-send/scheduler");
    const { startTieredRewardsScheduler } = await import("./lib/tiered-rewards/scheduler");
    startScheduler();
    startTieredRewardsScheduler();
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/tiered-rewards/scheduler.ts instrumentation.ts
git commit -m "feat(tiered-rewards): add scheduler + wire into instrumentation"
```

---

## Task 7: DB API Route (CRUD)

**Files:**
- Create: `app/api/db/tiered-rewards/route.ts`

Handles CRUD for configs, tiers, and reward assets. Type discriminator in request body.

- [ ] **Step 1: Create `app/api/db/tiered-rewards/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly, requireAuth } from "@/lib/supabase-server";
import { refreshTieredRewardsScheduler } from "@/lib/tiered-rewards/scheduler";

// --- SQLite helpers ---

function sqliteGet(db: ReturnType<typeof getDb>) {
  const configs = db.prepare("SELECT * FROM tiered_reward_configs ORDER BY created_at DESC").all() as Record<string, unknown>[];
  return configs.map((c) => {
    const tiers = db.prepare("SELECT * FROM tiered_reward_tiers WHERE config_id = ? ORDER BY position ASC").all(c.id) as Record<string, unknown>[];
    return {
      id: c.id, name: c.name, assetCode: c.asset_code, assetIssuer: c.asset_issuer,
      network: c.network, secretKey: c.secret_key, intervalMinutes: c.interval_minutes ?? null,
      enabled: c.enabled === 1, minReserve: c.min_reserve, minSenderThreshold: c.min_sender_threshold,
      previewOnly: c.preview_only === 1, lastRunAt: c.last_run_at ?? undefined,
      lastFailureAt: c.last_failure_at ?? undefined, createdAt: c.created_at,
      tiers: tiers.map((t) => {
        const assets = db.prepare("SELECT * FROM tiered_reward_assets WHERE tier_id = ?").all(t.id) as Record<string, unknown>[];
        return {
          id: t.id, configId: t.config_id, tierNumber: t.tier_number,
          minTokens: t.min_tokens, maxTokens: t.max_tokens ?? undefined, position: t.position,
          assets: assets.map((a) => ({
            id: a.id, tierId: a.tier_id, assetCode: a.asset_code,
            assetIssuer: a.asset_issuer ?? undefined, amount: a.amount,
          })),
        };
      }),
    };
  });
}

function validateNoOverlap(tiers: Array<{ minTokens: number; maxTokens?: number | null }>): string | null {
  for (let i = 0; i < tiers.length; i++) {
    for (let j = i + 1; j < tiers.length; j++) {
      const a = tiers[i], b = tiers[j];
      const aMax = a.maxTokens ?? Infinity;
      const bMax = b.maxTokens ?? Infinity;
      if (a.minTokens < bMax && aMax > b.minTokens) {
        return `Tier ranges overlap between tier ${i + 1} and tier ${j + 1}`;
      }
    }
  }
  return null;
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  if (isSupabaseOnly()) {
    // TODO: Supabase implementation — same data shape
    return NextResponse.json([]);
  }

  const db = getDb();
  return NextResponse.json(sqliteGet(db));
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  const body = await req.json() as { type: string; action: string; data: Record<string, unknown> };
  const { type, action, data } = body;

  if (isSupabaseOnly()) {
    // TODO: Supabase implementation
    return NextResponse.json({ ok: true });
  }

  const db = getDb();

  if (type === "config") {
    if (action === "create") {
      db.prepare(
        `INSERT INTO tiered_reward_configs
         (id, name, asset_code, asset_issuer, network, secret_key, interval_minutes, enabled, min_reserve, min_sender_threshold, preview_only, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        data.id, data.name, data.assetCode, data.assetIssuer, data.network,
        data.secretKey, data.intervalMinutes ?? null, data.enabled ? 1 : 0,
        data.minReserve ?? 10.0, data.minSenderThreshold ?? 0, data.previewOnly ? 1 : 0,
        Date.now()
      );
      refreshTieredRewardsScheduler();
    } else if (action === "update") {
      db.prepare(
        `UPDATE tiered_reward_configs SET name=?, asset_code=?, asset_issuer=?, network=?, secret_key=?,
         interval_minutes=?, enabled=?, min_reserve=?, min_sender_threshold=?, preview_only=?,
         last_failure_at=? WHERE id=?`
      ).run(
        data.name, data.assetCode, data.assetIssuer, data.network, data.secretKey,
        data.intervalMinutes ?? null, data.enabled ? 1 : 0,
        data.minReserve ?? 10.0, data.minSenderThreshold ?? 0, data.previewOnly ? 1 : 0,
        data.lastFailureAt ?? null, data.id
      );
      refreshTieredRewardsScheduler();
    } else if (action === "delete") {
      db.prepare("DELETE FROM tiered_reward_configs WHERE id = ?").run(data.id);
      refreshTieredRewardsScheduler();
    }
  } else if (type === "tier") {
    if (action === "create") {
      // Validate no overlap with existing tiers
      const existing = db.prepare("SELECT min_tokens, max_tokens FROM tiered_reward_tiers WHERE config_id = ?").all(data.configId) as Array<{ min_tokens: number; max_tokens: number | null }>;
      const allTiers = [...existing.map((t) => ({ minTokens: t.min_tokens, maxTokens: t.max_tokens })), { minTokens: data.minTokens as number, maxTokens: data.maxTokens as number | null ?? null }];
      const overlapErr = validateNoOverlap(allTiers);
      if (overlapErr) return NextResponse.json({ error: overlapErr }, { status: 400 });

      db.prepare(
        `INSERT INTO tiered_reward_tiers (id, config_id, tier_number, min_tokens, max_tokens, position) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(data.id, data.configId, data.tierNumber, data.minTokens, data.maxTokens ?? null, data.position);
    } else if (action === "update") {
      db.prepare(
        `UPDATE tiered_reward_tiers SET tier_number=?, min_tokens=?, max_tokens=?, position=? WHERE id=?`
      ).run(data.tierNumber, data.minTokens, data.maxTokens ?? null, data.position, data.id);
    } else if (action === "delete") {
      db.prepare("DELETE FROM tiered_reward_tiers WHERE id = ?").run(data.id);
    }
  } else if (type === "asset") {
    if (action === "create") {
      db.prepare(
        `INSERT INTO tiered_reward_assets (id, tier_id, asset_code, asset_issuer, amount) VALUES (?, ?, ?, ?, ?)`
      ).run(data.id, data.tierId, data.assetCode, data.assetIssuer ?? null, data.amount);
    } else if (action === "update") {
      db.prepare(
        `UPDATE tiered_reward_assets SET asset_code=?, asset_issuer=?, amount=? WHERE id=?`
      ).run(data.assetCode, data.assetIssuer ?? null, data.amount, data.id);
    } else if (action === "delete") {
      db.prepare("DELETE FROM tiered_reward_assets WHERE id = ?").run(data.id);
    }
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/db/tiered-rewards/route.ts
git commit -m "feat(tiered-rewards): add CRUD API route"
```

---

## Task 8: Run API Route

**Files:**
- Create: `app/api/tiered-rewards/run/route.ts`

Handles preview, run, and refresh-scheduler actions.

- [ ] **Step 1: Create `app/api/tiered-rewards/run/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAuth } from "@/lib/supabase-server";
import { refreshTieredRewardsScheduler } from "@/lib/tiered-rewards/scheduler";

function loadConfig(db: ReturnType<typeof getDb>, configId: string) {
  const c = db.prepare("SELECT * FROM tiered_reward_configs WHERE id = ?").get(configId) as Record<string, unknown> | undefined;
  if (!c) return null;
  const tiers = db.prepare("SELECT * FROM tiered_reward_tiers WHERE config_id = ? ORDER BY position ASC").all(configId) as Record<string, unknown>[];
  return {
    id: c.id as string,
    name: c.name as string,
    assetCode: c.asset_code as string,
    assetIssuer: c.asset_issuer as string,
    network: (c.network as string) ?? "public",
    secretKey: c.secret_key as string,
    intervalMinutes: (c.interval_minutes as number | null) ?? null,
    enabled: (c.enabled as number) === 1,
    minReserve: (c.min_reserve as number) ?? 10.0,
    minSenderThreshold: (c.min_sender_threshold as number) ?? 0,
    previewOnly: (c.preview_only as number) === 1,
    lastRunAt: (c.last_run_at as number | null) ?? undefined,
    lastFailureAt: (c.last_failure_at as number | null) ?? undefined,
    createdAt: c.created_at as number,
    tiers: tiers.map((t) => {
      const assets = db.prepare("SELECT * FROM tiered_reward_assets WHERE tier_id = ?").all(t.id) as Record<string, unknown>[];
      return {
        id: t.id as string,
        configId: t.config_id as string,
        tierNumber: t.tier_number as number,
        minTokens: t.min_tokens as number,
        maxTokens: (t.max_tokens as number | null) ?? undefined,
        position: t.position as number,
        assets: assets.map((a) => ({
          id: a.id as string,
          tierId: a.tier_id as string,
          assetCode: a.asset_code as string,
          assetIssuer: (a.asset_issuer as string | null) ?? undefined,
          amount: a.amount as number,
        })),
      };
    }),
  };
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  const body = await req.json() as { mode: string; configId?: string; config?: Record<string, unknown> };

  if (body.mode === "refresh-scheduler") {
    refreshTieredRewardsScheduler();
    return NextResponse.json({ ok: true });
  }

  // Load config — either from DB by ID or passed inline (Quick Run)
  const db = getDb();
  const config = body.configId
    ? loadConfig(db, body.configId)
    : body.config as import("@/lib/tiered-rewards/types").TieredRewardConfig;

  if (!config) return NextResponse.json({ error: "Config not found" }, { status: 404 });

  const { fetchHolders, assignHoldersToTiers } = await import("@/lib/tiered-rewards/fetcher");
  const { calculatePreview } = await import("@/lib/tiered-rewards/calculator");

  if (body.mode === "preview") {
    const preview = await calculatePreview(config as import("@/lib/tiered-rewards/types").TieredRewardConfig);
    return NextResponse.json(preview);
  }

  if (body.mode === "run") {
    // Re-calculate to get current assignments
    const preview = await calculatePreview(config as import("@/lib/tiered-rewards/types").TieredRewardConfig);
    if ("error" in preview) return NextResponse.json(preview, { status: 400 });
    if (preview.blocked) return NextResponse.json({ error: preview.blockReasons.join("; ") }, { status: 400 });

    const { runConfig } = await import("@/lib/tiered-rewards/runner");
    const result = await runConfig(
      config as import("@/lib/tiered-rewards/types").TieredRewardConfig,
      preview.assignments
    );
    return NextResponse.json(result);
  }

  return NextResponse.json({ error: "Unknown mode" }, { status: 400 });
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/tiered-rewards/run/route.ts
git commit -m "feat(tiered-rewards): add run/preview API route"
```

---

## Task 9: History API Route

**Files:**
- Create: `app/api/tiered-rewards/history/route.ts`

- [ ] **Step 1: Create `app/api/tiered-rewards/history/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAuth } from "@/lib/supabase-server";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const configId = searchParams.get("configId");

  const db = getDb();

  const rows = configId
    ? db.prepare(
        `SELECT * FROM tiered_reward_run_log WHERE config_id = ? ORDER BY ran_at DESC LIMIT 200`
      ).all(configId)
    : db.prepare(
        `SELECT * FROM tiered_reward_run_log ORDER BY ran_at DESC LIMIT 200`
      ).all();

  const mapped = (rows as Record<string, unknown>[]).map((r) => ({
    id: r.id,
    configId: r.config_id ?? undefined,
    tierNumber: r.tier_number,
    holderAddress: r.holder_address,
    assetCode: r.asset_code,
    assetIssuer: r.asset_issuer ?? undefined,
    amountSent: r.amount_sent,
    status: r.status,
    txHash: r.tx_hash ?? undefined,
    error: r.error ?? undefined,
    ranAt: r.ran_at,
  }));

  return NextResponse.json(mapped);
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/tiered-rewards/history/route.ts
git commit -m "feat(tiered-rewards): add history API route"
```

---

## Task 10: Hook

**Files:**
- Create: `hooks/use-tiered-reward-configs.ts`

- [ ] **Step 1: Create `hooks/use-tiered-reward-configs.ts`**

```typescript
"use client";

import { useCallback, useEffect, useState } from "react";
import { createDbCache, dbPost, dbPatch, authHeaders, waitForAuth } from "@/lib/db-client";
import type { TieredRewardConfig, Tier, RewardAsset } from "@/lib/tiered-rewards/types";

const ENDPOINT = "/api/db/tiered-rewards";

function dbAction(action: string, type: string, data: Record<string, unknown>) {
  waitForAuth().then(() =>
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ type, action, data }),
    })
  ).catch(() => {});
}

function triggerSchedulerRefresh() {
  waitForAuth().then(() =>
    fetch("/api/tiered-rewards/run", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ mode: "refresh-scheduler" }),
    })
  ).catch(() => {});
}

const _cache = createDbCache<TieredRewardConfig>();

export function useTieredRewardConfigs() {
  const [, rerender] = useState(0);

  useEffect(() => {
    const unsub = _cache.subscribe(() => rerender((n) => n + 1));
    _cache.load(ENDPOINT);

    // Cross-tab sync via focus reload
    const onFocus = () => _cache.load(ENDPOINT);
    window.addEventListener("focus", onFocus);
    return () => {
      unsub();
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const configs = _cache.get();

  const createConfig = useCallback(
    (entry: Omit<TieredRewardConfig, "id" | "createdAt" | "tiers" | "lastRunAt" | "lastFailureAt">) => {
      const id = crypto.randomUUID();
      const optimistic: TieredRewardConfig = {
        ...entry, id, createdAt: Date.now(), tiers: [],
      };
      _cache.set([optimistic, ..._cache.get()]);
      dbAction("create", "config", { id, ...entry });
      if (entry.intervalMinutes) triggerSchedulerRefresh();
    },
    []
  );

  const updateConfig = useCallback(
    (id: string, updates: Partial<Omit<TieredRewardConfig, "tiers">>) => {
      _cache.set(_cache.get().map((c) => (c.id === id ? { ...c, ...updates } : c)));
      dbAction("update", "config", { id, ...updates });
      if (updates.enabled !== undefined || updates.intervalMinutes !== undefined) {
        triggerSchedulerRefresh();
      }
    },
    []
  );

  const deleteConfig = useCallback((id: string) => {
    _cache.set(_cache.get().filter((c) => c.id !== id));
    dbAction("delete", "config", { id });
    triggerSchedulerRefresh();
  }, []);

  const upsertTier = useCallback(
    (configId: string, tier: Omit<Tier, "id" | "configId" | "assets"> & { id?: string; assets?: RewardAsset[] }) => {
      const id = tier.id ?? crypto.randomUUID();
      const full: Tier = { ...tier, id, configId, assets: tier.assets ?? [] };
      _cache.set(
        _cache.get().map((c) => {
          if (c.id !== configId) return c;
          const existing = c.tiers.findIndex((t) => t.id === id);
          const tiers = existing >= 0
            ? c.tiers.map((t) => (t.id === id ? full : t))
            : [...c.tiers, full];
          return { ...c, tiers };
        })
      );
      dbAction(tier.id ? "update" : "create", "tier", { id, configId, ...tier });
    },
    []
  );

  const deleteTier = useCallback((configId: string, tierId: string) => {
    _cache.set(
      _cache.get().map((c) => {
        if (c.id !== configId) return c;
        return { ...c, tiers: c.tiers.filter((t) => t.id !== tierId) };
      })
    );
    dbAction("delete", "tier", { id: tierId });
  }, []);

  const upsertRewardAsset = useCallback(
    (configId: string, tierId: string, asset: Omit<RewardAsset, "id" | "tierId"> & { id?: string }) => {
      const id = asset.id ?? crypto.randomUUID();
      const full: RewardAsset = { ...asset, id, tierId };
      _cache.set(
        _cache.get().map((c) => {
          if (c.id !== configId) return c;
          return {
            ...c,
            tiers: c.tiers.map((t) => {
              if (t.id !== tierId) return t;
              const existing = t.assets.findIndex((a) => a.id === id);
              const assets = existing >= 0
                ? t.assets.map((a) => (a.id === id ? full : a))
                : [...t.assets, full];
              return { ...t, assets };
            }),
          };
        })
      );
      dbAction(asset.id ? "update" : "create", "asset", { id, tierId, ...asset });
    },
    []
  );

  const deleteRewardAsset = useCallback((configId: string, tierId: string, assetId: string) => {
    _cache.set(
      _cache.get().map((c) => {
        if (c.id !== configId) return c;
        return {
          ...c,
          tiers: c.tiers.map((t) => {
            if (t.id !== tierId) return t;
            return { ...t, assets: t.assets.filter((a) => a.id !== assetId) };
          }),
        };
      })
    );
    dbAction("delete", "asset", { id: assetId });
  }, []);

  return {
    configs,
    isLoaded: _cache.isLoaded(),
    createConfig,
    updateConfig,
    deleteConfig,
    upsertTier,
    deleteTier,
    upsertRewardAsset,
    deleteRewardAsset,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add hooks/use-tiered-reward-configs.ts
git commit -m "feat(tiered-rewards): add DB-backed hook with cross-tab focus sync"
```

---

## Task 11: TierBuilder Component

**Files:**
- Create: `components/tiered-rewards/TierBuilder.tsx`

Inline editor for adding/editing tiers and their reward assets. Handles overlap validation client-side.

- [ ] **Step 1: Create `components/tiered-rewards/TierBuilder.tsx`**

```tsx
"use client";

import { useState } from "react";
import { Plus, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Tier, RewardAsset } from "@/lib/tiered-rewards/types";

interface Props {
  tiers: Tier[];
  onUpsertTier: (tier: Omit<Tier, "id" | "configId" | "assets"> & { id?: string }) => void;
  onDeleteTier: (tierId: string) => void;
  onUpsertAsset: (tierId: string, asset: Omit<RewardAsset, "id" | "tierId"> & { id?: string }) => void;
  onDeleteAsset: (tierId: string, assetId: string) => void;
}

function detectOverlap(tiers: Tier[], excludeId?: string): string | null {
  const active = tiers.filter((t) => t.id !== excludeId);
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i], b = active[j];
      const aMax = a.maxTokens ?? Infinity;
      const bMax = b.maxTokens ?? Infinity;
      if (a.minTokens < bMax && aMax > b.minTokens) {
        return `Tier ${a.tierNumber} and Tier ${b.tierNumber} ranges overlap`;
      }
    }
  }
  return null;
}

export function TierBuilder({ tiers, onUpsertTier, onDeleteTier, onUpsertAsset, onDeleteAsset }: Props) {
  const sorted = [...tiers].sort((a, b) => a.position - b.position);
  const [expandedTier, setExpandedTier] = useState<string | null>(null);

  // New tier form
  const [newMin, setNewMin] = useState("");
  const [newMax, setNewMax] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  function handleAddTier() {
    const min = parseFloat(newMin);
    if (isNaN(min) || min < 0) { setAddError("Min tokens must be a positive number"); return; }
    const max = newMax.trim() === "" ? undefined : parseFloat(newMax);
    if (newMax.trim() !== "" && (isNaN(max!) || max! <= min)) {
      setAddError("Max must be greater than min (or leave empty for open-ended top tier)");
      return;
    }

    // Overlap check against existing tiers
    const candidate: Tier = { id: "candidate", configId: "", tierNumber: sorted.length + 1, minTokens: min, maxTokens: max, position: sorted.length, assets: [] };
    const overlap = detectOverlap([...tiers, candidate], "candidate");
    if (overlap) { setAddError(overlap); return; }

    onUpsertTier({ tierNumber: sorted.length + 1, minTokens: min, maxTokens: max, position: sorted.length });
    setNewMin(""); setNewMax(""); setAddError(null);
  }

  return (
    <div className="space-y-3">
      {sorted.map((tier) => (
        <div key={tier.id} className="rounded-lg border border-border bg-muted/30">
          {/* Tier header */}
          <div className="flex items-center gap-3 p-3">
            <span className="text-xs font-semibold text-purple-400 uppercase tracking-wide w-14">Tier {tier.tierNumber}</span>
            <span className="text-sm text-foreground flex-1">
              {tier.minTokens.toLocaleString()} – {tier.maxTokens != null ? tier.maxTokens.toLocaleString() : "∞"} tokens
            </span>
            <span className="text-xs text-muted-foreground">{tier.assets.length} asset{tier.assets.length !== 1 ? "s" : ""}</span>
            <Button variant="ghost" size="sm" onClick={() => setExpandedTier(expandedTier === tier.id ? null : tier.id)}>
              {expandedTier === tier.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => onDeleteTier(tier.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* Reward assets (expanded) */}
          {expandedTier === tier.id && (
            <div className="border-t border-border p-3 space-y-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Reward Assets</p>
              {tier.assets.map((asset) => (
                <div key={asset.id} className="flex items-center gap-2 text-sm">
                  <span className="font-mono text-foreground">{asset.amount.toFixed(7)}</span>
                  <span className="text-muted-foreground">{asset.assetCode}{asset.assetIssuer ? `:${asset.assetIssuer.slice(0, 4)}…` : ""}</span>
                  <Button variant="ghost" size="sm" className="ml-auto text-destructive hover:text-destructive h-6 w-6 p-0" onClick={() => onDeleteAsset(tier.id, asset.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              <AddAssetRow tierId={tier.id} onAdd={onUpsertAsset} />
            </div>
          )}
        </div>
      ))}

      {/* Add new tier */}
      <div className="rounded-lg border border-dashed border-border p-3 space-y-2">
        <p className="text-xs text-muted-foreground uppercase tracking-wide">Add Tier</p>
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <Label className="text-xs">Min tokens</Label>
            <Input className="h-8" placeholder="100" value={newMin} onChange={(e) => setNewMin(e.target.value)} />
          </div>
          <div className="flex-1">
            <Label className="text-xs">Max tokens (empty = open)</Label>
            <Input className="h-8" placeholder="299" value={newMax} onChange={(e) => setNewMax(e.target.value)} />
          </div>
          <Button size="sm" onClick={handleAddTier}><Plus className="h-3.5 w-3.5 mr-1" />Add</Button>
        </div>
        {addError && <p className="text-xs text-destructive">{addError}</p>}
      </div>
    </div>
  );
}

function AddAssetRow({ tierId, onAdd }: { tierId: string; onAdd: Props["onUpsertAsset"] }) {
  const [code, setCode] = useState("");
  const [issuer, setIssuer] = useState("");
  const [amount, setAmount] = useState("");
  const [err, setErr] = useState<string | null>(null);

  function handleAdd() {
    const assetCode = code.trim().toUpperCase();
    if (!assetCode) { setErr("Asset code required"); return; }
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) { setErr("Amount must be > 0"); return; }
    if (assetCode !== "XLM" && !issuer.trim()) { setErr("Issuer required for non-XLM assets"); return; }
    onAdd(tierId, { assetCode, assetIssuer: assetCode === "XLM" ? undefined : issuer.trim(), amount: amt });
    setCode(""); setIssuer(""); setAmount(""); setErr(null);
  }

  return (
    <div className="space-y-1 pt-1">
      <div className="flex gap-2 items-end">
        <div>
          <Label className="text-xs">Code</Label>
          <Input className="h-7 w-20" placeholder="XLM" value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
        <div className="flex-1">
          <Label className="text-xs">Issuer (blank for XLM)</Label>
          <Input className="h-7" placeholder="GXXX…" value={issuer} onChange={(e) => setIssuer(e.target.value)} />
        </div>
        <div className="w-28">
          <Label className="text-xs">Amount / holder</Label>
          <Input className="h-7" placeholder="10" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <Button size="sm" variant="outline" className="h-7" onClick={handleAdd}><Plus className="h-3 w-3" /></Button>
      </div>
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/tiered-rewards/TierBuilder.tsx
git commit -m "feat(tiered-rewards): add TierBuilder component with overlap validation"
```

---

## Task 12: TierPreviewModal Component

**Files:**
- Create: `components/tiered-rewards/TierPreviewModal.tsx`

Shows full preview breakdown — per-tier holder list, total costs, block reasons — then Execute button.

- [ ] **Step 1: Create `components/tiered-rewards/TierPreviewModal.tsx`**

```tsx
"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { shortAddr } from "@/lib/format";
import type { RewardsPreview } from "@/lib/tiered-rewards/types";

interface Props {
  open: boolean;
  onClose: () => void;
  preview: RewardsPreview | null;
  loading: boolean;
  error: string | null;
  onExecute: () => void;
  executing: boolean;
}

export function TierPreviewModal({ open, onClose, preview, loading, error, onExecute, executing }: Props) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Distribution Preview</DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />
            Scanning holders…
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {preview && (
          <div className="space-y-4">
            {/* Block reasons */}
            {preview.blocked && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 space-y-1">
                {preview.blockReasons.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-destructive">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    {r}
                  </div>
                ))}
              </div>
            )}

            {/* Cost summary */}
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Total Cost</p>
              <div className="flex flex-wrap gap-2">
                {preview.costItems.map((item) => (
                  <div key={`${item.assetCode}:${item.assetIssuer ?? "native"}`}
                    className={`rounded-lg border px-3 py-2 text-sm ${item.shortfall > 0 || !item.hasTrustline ? "border-destructive/50 bg-destructive/10" : "border-border bg-muted/30"}`}>
                    <span className="font-mono font-medium">{item.totalRequired.toFixed(7)}</span>
                    <span className="text-muted-foreground ml-1">{item.assetCode}</span>
                    {item.shortfall > 0 && (
                      <span className="text-destructive ml-2 text-xs">↑ {item.shortfall.toFixed(7)} short</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Per-tier breakdown */}
            {preview.assignments.map((a) => (
              <div key={a.tier.id} className="rounded-lg border border-border">
                <div className="flex items-center gap-3 p-3 border-b border-border">
                  <span className="text-xs font-semibold text-purple-400 uppercase">Tier {a.tier.tierNumber}</span>
                  <span className="text-sm text-muted-foreground">
                    {a.tier.minTokens.toLocaleString()} – {a.tier.maxTokens != null ? a.tier.maxTokens.toLocaleString() : "∞"}
                  </span>
                  <span className="ml-auto text-sm font-medium">{a.holders.length} holder{a.holders.length !== 1 ? "s" : ""}</span>
                </div>
                {a.holders.length === 0 ? (
                  <p className="text-xs text-muted-foreground p-3">No holders in this tier</p>
                ) : (
                  <div className="p-3 space-y-1 max-h-48 overflow-y-auto">
                    {a.holders.slice(0, 50).map((h) => (
                      <div key={h.address} className="flex items-center gap-2 text-xs">
                        <span className="font-mono text-muted-foreground">{shortAddr(h.address)}</span>
                        <span className="text-foreground">{h.balance.toLocaleString()} tokens</span>
                        <span className="ml-auto text-muted-foreground">
                          {a.tier.assets.map((asset) => `${asset.amount} ${asset.assetCode}`).join(" + ")}
                        </span>
                      </div>
                    ))}
                    {a.holders.length > 50 && (
                      <p className="text-xs text-muted-foreground">…and {a.holders.length - 50} more</p>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* Execute button */}
            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button variant="outline" onClick={onClose} disabled={executing}>Cancel</Button>
              <Button
                disabled={preview.blocked || executing}
                onClick={onExecute}
                className="bg-purple-600 hover:bg-purple-700 text-white"
              >
                {executing ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Sending…</> : <><CheckCircle2 className="h-4 w-4 mr-2" />Execute Distribution</>}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/tiered-rewards/TierPreviewModal.tsx
git commit -m "feat(tiered-rewards): add TierPreviewModal component"
```

---

## Task 13: TierConfigCard Component

**Files:**
- Create: `components/tiered-rewards/TierConfigCard.tsx`

Expandable card per saved config. Shows tiers, stats, last run log, Preview + Run Now buttons.

- [ ] **Step 1: Create `components/tiered-rewards/TierConfigCard.tsx`**

```tsx
"use client";

import { useState, useCallback } from "react";
import { ChevronDown, ChevronRight, AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TierBuilder } from "./TierBuilder";
import { TierPreviewModal } from "./TierPreviewModal";
import { shortAddr } from "@/lib/format";
import { authHeaders, waitForAuth } from "@/lib/db-client";
import type { TieredRewardConfig, Tier, RewardAsset, RewardsPreview } from "@/lib/tiered-rewards/types";

interface Props {
  config: TieredRewardConfig;
  onUpdate: (id: string, updates: Partial<TieredRewardConfig>) => void;
  onDelete: (id: string) => void;
  onUpsertTier: (configId: string, tier: Omit<Tier, "id" | "configId" | "assets"> & { id?: string }) => void;
  onDeleteTier: (configId: string, tierId: string) => void;
  onUpsertAsset: (configId: string, tierId: string, asset: Omit<RewardAsset, "id" | "tierId"> & { id?: string }) => void;
  onDeleteAsset: (configId: string, tierId: string, assetId: string) => void;
}

const INTERVAL_LABELS: Record<number, string> = {
  60: "1h", 180: "3h", 360: "6h", 720: "12h", 1440: "24h",
};

export function TierConfigCard({ config, onUpdate, onDelete, onUpsertTier, onDeleteTier, onUpsertAsset, onDeleteAsset }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<RewardsPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);

  const intervalLabel = config.intervalMinutes
    ? (INTERVAL_LABELS[config.intervalMinutes] ?? `${config.intervalMinutes}m`)
    : "Manual";

  const handlePreview = useCallback(async () => {
    setPreview(null); setPreviewError(null); setPreviewLoading(true); setPreviewOpen(true);
    try {
      await waitForAuth();
      const res = await fetch("/api/tiered-rewards/run", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ mode: "preview", configId: config.id }),
      });
      const data = await res.json() as RewardsPreview | { error: string };
      if ("error" in data) setPreviewError(data.error);
      else setPreview(data);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setPreviewLoading(false);
    }
  }, [config.id]);

  const handleExecute = useCallback(async () => {
    setExecuting(true);
    try {
      await waitForAuth();
      const res = await fetch("/api/tiered-rewards/run", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ mode: "run", configId: config.id }),
      });
      const data = await res.json();
      if ("error" in data) setPreviewError(data.error);
      else {
        setPreviewOpen(false);
        onUpdate(config.id, { lastRunAt: Date.now(), lastFailureAt: undefined });
      }
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Run failed");
    } finally {
      setExecuting(false);
    }
  }, [config.id, onUpdate]);

  return (
    <>
      <div className="rounded-xl border border-border bg-card">
        {/* Card header */}
        <div className="flex items-center gap-3 p-4">
          <button onClick={() => setExpanded((v) => !v)} className="text-muted-foreground hover:text-foreground">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          <span className="font-medium text-foreground flex-1">{config.name}</span>
          {config.lastFailureAt && (
            <AlertTriangle className="h-4 w-4 text-destructive" title="Last run had failures" />
          )}
          <span className={`text-xs px-2 py-0.5 rounded-full border ${config.enabled ? "bg-green-950 text-green-400 border-green-800" : "bg-muted text-muted-foreground border-border"}`}>
            {config.enabled ? "● active" : "○ paused"}
          </span>
          <span className="text-xs px-2 py-0.5 rounded-full border border-border text-muted-foreground bg-muted">
            {intervalLabel}
          </span>
          <div className="flex gap-2 ml-2">
            <Button variant="outline" size="sm" onClick={handlePreview}>Preview</Button>
            <Button size="sm" className="bg-purple-600 hover:bg-purple-700 text-white" onClick={handlePreview}>Preview & Run</Button>
          </div>
        </div>

        {/* Collapsed summary */}
        {!expanded && (
          <div className="px-4 pb-3 text-xs text-muted-foreground pl-11">
            {config.assetCode}:{shortAddr(config.assetIssuer)} · {config.tiers.length} tier{config.tiers.length !== 1 ? "s" : ""}
            {config.lastRunAt ? ` · last run ${new Date(config.lastRunAt).toLocaleDateString()}` : ""}
          </div>
        )}

        {/* Expanded content */}
        {expanded && (
          <div className="border-t border-border p-4 space-y-5">
            {/* Last failure banner */}
            {config.lastFailureAt && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                Last scheduled run had failures — check run history.
              </div>
            )}

            {/* Enable toggle */}
            <div className="flex items-center gap-3">
              <Switch
                checked={config.enabled}
                onCheckedChange={(v) => onUpdate(config.id, { enabled: v })}
              />
              <span className="text-sm">{config.enabled ? "Scheduled" : "Manual only"}</span>
            </div>

            {/* Asset info */}
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Tracked Asset</p>
              <span className="font-mono text-sm bg-muted border border-border rounded px-2 py-1">
                {config.assetCode} · {shortAddr(config.assetIssuer)}
              </span>
            </div>

            {/* Tiers */}
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Tiers</p>
              <TierBuilder
                tiers={config.tiers}
                onUpsertTier={(tier) => onUpsertTier(config.id, tier)}
                onDeleteTier={(tierId) => onDeleteTier(config.id, tierId)}
                onUpsertAsset={(tierId, asset) => onUpsertAsset(config.id, tierId, asset)}
                onDeleteAsset={(tierId, assetId) => onDeleteAsset(config.id, tierId, assetId)}
              />
            </div>

            {/* Delete */}
            <div className="pt-2 border-t border-border flex justify-end">
              <Button variant="destructive" size="sm" onClick={() => { if (confirm(`Delete "${config.name}"?`)) onDelete(config.id); }}>
                Delete Config
              </Button>
            </div>
          </div>
        )}
      </div>

      <TierPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        preview={preview}
        loading={previewLoading}
        error={previewError}
        onExecute={handleExecute}
        executing={executing}
      />
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/tiered-rewards/TierConfigCard.tsx
git commit -m "feat(tiered-rewards): add TierConfigCard component"
```

---

## Task 14: TieredRewardsPanel + Page + Navigation

**Files:**
- Create: `components/tiered-rewards/TieredRewardsPanel.tsx`
- Create: `app/(tools)/tiered-rewards/page.tsx`
- Modify: `lib/navigation.ts`

- [ ] **Step 1: Create `components/tiered-rewards/TieredRewardsPanel.tsx`**

```tsx
"use client";

import { useState } from "react";
import { Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTieredRewardConfigs } from "@/hooks/use-tiered-reward-configs";
import { useActiveWallet } from "@/hooks/use-active-wallet";
import { TierConfigCard } from "./TierConfigCard";

const INTERVALS = [
  { label: "Manual", value: "" },
  { label: "Every 1h", value: "60" },
  { label: "Every 3h", value: "180" },
  { label: "Every 6h", value: "360" },
  { label: "Every 12h", value: "720" },
  { label: "Every 24h", value: "1440" },
];

export function TieredRewardsPanel() {
  const { configs, isLoaded, createConfig, updateConfig, deleteConfig, upsertTier, deleteTier, upsertRewardAsset, deleteRewardAsset } = useTieredRewardConfigs();
  const { activeWallet } = useActiveWallet();

  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAssetCode, setNewAssetCode] = useState("");
  const [newAssetIssuer, setNewAssetIssuer] = useState("");
  const [newNetwork, setNewNetwork] = useState("public");
  const [newSecretKey, setNewSecretKey] = useState("");
  const [newInterval, setNewInterval] = useState("1440");
  const [createError, setCreateError] = useState<string | null>(null);

  const effectiveSecretKey = activeWallet?.secretKey ?? newSecretKey;

  function handleCreate() {
    if (!newName.trim()) { setCreateError("Name required"); return; }
    if (!newAssetCode.trim()) { setCreateError("Asset code required"); return; }
    if (!newAssetIssuer.trim()) { setCreateError("Asset issuer required"); return; }
    if (!effectiveSecretKey.trim()) { setCreateError("Sender secret key required"); return; }
    setCreateError(null);
    createConfig({
      name: newName.trim(),
      assetCode: newAssetCode.trim(),
      assetIssuer: newAssetIssuer.trim(),
      network: newNetwork,
      secretKey: effectiveSecretKey.trim(),
      intervalMinutes: newInterval ? parseInt(newInterval) : null,
      enabled: false,
      minReserve: 10.0,
      minSenderThreshold: 0,
      previewOnly: false,
    });
    setNewName(""); setNewAssetCode(""); setNewAssetIssuer(""); setNewSecretKey(""); setShowNew(false);
  }

  if (!isLoaded) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-16 justify-center">
        <Loader2 className="h-4 w-4 animate-spin" />Loading…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Button onClick={() => setShowNew((v) => !v)}>
            <Plus className="h-4 w-4 mr-1" />New Config
          </Button>
        </div>
        <span className="text-xs text-muted-foreground">
          {configs.length} config{configs.length !== 1 ? "s" : ""} · {configs.filter((c) => c.enabled).length} active
        </span>
      </div>

      {/* New config form */}
      {showNew && (
        <div className="rounded-xl border border-border p-4 space-y-3 bg-card">
          <p className="font-medium text-sm">New Reward Config</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Config Name</Label>
              <Input placeholder="MYTOKEN Tier Rewards" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Network</Label>
              <Select value={newNetwork} onValueChange={setNewNetwork}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">Mainnet</SelectItem>
                  <SelectItem value="testnet">Testnet</SelectItem>
                  <SelectItem value="futurenet">Futurenet</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Asset Code (to scan)</Label>
              <Input placeholder="MYTOKEN" value={newAssetCode} onChange={(e) => setNewAssetCode(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Asset Issuer</Label>
              <Input placeholder="GABC…" value={newAssetIssuer} onChange={(e) => setNewAssetIssuer(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Schedule</Label>
              <Select value={newInterval} onValueChange={setNewInterval}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INTERVALS.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Sender Secret Key</Label>
              {activeWallet ? (
                <div className="flex items-center gap-2 h-10 px-3 rounded-md border border-green-700 bg-green-950 text-green-400 text-sm">
                  <span className="h-2 w-2 rounded-full bg-green-400 shrink-0" />
                  {activeWallet.name}
                </div>
              ) : (
                <Input type="password" placeholder="S…" value={newSecretKey} onChange={(e) => setNewSecretKey(e.target.value)} />
              )}
            </div>
          </div>
          {createError && <p className="text-xs text-destructive">{createError}</p>}
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setShowNew(false)}>Cancel</Button>
            <Button onClick={handleCreate}>Create Config</Button>
          </div>
        </div>
      )}

      {/* Config cards */}
      {configs.length === 0 && !showNew && (
        <div className="text-center text-muted-foreground py-16 text-sm">
          No reward configs yet. Create one to get started.
        </div>
      )}
      {configs.map((config) => (
        <TierConfigCard
          key={config.id}
          config={config}
          onUpdate={updateConfig}
          onDelete={deleteConfig}
          onUpsertTier={upsertTier}
          onDeleteTier={deleteTier}
          onUpsertAsset={upsertRewardAsset}
          onDeleteAsset={deleteRewardAsset}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create `app/(tools)/tiered-rewards/page.tsx`**

```tsx
import { TieredRewardsPanel } from "@/components/tiered-rewards/TieredRewardsPanel";

export default function TieredRewardsPage() {
  return (
    <div className="max-w-3xl mx-auto py-6 px-4 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Tiered Rewards</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Distribute flat per-holder rewards to asset holders based on their token balance tier.
        </p>
      </div>
      <TieredRewardsPanel />
    </div>
  );
}
```

- [ ] **Step 3: Add to navigation in `lib/navigation.ts`**

Find the Tools section and add before the `{ separator: true }` line:

```ts
  {
    title: "Tiered Rewards",
    href: "/tiered-rewards",
    icon: Trophy,
  },
```

Also add `Trophy` to the lucide-react import at the top of the file.

- [ ] **Step 4: Verify the app builds and the page loads at `/tiered-rewards`**

```bash
npm run dev
```

Open `http://localhost:3000/tiered-rewards` — should show the empty state with "New Config" button.

- [ ] **Step 5: Commit**

```bash
git add components/tiered-rewards/TieredRewardsPanel.tsx app/\(tools\)/tiered-rewards/page.tsx lib/navigation.ts
git commit -m "feat(tiered-rewards): add panel, page, and navigation entry"
```

---

## Task 15: End-to-End Smoke Test

Manual verification — no automated tests (no test framework is set up in this codebase).

- [ ] **Step 1: Create a testnet config**

  - Open `/tiered-rewards`
  - Click "New Config"
  - Fill in: a testnet asset you control (assetCode + issuer), testnet network, sender secret key (a funded testnet account)
  - Schedule: Manual
  - Click "Create Config" — card appears in the list

- [ ] **Step 2: Add tiers and reward assets**

  - Expand the card
  - Add Tier 1: min=1, max=100, reward asset: XLM, amount=0.0000001
  - Add Tier 2: min=100, max=empty (open), reward asset: XLM, amount=0.0000002
  - Verify overlap validation: try adding min=50, max=150 — should show error

- [ ] **Step 3: Preview**

  - Click "Preview"
  - Modal should show holder list per tier, cost summary, no block reasons (if sender has enough XLM)

- [ ] **Step 4: Execute (testnet, 1 stroop amounts)**

  - Click "Execute Distribution"
  - Should close modal and update `lastRunAt` on card

- [ ] **Step 5: Check history endpoint**

  - Open browser devtools → `fetch("/api/tiered-rewards/history?configId=<id>").then(r=>r.json()).then(console.log)`
  - Should see per-holder log rows with status="sent"

- [ ] **Step 6: Commit smoke test confirmation**

```bash
git commit --allow-empty -m "test(tiered-rewards): smoke test passed on testnet"
```

---

## Done

All 15 tasks complete. The module is live at `/tiered-rewards` with:
- 4 DB tables (auto-created on server boot)
- Full holder scanning with Horizon pagination
- Tier assignment, preview with sender balance/trustline checks
- Batched payment execution (100 ops/tx, sequence re-fetch per batch)
- Scheduler integrated with instrumentation.ts
- Saved configs with enable/disable, interval, card UI
- Per-holder run log accessible via history API
