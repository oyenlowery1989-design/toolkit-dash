# Asset Creator Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a 4-step wizard module that lets users create a custom Stellar asset end-to-end — account setup, asset config, preflight validation, and execution — with auto-save to Asset Groups.

**Architecture:** Pure lib functions (`types`, `preflight`, `builder`, `runner`, `toml`) consumed by a wizard panel (`AssetCreatorPanel`) with four step components. The panel owns all form state and passes callbacks down. A `CreationStrategy` interface makes the builder pluggable for future variants.

**Tech Stack:** Next.js 15 App Router, React 19, Stellar SDK 13, Radix UI Tabs, Vitest for tests. Settings from `lib/settings.ts`. Groups from `hooks/use-asset-groups.ts`. Active wallet from `hooks/use-active-wallet.ts`.

**Spec:** `docs/superpowers/specs/2026-03-12-asset-creator-design.md`

---

## Chunk 1: Types, TOML, and Navigation

### Task 1: Define all types

**Files:**
- Create: `lib/asset-creator/types.ts`

- [ ] **Step 1: Create the types file**

```ts
// lib/asset-creator/types.ts
import type { Horizon } from "stellar-sdk";
import type { Network } from "@/lib/settings";

export interface AssetCreatorForm {
  network: Network;
  issuerPublicKey: string;
  issuerSecretKey: string;
  distributorPublicKey: string;
  distributorSecretKey: string;
  /** Resolved by panel: activeWallet.secretKey ?? manualFundingSecretKey. Empty string if mainnet funding not needed. */
  resolvedFundingSecretKey: string;
  assetCode: string;     // case preserved — never uppercased
  tokenName: string;     // "" if not provided; TOML only
  supply: number;
  memo: string;          // "" if not provided; applied to issuance tx only
  homeDomain: string;    // "" if not provided
}

export interface SignedTx {
  stepId: "fund-accounts" | "set-home-domain" | "trustline" | "issuance";
  label: string;
  xdr: string;           // base64 XDR of signed transaction envelope
  sourceAccount: string; // account whose sequence number was used
}

export type StepStatus = "pending" | "running" | "success" | "failed" | "skipped";

export interface StepResult {
  stepId: SignedTx["stepId"] | "friendbot";
  status: StepStatus;
  txHash?: string;
  error?: string;
}

export interface PreflightCheck {
  id: string;
  label: string;
  status: "pass" | "fail" | "warning" | "loading";
  message?: string;  // shown on fail/warning
  blocking: boolean; // if true blocks execute; if false requires checkbox ack
}

export interface PreflightResult {
  checks: PreflightCheck[];
  estimatedFeesXlm: string; // e.g. "0.0004"
  allBlockingPassed: boolean;
}

export interface CreationResult {
  steps: StepResult[];
  groupId?: string;
}

export interface CreationStrategy {
  id: string;
  label: string;
  /**
   * Build signed transactions for the given stepIds only.
   * Sequence numbers fetched from Horizon inside this call — never pre-fetched.
   * @param steps - subset of stepIds to build (enables incremental retry)
   * @param signal - AbortSignal for cancelling in-flight Horizon calls
   */
  buildTransactions(
    form: AssetCreatorForm,
    steps: Array<SignedTx["stepId"]>,
    server: Horizon.Server,
    networkPassphrase: string,
    signal: AbortSignal,
  ): Promise<SignedTx[]>;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/asset-creator/types.ts
git commit -m "feat(asset-creator): add core types"
```

---

### Task 2: Implement and test TOML snippet generator

**Files:**
- Create: `lib/asset-creator/toml.ts`
- Create: `tests/lib/asset-creator/toml.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/lib/asset-creator/toml.test.ts
import { describe, it, expect } from "vitest";
import { generateTomlSnippet } from "../../../lib/asset-creator/toml";
import type { AssetCreatorForm } from "../../../lib/asset-creator/types";

const base: AssetCreatorForm = {
  network: "public",
  issuerPublicKey: "GABCDE12345678901234567890123456789012345678901234567890",
  issuerSecretKey: "",
  distributorPublicKey: "GXYZ",
  distributorSecretKey: "",
  resolvedFundingSecretKey: "",
  assetCode: "myTOKEN",
  tokenName: "My Token",
  supply: 1_000_000,
  memo: "",
  homeDomain: "example.com",
};

describe("generateTomlSnippet", () => {
  it("preserves asset code case exactly", () => {
    const snippet = generateTomlSnippet(base);
    expect(snippet).toContain('code = "myTOKEN"');
    expect(snippet).not.toContain('code = "MYTOKEN"');
  });

  it("uses full issuer public key (not truncated)", () => {
    const snippet = generateTomlSnippet(base);
    expect(snippet).toContain(`issuer = "${base.issuerPublicKey}"`);
  });

  it("hardcodes display_decimals = 7", () => {
    const snippet = generateTomlSnippet(base);
    expect(snippet).toContain("display_decimals = 7");
  });

  it("includes token name when provided", () => {
    const snippet = generateTomlSnippet(base);
    expect(snippet).toContain('name = "My Token"');
  });

  it("leaves name empty when tokenName is empty string", () => {
    const snippet = generateTomlSnippet({ ...base, tokenName: "" });
    expect(snippet).toContain('name = ""');
  });

  it("includes all required TOML fields", () => {
    const snippet = generateTomlSnippet(base);
    expect(snippet).toContain("[[CURRENCIES]]");
    expect(snippet).toContain("desc =");
    expect(snippet).toContain("is_asset_anchored =");
    expect(snippet).toContain("anchor_asset_type =");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL (module not found)**

```bash
cd "E:\vibecode\1 in progress or to do\stellar-toolkit-dash"
npx vitest run tests/lib/asset-creator/toml.test.ts
```

Expected: FAIL with import error.

- [ ] **Step 3: Implement toml.ts**

```ts
// lib/asset-creator/toml.ts
import type { AssetCreatorForm } from "./types";

export function generateTomlSnippet(form: AssetCreatorForm): string {
  return [
    "[[CURRENCIES]]",
    `code = "${form.assetCode}"`,
    `issuer = "${form.issuerPublicKey}"`,
    `display_decimals = 7`,
    `name = "${form.tokenName}"`,
    `desc = ""`,
    `is_asset_anchored = false`,
    `anchor_asset_type = "other"`,
  ].join("\n");
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx vitest run tests/lib/asset-creator/toml.test.ts
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/asset-creator/toml.ts tests/lib/asset-creator/toml.test.ts
git commit -m "feat(asset-creator): add TOML snippet generator with tests"
```

---

### Task 3: Add navigation entry

**Files:**
- Modify: `lib/navigation.ts`

- [ ] **Step 1: Add Asset Creator to menu**

In `lib/navigation.ts`, make two edits:

**Edit 1** — add `Wand2` to the lucide-react import:
```ts
// old
  Ghost,
// new
  Ghost,
  Wand2,
```

**Edit 2** — insert after the Ghost Payments entry in `menuItems`:
```ts
// old
  {
    title: "Ghost Payments",
    href: "/ghost-payments",
    icon: Ghost,
  },
// new
  {
    title: "Ghost Payments",
    href: "/ghost-payments",
    icon: Ghost,
  },
  {
    title: "Asset Creator",
    href: "/asset-creator",
    icon: Wand2,
  },
```

- [ ] **Step 2: Commit**

```bash
git add lib/navigation.ts
git commit -m "feat(asset-creator): add sidebar navigation entry"
```

---

## Chunk 2: Preflight Logic

### Task 4: Implement and test preflight functions

**Files:**
- Create: `lib/asset-creator/preflight.ts`
- Create: `tests/lib/asset-creator/preflight.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/lib/asset-creator/preflight.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  checkAccountExists,
  checkBalance,
  checkAssetExists,
  estimateFees,
} from "../../../lib/asset-creator/preflight";

// Minimal Horizon.Server mock
function makeServer(overrides: Record<string, unknown> = {}) {
  return {
    loadAccount: vi.fn(),
    feeStats: vi.fn(),
    assets: vi.fn(),
    ...overrides,
  } as unknown as import("stellar-sdk").Horizon.Server;
}

const noop = () => {};
const signal = new AbortController().signal;

describe("checkAccountExists", () => {
  it("returns pass when account loads successfully", async () => {
    const server = makeServer({
      loadAccount: vi.fn().mockResolvedValue({ id: "GABC" }),
    });
    const result = await checkAccountExists("GABC", server, noop, signal);
    expect(result.status).toBe("pass");
  });

  it("returns fail when loadAccount throws 404", async () => {
    const server = makeServer({
      loadAccount: vi.fn().mockRejectedValue({ response: { status: 404 } }),
    });
    const result = await checkAccountExists("GABC", server, noop, signal);
    expect(result.status).toBe("fail");
  });

  it("logs the GET URL", async () => {
    const logs: string[] = [];
    const server = makeServer({
      loadAccount: vi.fn().mockResolvedValue({ id: "GABC" }),
    });
    await checkAccountExists("GABC", server, (msg) => logs.push(msg), signal);
    expect(logs.some((l) => l.includes("GABC"))).toBe(true);
  });
});

describe("checkBalance", () => {
  it("returns pass when balance >= minXlm", async () => {
    const server = makeServer({
      loadAccount: vi.fn().mockResolvedValue({
        balances: [{ asset_type: "native", balance: "10.0000000" }],
      }),
    });
    const result = await checkBalance("GABC", 1.5, server, noop, signal);
    expect(result.status).toBe("pass");
  });

  it("returns fail with message when balance < minXlm", async () => {
    const server = makeServer({
      loadAccount: vi.fn().mockResolvedValue({
        balances: [{ asset_type: "native", balance: "0.5000000" }],
      }),
    });
    const result = await checkBalance("GABC", 1.5, server, noop, signal);
    expect(result.status).toBe("fail");
    expect(result.message).toBeDefined();
    expect(result.message).toContain("1.5");
  });
});

describe("checkAssetExists", () => {
  it("returns warning when asset is already issued", async () => {
    const mockCall = vi.fn().mockResolvedValue({ records: [{ asset_code: "TOKEN" }] });
    const server = makeServer({
      assets: vi.fn().mockReturnValue({ forCode: vi.fn().mockReturnValue({ forIssuer: vi.fn().mockReturnValue({ call: mockCall }) }) }),
    });
    const result = await checkAssetExists("TOKEN", "GISSUER", server, noop, signal);
    expect(result.status).toBe("warning");
    expect(result.blocking).toBe(false);
  });

  it("returns pass when asset does not yet exist", async () => {
    const mockCall = vi.fn().mockResolvedValue({ records: [] });
    const server = makeServer({
      assets: vi.fn().mockReturnValue({ forCode: vi.fn().mockReturnValue({ forIssuer: vi.fn().mockReturnValue({ call: mockCall }) }) }),
    });
    const result = await checkAssetExists("TOKEN", "GISSUER", server, noop, signal);
    expect(result.status).toBe("pass");
  });
});

describe("estimateFees", () => {
  it("returns fee string based on p50 × 4 transactions", async () => {
    const server = makeServer({
      feeStats: vi.fn().mockResolvedValue({
        fee_charged: { p50: "100" },
      }),
    });
    // 4 txns × 100 stroops = 400 stroops = 0.0000400 XLM
    const feesXlm = await estimateFees(server);
    expect(parseFloat(feesXlm)).toBeCloseTo(0.00004, 8);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx vitest run tests/lib/asset-creator/preflight.test.ts
```

Expected: FAIL with import error.

- [ ] **Step 3: Implement preflight.ts**

```ts
// lib/asset-creator/preflight.ts
import type { Horizon } from "stellar-sdk";
import type { PreflightCheck } from "./types";

export async function checkAccountExists(
  address: string,
  server: Horizon.Server,
  onLog: (msg: string) => void,
  signal: AbortSignal,
  horizonUrl = "",
): Promise<PreflightCheck> {
  onLog(`  GET ${horizonUrl}/accounts/${address}`);
  try {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    await server.loadAccount(address);
    return { id: `exists-${address}`, label: `Account ${address.slice(0, 4)}…${address.slice(-4)} exists`, status: "pass", blocking: true };
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    const is404 = (e as { response?: { status?: number } })?.response?.status === 404;
    return {
      id: `exists-${address}`,
      label: `Account ${address.slice(0, 4)}…${address.slice(-4)} exists`,
      status: "fail",
      message: is404 ? "Account not found — enable funding to create it" : "Could not reach Horizon",
      blocking: true,
    };
  }
}

export async function checkBalance(
  address: string,
  minXlm: number,
  server: Horizon.Server,
  onLog: (msg: string) => void,
  signal: AbortSignal,
  horizonUrl = "",
): Promise<PreflightCheck> {
  onLog(`  GET ${horizonUrl}/accounts/${address} (balance check)`);
  try {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const account = await server.loadAccount(address);
    const native = account.balances.find((b: { asset_type: string }) => b.asset_type === "native");
    const balance = native ? parseFloat((native as { balance: string }).balance) : 0;
    const pass = balance >= minXlm;
    return {
      id: `balance-${address}`,
      label: `${address.slice(0, 4)}…${address.slice(-4)} has ≥ ${minXlm} XLM`,
      status: pass ? "pass" : "fail",
      message: pass ? undefined : `Balance is ${balance.toFixed(2)} XLM — need at least ${minXlm} XLM`,
      blocking: true,
    };
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    return { id: `balance-${address}`, label: `Balance check`, status: "fail", message: "Could not load account", blocking: true };
  }
}

export async function checkAssetExists(
  assetCode: string,
  issuer: string,
  server: Horizon.Server,
  onLog: (msg: string) => void,
  signal: AbortSignal,
  horizonUrl = "",
): Promise<PreflightCheck> {
  onLog(`  GET ${horizonUrl}/assets?asset_code=${assetCode}&asset_issuer=${issuer}`);
  try {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const result = await server.assets().forCode(assetCode).forIssuer(issuer).call();
    const exists = result.records.length > 0;
    return {
      id: "asset-exists",
      label: `Asset ${assetCode} not yet issued`,
      status: exists ? "warning" : "pass",
      message: exists ? `${assetCode} is already issued by this account — proceeding will re-issue` : undefined,
      blocking: false,
    };
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    return { id: "asset-exists", label: `Asset ${assetCode} check`, status: "pass", blocking: false };
  }
}

export async function estimateFees(server: Horizon.Server): Promise<string> {
  const stats = await server.feeStats();
  const p50 = parseFloat(stats.fee_charged.p50);
  const totalStroops = p50 * 4; // max 4 transactions in this flow
  return (totalStroops / 10_000_000).toFixed(7);
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx vitest run tests/lib/asset-creator/preflight.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/asset-creator/preflight.ts tests/lib/asset-creator/preflight.test.ts
git commit -m "feat(asset-creator): add preflight checks with tests"
```

---

## Chunk 3: Builder and Runner

### Task 5: Implement and test StandardStrategy builder

**Files:**
- Create: `lib/asset-creator/builder.ts`
- Create: `tests/lib/asset-creator/builder.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/lib/asset-creator/builder.test.ts
import { describe, it, expect, vi } from "vitest";
import { Networks, Keypair } from "stellar-sdk";
import { StandardStrategy } from "../../../lib/asset-creator/builder";
import type { AssetCreatorForm } from "../../../lib/asset-creator/types";

// Generate stable test keypairs
const issuerKp = Keypair.random();
const distribKp = Keypair.random();
const fundingKp = Keypair.random();

const baseForm: AssetCreatorForm = {
  network: "testnet",
  issuerPublicKey: issuerKp.publicKey(),
  issuerSecretKey: issuerKp.secret(),
  distributorPublicKey: distribKp.publicKey(),
  distributorSecretKey: distribKp.secret(),
  resolvedFundingSecretKey: fundingKp.secret(),
  assetCode: "myTOKEN",
  tokenName: "",
  supply: 1_000_000,
  memo: "",
  homeDomain: "",
};

function makeServer() {
  const mockAccount = (publicKey: string, seq = "1000") => ({
    id: publicKey,
    sequence: seq,
    accountId: () => publicKey,
    incrementSequenceNumber: vi.fn(),
  });

  return {
    loadAccount: vi.fn((pk: string) => Promise.resolve(mockAccount(pk))),
  } as unknown as import("stellar-sdk").Horizon.Server;
}

describe("StandardStrategy.buildTransactions", () => {
  it("builds fund-accounts tx with two create_account ops on mainnet", async () => {
    const server = makeServer();
    const signal = new AbortController().signal;
    const txns = await StandardStrategy.buildTransactions(
      { ...baseForm, network: "public", resolvedFundingSecretKey: fundingKp.secret() },
      ["fund-accounts"],
      server,
      Networks.PUBLIC,
      signal,
    );
    expect(txns).toHaveLength(1);
    expect(txns[0].stepId).toBe("fund-accounts");
    expect(txns[0].sourceAccount).toBe(fundingKp.publicKey());
    // XDR should be a non-empty string
    expect(txns[0].xdr.length).toBeGreaterThan(0);
  });

  it("builds set-home-domain tx when homeDomain is provided", async () => {
    const server = makeServer();
    const signal = new AbortController().signal;
    const txns = await StandardStrategy.buildTransactions(
      { ...baseForm, homeDomain: "example.com" },
      ["set-home-domain"],
      server,
      Networks.TESTNET,
      signal,
    );
    expect(txns).toHaveLength(1);
    expect(txns[0].stepId).toBe("set-home-domain");
    expect(txns[0].sourceAccount).toBe(issuerKp.publicKey());
  });

  it("skips set-home-domain when homeDomain is empty", async () => {
    const server = makeServer();
    const signal = new AbortController().signal;
    const txns = await StandardStrategy.buildTransactions(
      { ...baseForm, homeDomain: "" },
      ["set-home-domain"],
      server,
      Networks.TESTNET,
      signal,
    );
    expect(txns).toHaveLength(0);
  });

  it("builds trustline tx signed by distributor", async () => {
    const server = makeServer();
    const signal = new AbortController().signal;
    const txns = await StandardStrategy.buildTransactions(
      baseForm,
      ["trustline"],
      server,
      Networks.TESTNET,
      signal,
    );
    expect(txns).toHaveLength(1);
    expect(txns[0].stepId).toBe("trustline");
    expect(txns[0].sourceAccount).toBe(distribKp.publicKey());
  });

  it("builds issuance tx signed by issuer", async () => {
    const server = makeServer();
    const signal = new AbortController().signal;
    const txns = await StandardStrategy.buildTransactions(
      baseForm,
      ["issuance"],
      server,
      Networks.TESTNET,
      signal,
    );
    expect(txns).toHaveLength(1);
    expect(txns[0].stepId).toBe("issuance");
    expect(txns[0].sourceAccount).toBe(issuerKp.publicKey());
  });

  it("applies memo only to issuance tx, not trustline", async () => {
    const server = makeServer();
    const signal = new AbortController().signal;
    const { TransactionBuilder, Networks: N } = await import("stellar-sdk");

    const trustlineTxns = await StandardStrategy.buildTransactions(
      { ...baseForm, memo: "hello" },
      ["trustline"],
      server,
      Networks.TESTNET,
      signal,
    );
    const issuanceTxns = await StandardStrategy.buildTransactions(
      { ...baseForm, memo: "hello" },
      ["issuance"],
      server,
      Networks.TESTNET,
      signal,
    );

    const trustlineTx = TransactionBuilder.fromXDR(trustlineTxns[0].xdr, N.TESTNET);
    const issuanceTx = TransactionBuilder.fromXDR(issuanceTxns[0].xdr, N.TESTNET);

    expect(trustlineTx.memo.type).toBe("none");
    expect(issuanceTx.memo.type).toBe("text");
    expect((issuanceTx.memo as import("stellar-sdk").MemoText).value).toBe("hello");
  });

  it("preserves assetCode case in issuance tx", async () => {
    const server = makeServer();
    const signal = new AbortController().signal;
    const { TransactionBuilder, Networks: N } = await import("stellar-sdk");

    const txns = await StandardStrategy.buildTransactions(
      { ...baseForm, assetCode: "myTOKEN" },
      ["issuance"],
      server,
      Networks.TESTNET,
      signal,
    );
    expect(txns).toHaveLength(1);
    const tx = TransactionBuilder.fromXDR(txns[0].xdr, N.TESTNET);
    const op = tx.operations[0] as import("stellar-sdk").Operation.Payment;
    expect(op.asset.getCode()).toBe("myTOKEN");
    expect(op.asset.getCode()).not.toBe("MYTOKEN");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx vitest run tests/lib/asset-creator/builder.test.ts
```

Expected: FAIL with import error.

- [ ] **Step 3: Implement builder.ts**

```ts
// lib/asset-creator/builder.ts
import {
  Keypair,
  TransactionBuilder,
  Operation,
  Asset,
  Memo,
  BASE_FEE,
} from "stellar-sdk";
import type { Horizon } from "stellar-sdk";
import type { AssetCreatorForm, SignedTx, CreationStrategy } from "./types";

const ISSUER_FUND_XLM = "2.1";
const DISTRIB_FUND_XLM = "2.0";
const TX_TIMEOUT = 180;

export const StandardStrategy: CreationStrategy = {
  id: "standard",
  label: "Standard",

  async buildTransactions(
    form: AssetCreatorForm,
    steps: Array<SignedTx["stepId"]>,
    server: Horizon.Server,
    networkPassphrase: string,
    signal: AbortSignal,
  ): Promise<SignedTx[]> {
    const results: SignedTx[] = [];

    for (const stepId of steps) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");

      if (stepId === "fund-accounts") {
        // Both create_account ops in one tx — single funding wallet sequence number
        const fundingKp = Keypair.fromSecret(form.resolvedFundingSecretKey);
        const fundingAccount = await server.loadAccount(fundingKp.publicKey());
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");

        const tx = new TransactionBuilder(fundingAccount, {
          fee: BASE_FEE,
          networkPassphrase,
        })
          .addOperation(Operation.createAccount({
            destination: form.issuerPublicKey,
            startingBalance: ISSUER_FUND_XLM,
          }))
          .addOperation(Operation.createAccount({
            destination: form.distributorPublicKey,
            startingBalance: DISTRIB_FUND_XLM,
          }))
          .setTimeout(TX_TIMEOUT)
          .build();

        tx.sign(fundingKp);
        results.push({
          stepId: "fund-accounts",
          label: "Fund issuer + distributor accounts",
          xdr: tx.toEnvelope().toXDR("base64"),
          sourceAccount: fundingKp.publicKey(),
        });
      }

      if (stepId === "set-home-domain") {
        if (!form.homeDomain) continue; // skip if no home domain
        const issuerKp = Keypair.fromSecret(form.issuerSecretKey);
        const issuerAccount = await server.loadAccount(issuerKp.publicKey());
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");

        const tx = new TransactionBuilder(issuerAccount, {
          fee: BASE_FEE,
          networkPassphrase,
        })
          .addOperation(Operation.setOptions({ homeDomain: form.homeDomain }))
          .setTimeout(TX_TIMEOUT)
          .build();

        tx.sign(issuerKp);
        results.push({
          stepId: "set-home-domain",
          label: "Set home domain on issuer",
          xdr: tx.toEnvelope().toXDR("base64"),
          sourceAccount: issuerKp.publicKey(),
        });
      }

      if (stepId === "trustline") {
        const distribKp = Keypair.fromSecret(form.distributorSecretKey);
        const distribAccount = await server.loadAccount(distribKp.publicKey());
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");

        const asset = new Asset(form.assetCode, form.issuerPublicKey);
        const tx = new TransactionBuilder(distribAccount, {
          fee: BASE_FEE,
          networkPassphrase,
        })
          .addOperation(Operation.changeTrust({ asset }))
          .setTimeout(TX_TIMEOUT)
          .build();

        tx.sign(distribKp);
        results.push({
          stepId: "trustline",
          label: "Distributor establishes trustline",
          xdr: tx.toEnvelope().toXDR("base64"),
          sourceAccount: distribKp.publicKey(),
        });
      }

      if (stepId === "issuance") {
        const issuerKp = Keypair.fromSecret(form.issuerSecretKey);
        const issuerAccount = await server.loadAccount(issuerKp.publicKey());
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");

        const asset = new Asset(form.assetCode, form.issuerPublicKey);
        const builder = new TransactionBuilder(issuerAccount, {
          fee: BASE_FEE,
          networkPassphrase,
        }).addOperation(Operation.payment({
          destination: form.distributorPublicKey,
          asset,
          amount: String(form.supply),
        }));

        if (form.memo) builder.addMemo(Memo.text(form.memo));

        const tx = builder.setTimeout(TX_TIMEOUT).build();
        tx.sign(issuerKp);
        results.push({
          stepId: "issuance",
          label: "Issuer mints supply to distributor",
          xdr: tx.toEnvelope().toXDR("base64"),
          sourceAccount: issuerKp.publicKey(),
        });
      }
    }

    return results;
  },
};
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx vitest run tests/lib/asset-creator/builder.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/asset-creator/builder.ts tests/lib/asset-creator/builder.test.ts
git commit -m "feat(asset-creator): add StandardStrategy builder with tests"
```

---

### Task 6: Implement runner

**Files:**
- Create: `lib/asset-creator/runner.ts`

- [ ] **Step 1: Implement runner.ts**

```ts
// lib/asset-creator/runner.ts
import { TransactionBuilder } from "stellar-sdk";
import type { Horizon } from "stellar-sdk";
import type {
  AssetCreatorForm,
  SignedTx,
  StepResult,
  CreationStrategy,
} from "./types";

const FRIENDBOT_URL = "https://friendbot.stellar.org";

export interface RunAssetCreationOptions {
  strategy: CreationStrategy;
  server: Horizon.Server;
  networkPassphrase: string;
  signal: AbortSignal;
  onLog: (msg: string) => void;
  onStep: (result: StepResult) => void;
}

/**
 * Orchestrates all steps: friendbot (testnet) or fund-accounts tx (mainnet),
 * then set-home-domain, trustline, issuance.
 *
 * Calls onStep after each transaction with its result.
 * On failure, stops and returns current results — caller handles retry.
 */
export async function runAssetCreation(
  form: AssetCreatorForm,
  completedStepIds: Set<SignedTx["stepId"]>,
  options: RunAssetCreationOptions,
): Promise<StepResult[]> {
  const { strategy, server, networkPassphrase, signal, onLog, onStep } = options;
  const results: StepResult[] = [];

  const allSteps: Array<SignedTx["stepId"]> = [
    "fund-accounts",
    "set-home-domain",
    "trustline",
    "issuance",
  ];

  const remainingSteps = allSteps.filter((s) => !completedStepIds.has(s));

  for (const stepId of remainingSteps) {
    if (signal.aborted) break;

    // Skip set-home-domain if no home domain provided
    if (stepId === "set-home-domain" && !form.homeDomain) {
      const skipped: StepResult = { stepId, status: "skipped" };
      results.push(skipped);
      onStep(skipped);
      continue;
    }

    // Handle fund-accounts step
    if (stepId === "fund-accounts") {
      if (form.network === "testnet") {
        // Testnet: use friendbot for each account
        for (const addr of [form.issuerPublicKey, form.distributorPublicKey]) {
          const url = `${FRIENDBOT_URL}?addr=${addr}`;
          onLog(`  GET ${url}`);
          try {
            const res = await fetch(url, { signal });
            const body = await res.json().catch(() => ({}));
            const alreadyExists =
              !res.ok &&
              JSON.stringify(body).includes("createAccountAlreadyExist");
            if (!res.ok && !alreadyExists) {
              const err: StepResult = {
                stepId: "friendbot",
                status: "failed",
                error: `Friendbot failed for ${addr.slice(0, 4)}…${addr.slice(-4)}: ${JSON.stringify(body)}`,
              };
              results.push(err);
              onStep(err);
              return results;
            }
          } catch (e) {
            if (signal.aborted) break;
            const err: StepResult = {
              stepId: "friendbot",
              status: "failed",
              error: `Friendbot request failed: ${String(e)}`,
            };
            results.push(err);
            onStep(err);
            return results;
          }
        }
        const ok: StepResult = { stepId: "fund-accounts", status: "success" };
        results.push(ok);
        onStep(ok);
        continue;
      }
      // else fall through to standard tx submission below
    }

    // Build and submit transaction
    const running: StepResult = { stepId, status: "running" };
    onStep(running);

    try {
      const txns = await strategy.buildTransactions(
        form,
        [stepId],
        server,
        networkPassphrase,
        signal,
      );

      if (txns.length === 0) {
        // strategy returned nothing (e.g. set-home-domain with empty domain — shouldn't happen here)
        const skipped: StepResult = { stepId, status: "skipped" };
        results.push(skipped);
        onStep(skipped);
        continue;
      }

      for (const signedTx of txns) {
        onLog(`  Submitting tx: ${signedTx.label}`);
        const tx = TransactionBuilder.fromXDR(signedTx.xdr, networkPassphrase);
        const submitted = await server.submitTransaction(tx);
        const hash = (submitted as { hash?: string }).hash ?? "";
        onLog(`  ✓ ${signedTx.label}: ${hash}`);

        const ok: StepResult = { stepId, status: "success", txHash: hash };
        results.push(ok);
        onStep(ok);
      }
    } catch (e: unknown) {
      if (signal.aborted) break;

      // Check for op_already_exists (skippable on fund-accounts)
      const errStr = JSON.stringify(e);
      if (stepId === "fund-accounts" && errStr.includes("op_already_exists")) {
        const ok: StepResult = { stepId, status: "success" };
        results.push(ok);
        onStep(ok);
        continue;
      }

      const failed: StepResult = {
        stepId,
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
      };
      results.push(failed);
      onStep(failed);
      return results; // stop on failure
    }
  }

  return results;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/asset-creator/runner.ts
git commit -m "feat(asset-creator): add execution runner"
```

---

## Chunk 4: UI — Route, Panel, Step Components

### Task 7: Create route page

**Files:**
- Create: `app/(tools)/asset-creator/page.tsx`

- [ ] **Step 1: Create route shell**

```tsx
// app/(tools)/asset-creator/page.tsx
import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { AssetCreatorPanel } from "@/components/asset-creator/AssetCreatorPanel";

export default function AssetCreatorPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Asset Creator</h1>
        <p className="text-muted-foreground mt-2">
          Create a custom Stellar asset — issue tokens with an issuer and
          distributor account in a guided step-by-step flow.
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
        <AssetCreatorPanel />
      </Suspense>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/(tools)/asset-creator/page.tsx
git commit -m "feat(asset-creator): add route page"
```

---

### Task 8: Build Step1Accounts component

**Files:**
- Create: `components/asset-creator/steps/Step1Accounts.tsx`

- [ ] **Step 1: Implement Step1Accounts**

```tsx
// components/asset-creator/steps/Step1Accounts.tsx
"use client";

import { useState } from "react";
import { Keypair, StrKey } from "stellar-sdk";
import { Eye, EyeOff, RefreshCw, Wallet } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NETWORK_LABELS, type Network } from "@/lib/settings";
import type { AssetCreatorForm } from "@/lib/asset-creator/types";

interface Props {
  form: AssetCreatorForm;
  onChange: (patch: Partial<AssetCreatorForm>) => void;
  activeWalletName?: string;
  activeWalletKey?: string;
  onNext: () => void;
}

function KeypairField({
  label,
  publicKey,
  secretKey,
  onPublicChange,
  onSecretChange,
  onGenerate,
}: {
  label: string;
  publicKey: string;
  secretKey: string;
  onPublicChange: (v: string) => void;
  onSecretChange: (v: string) => void;
  onGenerate: () => void;
}) {
  const [showSecret, setShowSecret] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold">{label}</Label>
        <Button type="button" variant="ghost" size="sm" onClick={onGenerate} className="h-7 text-xs gap-1">
          <RefreshCw className="h-3 w-3" /> Generate new
        </Button>
      </div>
      <Input
        placeholder="Public key (G…)"
        value={publicKey}
        onChange={(e) => onPublicChange(e.target.value.trim())}
        className="font-mono text-xs"
      />
      <div className="relative">
        <Input
          type={showSecret ? "text" : "password"}
          placeholder="Secret key (S…)"
          value={secretKey}
          onChange={(e) => onSecretChange(e.target.value.trim())}
          className="font-mono text-xs pr-10"
        />
        <button
          type="button"
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          onClick={() => setShowSecret((v) => !v)}
        >
          {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function validateStep1(form: AssetCreatorForm): string | null {
  if (!StrKey.isValidEd25519PublicKey(form.issuerPublicKey)) return "Invalid issuer public key";
  if (!StrKey.isValidEd25519PublicKey(form.distributorPublicKey)) return "Invalid distributor public key";
  try {
    const kp = Keypair.fromSecret(form.issuerSecretKey);
    if (kp.publicKey() !== form.issuerPublicKey) return "Issuer secret key does not match public key";
  } catch {
    return "Invalid issuer secret key";
  }
  try {
    const kp = Keypair.fromSecret(form.distributorSecretKey);
    if (kp.publicKey() !== form.distributorPublicKey) return "Distributor secret key does not match public key";
  } catch {
    return "Invalid distributor secret key";
  }
  return null;
}

export function Step1Accounts({ form, onChange, activeWalletName, activeWalletKey, onNext }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [showFundingSecret, setShowFundingSecret] = useState(false);

  const handleNext = () => {
    const err = validateStep1(form);
    if (err) { setError(err); return; }
    setError(null);
    onNext();
  };

  const generateKeypair = (which: "issuer" | "distributor") => {
    const kp = Keypair.random();
    if (which === "issuer") {
      onChange({ issuerPublicKey: kp.publicKey(), issuerSecretKey: kp.secret() });
    } else {
      onChange({ distributorPublicKey: kp.publicKey(), distributorSecretKey: kp.secret() });
    }
  };

  const networks: Network[] = ["public", "testnet", "futurenet"];

  return (
    <div className="space-y-6">
      {/* Network */}
      <div className="space-y-2">
        <Label className="text-sm font-semibold">Network</Label>
        <Select value={form.network} onValueChange={(v) => onChange({ network: v as Network })}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {networks.map((n) => (
              <SelectItem key={n} value={n}>{NETWORK_LABELS[n]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Funding source */}
      <div className="space-y-2">
        <Label className="text-sm font-semibold">Funding Source (for new accounts on mainnet)</Label>
        {activeWalletName && activeWalletKey ? (
          <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-green-500/10 border border-green-500/30 text-sm">
            <Wallet className="h-4 w-4 text-green-500" />
            <span className="font-medium text-green-600 dark:text-green-400">{activeWalletName}</span>
            <span className="text-muted-foreground font-mono text-xs">{activeWalletKey.slice(0, 4)}…{activeWalletKey.slice(-4)}</span>
          </div>
        ) : (
          <div className="space-y-1">
            <div className="relative">
              <Input
                type={showFundingSecret ? "text" : "password"}
                placeholder="Funding secret key (S…) — only needed if creating new accounts on mainnet"
                value={form.resolvedFundingSecretKey}
                onChange={(e) => onChange({ resolvedFundingSecretKey: e.target.value.trim() })}
                className="font-mono text-xs pr-10"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowFundingSecret((v) => !v)}
              >
                {showFundingSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">Connect a wallet in Wallet Manager to use it here automatically.</p>
          </div>
        )}
      </div>

      {/* Issuer keypair */}
      <KeypairField
        label="Issuer Keypair"
        publicKey={form.issuerPublicKey}
        secretKey={form.issuerSecretKey}
        onPublicChange={(v) => onChange({ issuerPublicKey: v })}
        onSecretChange={(v) => onChange({ issuerSecretKey: v })}
        onGenerate={() => generateKeypair("issuer")}
      />

      {/* Distributor keypair */}
      <KeypairField
        label="Distributor Keypair"
        publicKey={form.distributorPublicKey}
        secretKey={form.distributorSecretKey}
        onPublicChange={(v) => onChange({ distributorPublicKey: v })}
        onSecretChange={(v) => onChange({ distributorSecretKey: v })}
        onGenerate={() => generateKeypair("distributor")}
      />

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button onClick={handleNext}>Next: Asset Config →</Button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/asset-creator/steps/Step1Accounts.tsx
git commit -m "feat(asset-creator): add Step1Accounts component"
```

---

### Task 9: Build Step2AssetConfig component

**Files:**
- Create: `components/asset-creator/steps/Step2AssetConfig.tsx`

- [ ] **Step 1: Implement Step2AssetConfig**

```tsx
// components/asset-creator/steps/Step2AssetConfig.tsx
"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { generateTomlSnippet } from "@/lib/asset-creator/toml";
import type { AssetCreatorForm } from "@/lib/asset-creator/types";

const ASSET_CODE_RE = /^[A-Za-z0-9]{1,12}$/;
const DOMAIN_RE = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

function validateStep2(form: AssetCreatorForm): string | null {
  if (!ASSET_CODE_RE.test(form.assetCode)) return "Asset code must be 1–12 alphanumeric characters";
  if (form.supply <= 0) return "Supply must be a positive number";
  if (form.memo && Buffer.byteLength(form.memo, "utf8") > 28) return "Memo exceeds 28 bytes";
  if (form.homeDomain && !DOMAIN_RE.test(form.homeDomain)) return "Invalid home domain format";
  return null;
}

interface Props {
  form: AssetCreatorForm;
  onChange: (patch: Partial<AssetCreatorForm>) => void;
  onBack: () => void;
  onNext: () => void;
}

export function Step2AssetConfig({ form, onChange, onBack, onNext }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const toml = generateTomlSnippet(form);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(toml);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleNext = () => {
    const err = validateStep2(form);
    if (err) { setError(err); return; }
    setError(null);
    onNext();
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="text-sm font-semibold">Asset Code <span className="text-destructive">*</span></Label>
          <Input
            placeholder="e.g. MYTOKEN"
            value={form.assetCode}
            onChange={(e) => onChange({ assetCode: e.target.value })}
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">1–12 alphanumeric chars. Case preserved on-chain.</p>
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-semibold">Token Name</Label>
          <Input
            placeholder="e.g. My Token (optional)"
            value={form.tokenName}
            onChange={(e) => onChange({ tokenName: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">Used in stellar.toml only — not stored on-chain.</p>
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-semibold">Initial Supply <span className="text-destructive">*</span></Label>
          <Input
            type="number"
            min="1"
            value={form.supply}
            onChange={(e) => onChange({ supply: parseFloat(e.target.value) || 0 })}
            className="font-mono"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-semibold">Home Domain</Label>
          <Input
            placeholder="e.g. example.com (optional)"
            value={form.homeDomain}
            onChange={(e) => onChange({ homeDomain: e.target.value.trim() })}
            className="font-mono text-xs"
          />
        </div>

        <div className="space-y-2 md:col-span-2">
          <Label className="text-sm font-semibold">Memo (on issuance tx)</Label>
          <Input
            placeholder="Optional — max 28 bytes"
            value={form.memo}
            onChange={(e) => onChange({ memo: e.target.value })}
          />
        </div>
      </div>

      {/* TOML preview */}
      {form.assetCode && form.issuerPublicKey && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-semibold">stellar.toml Snippet</Label>
            <Button type="button" variant="ghost" size="sm" onClick={handleCopy} className="h-7 text-xs gap-1">
              {copied ? <><Check className="h-3 w-3" /> Copied!</> : <><Copy className="h-3 w-3" /> Copy</>}
            </Button>
          </div>
          <pre className="bg-muted rounded-md p-3 text-xs font-mono overflow-x-auto whitespace-pre">{toml}</pre>
          {form.homeDomain && (
            <p className="text-xs text-muted-foreground">
              Host this at <code className="font-mono">https://{form.homeDomain}/.well-known/stellar.toml</code>
            </p>
          )}
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button variant="outline" onClick={onBack}>← Back</Button>
        <Button onClick={handleNext}>Next: Preflight →</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/asset-creator/steps/Step2AssetConfig.tsx
git commit -m "feat(asset-creator): add Step2AssetConfig with TOML preview"
```

---

### Task 10: Build Step3Preflight component

**Files:**
- Create: `components/asset-creator/steps/Step3Preflight.tsx`

- [ ] **Step 1: Implement Step3Preflight**

```tsx
// components/asset-creator/steps/Step3Preflight.tsx
"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Horizon } from "stellar-sdk";
import { CheckCircle2, XCircle, AlertTriangle, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resolveHorizonUrl, resolveNetworkPassphrase } from "@/lib/settings";
import {
  checkAccountExists,
  checkBalance,
  checkAssetExists,
  estimateFees,
} from "@/lib/asset-creator/preflight";
import { runAssetCreation } from "@/lib/asset-creator/runner";
import { StandardStrategy } from "@/lib/asset-creator/builder";
import type { AssetCreatorForm, PreflightCheck, StepResult } from "@/lib/asset-creator/types";

interface Props {
  form: AssetCreatorForm;
  completedSteps: Set<string>;
  onBack: () => void;
  onComplete: (results: StepResult[]) => void;
}

export function Step3Preflight({ form, completedSteps, onBack, onComplete }: Props) {
  const [checks, setChecks] = useState<PreflightCheck[]>([]);
  const [feesXlm, setFeesXlm] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [running, setRunning] = useState(false);
  const [warningAcked, setWarningAcked] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);

  const onLog = useCallback((msg: string) => {
    setLogs((prev) => [...prev, msg]);
  }, []);

  // Auto-scroll log only when at bottom
  useEffect(() => {
    if (!userScrolledUp.current) {
      logEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  const runPreflight = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    setChecking(true);
    setChecks([]);
    setFeesXlm(null);
    setWarningAcked(false);

    const horizonUrl = resolveHorizonUrl({ network: form.network, localHorizonUrl: "" });
    const server = new Horizon.Server(horizonUrl);

    const allChecks: PreflightCheck[] = [];
    const push = (c: PreflightCheck) => {
      allChecks.push(c);
      setChecks([...allChecks]);
    };

    try {
      push(await checkAccountExists(form.issuerPublicKey, server, onLog, signal));
      push(await checkBalance(form.issuerPublicKey, 1.5, server, onLog, signal));
      push(await checkAccountExists(form.distributorPublicKey, server, onLog, signal));
      push(await checkBalance(form.distributorPublicKey, 1.5, server, onLog, signal));
      push(await checkAssetExists(form.assetCode, form.issuerPublicKey, server, onLog, signal));
      const fees = await estimateFees(server);
      setFeesXlm(fees);
    } catch {
      // aborted
    } finally {
      setChecking(false);
    }
  }, [form, onLog]);

  // Run preflight on mount
  useEffect(() => { runPreflight(); return () => abortRef.current?.abort(); }, [runPreflight]);

  const hasBlockingFail = checks.some((c) => c.blocking && c.status === "fail");
  const hasWarning = checks.some((c) => !c.blocking && c.status === "warning");
  const canExecute = !checking && !running && !hasBlockingFail && (!hasWarning || warningAcked);

  const handleExecute = async () => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    setRunning(true);
    setLogOpen(true);

    const server = new Horizon.Server(resolveHorizonUrl({ network: form.network, localHorizonUrl: "" }));
    const networkPassphrase = resolveNetworkPassphrase(form.network);

    const results = await runAssetCreation(form, completedSteps, {
      strategy: StandardStrategy,
      server,
      networkPassphrase,
      signal,
      onLog,
      onStep: () => {},
    });

    setRunning(false);
    onComplete(results);
  };

  const statusIcon = (status: PreflightCheck["status"]) => {
    if (status === "loading") return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
    if (status === "pass") return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    if (status === "fail") return <XCircle className="h-4 w-4 text-destructive" />;
    return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
  };

  return (
    <div className="space-y-6">
      {/* Checklist */}
      <div className="space-y-2">
        {checks.map((c) => (
          <div key={c.id} className="flex items-start gap-3 py-2 border-b border-border/50 last:border-0">
            <div className="mt-0.5">{statusIcon(c.status)}</div>
            <div>
              <p className="text-sm">{c.label}</p>
              {c.message && <p className="text-xs text-muted-foreground mt-0.5">{c.message}</p>}
            </div>
          </div>
        ))}
        {checking && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Running preflight checks…
          </div>
        )}
      </div>

      {feesXlm && (
        <p className="text-sm text-muted-foreground">Estimated fees: ~{feesXlm} XLM</p>
      )}

      {/* Warning acknowledgement */}
      {hasWarning && (
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={warningAcked}
            onChange={(e) => setWarningAcked(e.target.checked)}
            className="rounded"
          />
          Proceed anyway (I understand the warnings above)
        </label>
      )}

      {/* Activity log */}
      {logs.length > 0 && (
        <div className="space-y-1">
          <button
            type="button"
            onClick={() => setLogOpen((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {logOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            Activity log ({logs.length} entries)
          </button>
          {logOpen && (
            <div
              className="bg-muted rounded-md p-3 h-40 overflow-y-auto font-mono text-xs space-y-0.5"
              onScroll={(e) => {
                const el = e.currentTarget;
                userScrolledUp.current = el.scrollTop + el.clientHeight < el.scrollHeight - 10;
              }}
            >
              {logs.map((line, i) => <div key={i}>{line}</div>)}
              <div ref={logEndRef} />
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="outline" onClick={onBack} disabled={running}>← Back</Button>
        <Button variant="outline" onClick={runPreflight} disabled={checking || running}>Re-check</Button>
        <Button onClick={handleExecute} disabled={!canExecute}>
          {running ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Executing…</> : "Execute →"}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/asset-creator/steps/Step3Preflight.tsx
git commit -m "feat(asset-creator): add Step3Preflight with checklist and execution"
```

---

### Task 11: Build Step4Result component

**Files:**
- Create: `components/asset-creator/steps/Step4Result.tsx`

- [ ] **Step 1: Implement Step4Result**

```tsx
// components/asset-creator/steps/Step4Result.tsx
"use client";

import { CheckCircle2, XCircle, SkipForward, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { StepResult } from "@/lib/asset-creator/types";

const STEP_LABELS: Record<string, string> = {
  "fund-accounts": "Fund issuer + distributor accounts",
  "friendbot": "Friendbot account funding (testnet)",
  "set-home-domain": "Set home domain on issuer",
  "trustline": "Distributor establishes trustline",
  "issuance": "Issuer mints supply to distributor",
};

interface Props {
  results: StepResult[];
  groupId?: string;
  network: string;
  onRetry: (failedStepIds: string[]) => void;
  onStartOver: () => void;
}

export function Step4Result({ results, groupId, network, onRetry, onStartOver }: Props) {
  const expertBase = network === "public"
    ? "https://stellar.expert/explorer/public/tx"
    : "https://stellar.expert/explorer/testnet/tx";

  const failed = results.filter((r) => r.status === "failed");
  const allSuccess = results.length > 0 && failed.length === 0;

  const statusIcon = (status: StepResult["status"]) => {
    if (status === "success") return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />;
    if (status === "failed") return <XCircle className="h-4 w-4 text-destructive shrink-0" />;
    if (status === "skipped") return <SkipForward className="h-4 w-4 text-muted-foreground shrink-0" />;
    return null;
  };

  return (
    <div className="space-y-6">
      {allSuccess && (
        <div className="rounded-md bg-green-500/10 border border-green-500/30 p-4 text-green-700 dark:text-green-300 text-sm font-medium">
          ✓ Asset created successfully!
        </div>
      )}

      {/* Per-step rows */}
      <div className="space-y-2">
        {results.map((r, i) => (
          <div key={i} className="flex items-start gap-3 py-2 border-b border-border/50 last:border-0">
            {statusIcon(r.status)}
            <div className="flex-1 min-w-0">
              <p className="text-sm">{STEP_LABELS[r.stepId] ?? r.stepId}</p>
              {r.txHash && (
                <a
                  href={`${expertBase}/${r.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-mono text-primary hover:underline flex items-center gap-1 mt-0.5"
                >
                  {r.txHash.slice(0, 8)}…{r.txHash.slice(-8)}
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {r.error && <p className="text-xs text-destructive mt-0.5">{r.error}</p>}
            </div>
          </div>
        ))}
      </div>

      {/* Group link */}
      {groupId && (
        <a
          href={`/groups?open=${groupId}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Button variant="default" className="bg-green-600 hover:bg-green-700 gap-2">
            Open Group → <ExternalLink className="h-4 w-4" />
          </Button>
        </a>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        {failed.length > 0 && (
          <Button onClick={() => onRetry(failed.map((r) => r.stepId))}>
            Retry failed steps
          </Button>
        )}
        <Button variant="outline" onClick={onStartOver}>Start over</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/asset-creator/steps/Step4Result.tsx
git commit -m "feat(asset-creator): add Step4Result component"
```

---

### Task 12: Build AssetCreatorPanel (wizard root)

**Files:**
- Create: `components/asset-creator/AssetCreatorPanel.tsx`

- [ ] **Step 1: Implement AssetCreatorPanel**

```tsx
// components/asset-creator/AssetCreatorPanel.tsx
"use client";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { useActiveWallet } from "@/hooks/use-active-wallet";
import { useAssetGroups } from "@/hooks/use-asset-groups";
import { shortAddr } from "@/lib/format";
import type { AssetCreatorForm, StepResult } from "@/lib/asset-creator/types";
import { Step1Accounts } from "./steps/Step1Accounts";
import { Step2AssetConfig } from "./steps/Step2AssetConfig";
import { Step3Preflight } from "./steps/Step3Preflight";
import { Step4Result } from "./steps/Step4Result";

const EMPTY_FORM: AssetCreatorForm = {
  network: "public",
  issuerPublicKey: "",
  issuerSecretKey: "",
  distributorPublicKey: "",
  distributorSecretKey: "",
  resolvedFundingSecretKey: "",
  assetCode: "",
  tokenName: "",
  supply: 1_000_000,
  memo: "",
  homeDomain: "",
};

const STEPS = ["accounts", "config", "preflight", "result"] as const;
type Step = (typeof STEPS)[number];

export function AssetCreatorPanel() {
  const { activeWallet } = useActiveWallet();
  const { createGroup, upsertMember } = useAssetGroups();

  const [step, setStep] = useState<Step>("accounts");
  const [form, setForm] = useState<AssetCreatorForm>(EMPTY_FORM);
  const [results, setResults] = useState<StepResult[]>([]);
  const [groupId, setGroupId] = useState<string | undefined>();
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set());

  const onChange = (patch: Partial<AssetCreatorForm>) => {
    setForm((prev) => {
      const next = { ...prev, ...patch };
      // Always resolve funding key from active wallet if connected
      if (activeWallet?.secretKey) {
        next.resolvedFundingSecretKey = activeWallet.secretKey;
      }
      return next;
    });
  };

  const handleComplete = async (stepResults: StepResult[]) => {
    setResults(stepResults);
    setStep("result");

    const succeeded = new Set(
      stepResults.filter((r) => r.status === "success").map((r) => r.stepId)
    );
    setCompletedSteps(succeeded);

    // Auto-save to Asset Groups on full success
    const allSucceeded = stepResults.every(
      (r) => r.status === "success" || r.status === "skipped"
    );
    if (allSucceeded && form.assetCode && form.issuerPublicKey) {
      const gId = createGroup({
        name: `${form.assetCode.toUpperCase()} Asset`,
        assetCode: form.assetCode,
        issuer: form.issuerPublicKey,
        network: form.network,
      });
      // Add issuer and distrib as members
      upsertMember(gId, {
        address: form.issuerPublicKey,
        role: "issuer",
        label: "Issuer",
        homeDomain: form.homeDomain || undefined,
      });
      upsertMember(gId, {
        address: form.distributorPublicKey,
        role: "distrib",
        label: "Distributor",
      });
      setGroupId(gId);
    }
  };

  const handleRetry = (_failedStepIds: string[]) => {
    // completedSteps already tracks what succeeded — Step3Preflight reads it via prop
    setStep("preflight");
  };

  const handleStartOver = () => {
    setForm(EMPTY_FORM);
    setResults([]);
    setGroupId(undefined);
    setCompletedSteps(new Set());
    setStep("accounts");
  };

  const stepIndex = STEPS.indexOf(step);

  return (
    <Card>
      <CardContent className="pt-6">
        <Tabs value={step} onValueChange={(v) => setStep(v as Step)}>
          <TabsList className="mb-6 w-full grid grid-cols-4">
            {(["accounts", "config", "preflight", "result"] as const).map((s, i) => (
              <TabsTrigger
                key={s}
                value={s}
                disabled={i > stepIndex && step !== "result"}
                className="capitalize"
              >
                {i + 1}. {s === "accounts" ? "Accounts" : s === "config" ? "Asset Config" : s === "preflight" ? "Preflight" : "Result"}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="accounts">
            <Step1Accounts
              form={form}
              onChange={onChange}
              activeWalletName={activeWallet?.name}
              activeWalletKey={activeWallet ? shortAddr(activeWallet.publicKey) : undefined}
              onNext={() => setStep("config")}
            />
          </TabsContent>

          <TabsContent value="config">
            <Step2AssetConfig
              form={form}
              onChange={onChange}
              onBack={() => setStep("accounts")}
              onNext={() => setStep("preflight")}
            />
          </TabsContent>

          <TabsContent value="preflight">
            <Step3Preflight
              form={form}
              completedSteps={completedSteps}
              onBack={() => setStep("config")}
              onComplete={handleComplete}
            />
          </TabsContent>

          <TabsContent value="result">
            <Step4Result
              results={results}
              groupId={groupId}
              network={form.network}
              onRetry={handleRetry}
              onStartOver={handleStartOver}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/asset-creator/AssetCreatorPanel.tsx
git commit -m "feat(asset-creator): add AssetCreatorPanel wizard root"
```

---

## Chunk 5: Final Integration

### Task 13: Update CLAUDE.md module inventory

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add asset-creator to module inventory**

In `CLAUDE.md`, add a row to the Module Inventory table:

```markdown
| `asset-creator` | In progress — 4-step wizard: accounts, asset config, preflight, execution |
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add asset-creator to module inventory"
```

---

### Task 14: Smoke test

- [ ] **Step 1: Run all tests**

```bash
cd "E:\vibecode\1 in progress or to do\stellar-toolkit-dash"
npx vitest run
```

Expected: all existing tests plus new asset-creator tests PASS.

- [ ] **Step 2: Start dev server and verify navigation**

```bash
npm run dev
```

Open `http://localhost:3000` — verify:
- "Asset Creator" appears in sidebar
- Navigating to `/asset-creator` loads the page
- Step 1 keypair generation works (Generate new button)
- Step 2 TOML preview updates live as you type
- Tabs are disabled until validated

- [ ] **Step 3: Testnet end-to-end**

With network set to Testnet:
1. Generate two new keypairs (issuer + distrib)
2. Set asset code `TESTTKN`, supply 1000
3. Run preflight — both accounts should be missing, friendbot toggle should appear
4. Execute — friendbot creates accounts, trustline and issuance complete
5. Verify "Open Group →" appears and links to correct group

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(asset-creator): smoke test fixes"
```
