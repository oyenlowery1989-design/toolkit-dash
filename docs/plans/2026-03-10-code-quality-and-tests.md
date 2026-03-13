# Code Quality & Tests Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix small inconsistencies, eliminate dead code/shims, add Vitest, and write unit tests for all pure utility functions.

**Architecture:** No new features, no risk to signed-off modules. All changes are either additive (tests, config) or trivial renames (package name, one import update). Tests live in `tests/` at the project root, co-located by module name.

**Tech Stack:** Vitest 2.x, @vitest/coverage-v8, stellar-sdk (for parseAddresses test), TypeScript.

---

## Chunk 1: Housekeeping

### Task 1: Fix package name

**Files:**
- Modify: `package.json` (line 2)

- [ ] **Step 1: Update name field**

Change `"name": "ai-studio-applet"` → `"name": "stellar-toolkit-dash"`.

- [ ] **Step 2: Verify no tooling relies on the old name**

```bash
grep -r "ai-studio-applet" .
```
Expected: zero matches (Firebase config may reference it — check `.firebaserc` if it exists).

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: rename package to stellar-toolkit-dash"
```

---

### Task 2: Eliminate use-wallets shim

The file `hooks/use-wallets.ts` is a one-line re-export kept for backwards compatibility with `app/page.tsx`. Remove the indirection.

**Files:**
- Modify: `app/page.tsx` (line 30)
- Delete: `hooks/use-wallets.ts`

- [ ] **Step 1: Update the import in app/page.tsx**

Find:
```ts
import { useWallets } from "@/hooks/use-wallets";
```
Replace with:
```ts
import { useWalletsV2 as useWallets } from "@/hooks/use-wallets-v2";
```

- [ ] **Step 2: Verify nothing else imports the shim**

```bash
grep -r "use-wallets[^-]" app/ components/ hooks/ lib/
```
Expected: zero matches.

- [ ] **Step 3: Delete the shim**

```bash
rm hooks/use-wallets.ts
```

- [ ] **Step 4: Run type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx
git rm hooks/use-wallets.ts
git commit -m "chore: remove use-wallets re-export shim, import v2 directly"
```

---

## Chunk 2: Vitest Setup

### Task 3: Install Vitest

**Files:**
- Modify: `package.json` (devDependencies + scripts)
- Create: `vitest.config.ts`

- [ ] **Step 1: Install packages**

```bash
npm install --save-dev vitest @vitest/coverage-v8
```

- [ ] **Step 2: Create vitest.config.ts**

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["lib/**/*.ts", "hooks/**/*.ts"],
      exclude: ["**/*.d.ts", "**/types.ts"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
```

- [ ] **Step 3: Add test script to package.json**

In the `"scripts"` block, add:
```json
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage"
```

- [ ] **Step 4: Verify Vitest is importable**

Create a canary test `tests/canary.test.ts`:
```ts
import { describe, it, expect } from "vitest";

describe("vitest setup", () => {
  it("works", () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run:
```bash
npm test
```
Expected: 1 test passing.

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts tests/canary.test.ts package.json package-lock.json
git commit -m "chore: add Vitest with coverage, canary test passes"
```

---

## Chunk 3: Tests for lib/format.ts

`lib/format.ts` exports three pure functions: `shortAddr`, `formatXlm`, `parseAddresses`. All are side-effect-free and easy to test.

**Files:**
- Create: `tests/lib/format.test.ts`
- No modifications to source — tests only.

- [ ] **Step 1: Write the tests**

```ts
// tests/lib/format.test.ts
import { describe, it, expect } from "vitest";
import { shortAddr, formatXlm, parseAddresses } from "@/lib/format";

const VALID_ADDR = "GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3STPW7C7R";
const VALID_ADDR2 = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

describe("shortAddr", () => {
  it("returns 4+…+4 format", () => {
    expect(shortAddr(VALID_ADDR)).toBe("GAHJ…C7R");
  });

  it("returns short strings unchanged", () => {
    expect(shortAddr("GABC")).toBe("GABC");
    expect(shortAddr("")).toBe("");
  });

  it("handles exactly 8 chars", () => {
    expect(shortAddr("ABCDEFGH")).toBe("ABCD…EFGH");
  });
});

describe("formatXlm", () => {
  it("formats whole numbers with no decimals", () => {
    // locale-safe: just check it contains the digits and no trailing zeros
    const result = formatXlm(1000);
    expect(result).toContain("1");
    expect(result).not.toMatch(/\.?0+$/);
  });

  it("formats fractional values and trims trailing zeros", () => {
    const result = formatXlm(0.5);
    expect(result).toContain("5");
    expect(result).not.toMatch(/50*$/); // no trailing zeros
  });

  it("handles zero", () => {
    expect(formatXlm(0)).toBe("0");
  });

  it("respects up to 7 decimal places", () => {
    const result = formatXlm(0.0000001);
    // At least the digit 1 must appear
    expect(result).toContain("1");
  });
});

describe("parseAddresses", () => {
  it("returns valid addresses from multiline string", () => {
    const input = `${VALID_ADDR}\n${VALID_ADDR2}`;
    const result = parseAddresses(input);
    expect(result).toEqual([VALID_ADDR, VALID_ADDR2]);
  });

  it("deduplicates addresses", () => {
    const input = `${VALID_ADDR}\n${VALID_ADDR}`;
    expect(parseAddresses(input)).toHaveLength(1);
  });

  it("filters out invalid lines", () => {
    const input = `not-an-address\n${VALID_ADDR}\n  `;
    const result = parseAddresses(input);
    expect(result).toEqual([VALID_ADDR]);
  });

  it("trims whitespace from lines", () => {
    const input = `  ${VALID_ADDR}  `;
    expect(parseAddresses(input)).toEqual([VALID_ADDR]);
  });

  it("returns empty array for empty input", () => {
    expect(parseAddresses("")).toEqual([]);
    expect(parseAddresses("   \n\n  ")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify all pass**

```bash
npm test tests/lib/format.test.ts
```
Expected: 11 tests passing.

- [ ] **Step 3: Commit**

```bash
git add tests/lib/format.test.ts
git commit -m "test: add unit tests for lib/format.ts (shortAddr, formatXlm, parseAddresses)"
```

---

## Chunk 4: Tests for lib/address-resolver.ts

`resolveAddress` is the priority lookup function used everywhere via ShortAddress. Clear inputs, clear expected outputs.

**Files:**
- Create: `tests/lib/address-resolver.test.ts`

- [ ] **Step 1: Write the tests**

```ts
// tests/lib/address-resolver.test.ts
import { describe, it, expect } from "vitest";
import { resolveAddress } from "@/lib/address-resolver";
import type { AddressBookEntry } from "@/hooks/use-address-book";
import type { KnownIntermediary, KnownCreator } from "@/lib/intermediary-tracer/types";
import type { AssetGroup } from "@/lib/asset-groups/types";

const ADDR = "GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3STPW7C7R";
const ADDR2 = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

const bookEntry: AddressBookEntry = {
  publicKey: ADDR,
  label: "My Wallet",
  timestamp: 1000,
};

const intermediary: KnownIntermediary = {
  address: ADDR,
  name: "Known Intermediary",
  addedAt: 1000,
};

const creator: KnownCreator = {
  address: ADDR,
  name: "Known Creator",
  addedAt: 1000,
};

const group: AssetGroup = {
  id: "g1",
  name: "Test Group",
  assetCode: "USDC",
  issuer: ADDR2,
  network: "public",
  notes: "",
  createdAt: 1000,
  updatedAt: 1000,
  members: [
    {
      id: "m1",
      groupId: "g1",
      address: ADDR,
      role: "issuer",
      label: "Token Issuer",
      notes: "",
      homeDomain: "",
      addedAt: 1000,
    },
  ],
};

describe("resolveAddress — source: none", () => {
  it("returns none when address not found in any source", () => {
    const result = resolveAddress(ADDR, [], [], [], []);
    expect(result.source).toBe("none");
    expect(result.name).toBeUndefined();
  });
});

describe("resolveAddress — source: book", () => {
  it("resolves from address book when no higher-priority match", () => {
    const result = resolveAddress(ADDR, [bookEntry], [], [], []);
    expect(result.source).toBe("book");
    expect(result.name).toBe("My Wallet");
    expect(result.badge).toBeUndefined();
  });
});

describe("resolveAddress — source: group", () => {
  it("resolves from group, beating address book", () => {
    const result = resolveAddress(ADDR, [bookEntry], [], [], [group]);
    expect(result.source).toBe("group");
    expect(result.name).toBe("Token Issuer");
    expect(result.badge).toBe("ISSUER");
    expect(result.badgeClass).toContain("purple");
  });

  it("falls back to group name when member has no label", () => {
    const groupNoLabel: AssetGroup = {
      ...group,
      members: [{ ...group.members[0], label: "" }],
    };
    const result = resolveAddress(ADDR, [], [], [], [groupNoLabel]);
    expect(result.name).toBe("Test Group");
  });
});

describe("resolveAddress — source: creator", () => {
  it("resolves as creator, beating group", () => {
    const result = resolveAddress(ADDR, [], [], [creator], [group]);
    expect(result.source).toBe("creator");
    expect(result.name).toBe("Known Creator");
    expect(result.badge).toBe("CREATOR");
    expect(result.badgeClass).toContain("green");
  });
});

describe("resolveAddress — source: intermediary (highest priority)", () => {
  it("resolves as intermediary, beating creator", () => {
    const result = resolveAddress(ADDR, [], [intermediary], [creator], [group]);
    expect(result.source).toBe("intermediary");
    expect(result.name).toBe("Known Intermediary");
    expect(result.badge).toBe("INTERMEDIARY");
    expect(result.badgeClass).toContain("yellow");
  });
});

describe("resolveAddress — priority order", () => {
  it("intermediary > creator > group > book", () => {
    const r1 = resolveAddress(ADDR, [bookEntry], [intermediary], [creator], [group]);
    expect(r1.source).toBe("intermediary");

    const r2 = resolveAddress(ADDR, [bookEntry], [], [creator], [group]);
    expect(r2.source).toBe("creator");

    const r3 = resolveAddress(ADDR, [bookEntry], [], [], [group]);
    expect(r3.source).toBe("group");

    const r4 = resolveAddress(ADDR, [bookEntry], [], [], []);
    expect(r4.source).toBe("book");
  });
});
```

- [ ] **Step 2: Run to verify all pass**

```bash
npm test tests/lib/address-resolver.test.ts
```
Expected: all tests passing.

> **Note:** If TypeScript complains about `AssetGroup` or `KnownIntermediary` field shapes, read the actual type definitions in `lib/asset-groups/types.ts` and `lib/intermediary-tracer/types.ts` and adjust the test fixtures to match exactly.

- [ ] **Step 3: Commit**

```bash
git add tests/lib/address-resolver.test.ts
git commit -m "test: add unit tests for resolveAddress priority logic"
```

---

## Chunk 5: Tests for lib/intermediary-tracer/matcher.ts

`scoreCandidate` computes confidence from amount + time. Fully pure.

**Files:**
- Create: `tests/lib/intermediary-tracer/matcher.test.ts`

- [ ] **Step 1: Write the tests**

```ts
// tests/lib/intermediary-tracer/matcher.test.ts
import { describe, it, expect } from "vitest";
import { scoreCandidate } from "@/lib/intermediary-tracer/matcher";

const WINDOW = 60; // 60-second match window

// Helpers: produce ISO strings N seconds apart
function isoAt(base: Date, offsetSec: number): string {
  return new Date(base.getTime() + offsetSec * 1000).toISOString();
}

const BASE = new Date("2025-01-01T00:00:00Z");

describe("scoreCandidate — timing", () => {
  it("gives 0 confidence when create happens before sent", () => {
    const sentAt = isoAt(BASE, 10);   // sent at T+10
    const createdAt = isoAt(BASE, 5); // created at T+5 (before sent — impossible)
    const result = scoreCandidate(100, 100, sentAt, createdAt, WINDOW);
    expect(result.confidence).toBe(0);
  });

  it("gives 0 confidence when time delta exceeds window", () => {
    const sentAt = isoAt(BASE, 0);
    const createdAt = isoAt(BASE, WINDOW + 1);
    const result = scoreCandidate(100, 100, sentAt, createdAt, WINDOW);
    expect(result.confidence).toBe(0);
  });

  it("gives non-zero confidence within window", () => {
    const sentAt = isoAt(BASE, 0);
    const createdAt = isoAt(BASE, 5); // 5 seconds later
    const result = scoreCandidate(100, 100, sentAt, createdAt, WINDOW);
    expect(result.confidence).toBeGreaterThan(0);
  });
});

describe("scoreCandidate — amount matching", () => {
  it("gives perfect amount score when amounts match exactly", () => {
    const sentAt = isoAt(BASE, 0);
    const createdAt = isoAt(BASE, 0);
    const result = scoreCandidate(100, 100, sentAt, createdAt, WINDOW);
    expect(result.amountDiffPct).toBe(0);
    // confidence should be high (both scores perfect)
    expect(result.confidence).toBeGreaterThan(50);
  });

  it("gives lower confidence when amounts differ by >5%", () => {
    const sentAt = isoAt(BASE, 0);
    const createdAt = isoAt(BASE, 0);
    // 10% difference
    const result = scoreCandidate(100, 110, sentAt, createdAt, WINDOW);
    expect(result.amountDiffPct).toBeCloseTo(10, 0);
  });

  it("handles zero starting balance without crashing", () => {
    const sentAt = isoAt(BASE, 0);
    const createdAt = isoAt(BASE, 1);
    const result = scoreCandidate(100, 0, sentAt, createdAt, WINDOW);
    expect(result.confidence).toBe(0); // amountDiffPct = 100%
  });
});

describe("scoreCandidate — timeDeltaSec field", () => {
  it("reports correct time delta", () => {
    const sentAt = isoAt(BASE, 0);
    const createdAt = isoAt(BASE, 15);
    const result = scoreCandidate(100, 100, sentAt, createdAt, WINDOW);
    expect(result.timeDeltaSec).toBe(15);
  });

  it("reports negative delta when create is before sent", () => {
    const sentAt = isoAt(BASE, 10);
    const createdAt = isoAt(BASE, 0);
    const result = scoreCandidate(100, 100, sentAt, createdAt, WINDOW);
    expect(result.timeDeltaSec).toBeLessThan(0);
  });
});
```

- [ ] **Step 2: Run to verify all pass**

```bash
npm test tests/lib/intermediary-tracer/matcher.test.ts
```
Expected: all passing. If any test reveals a bug in `scoreCandidate`, fix `matcher.ts` and re-run.

- [ ] **Step 3: Commit**

```bash
git add tests/lib/intermediary-tracer/matcher.test.ts
git commit -m "test: add unit tests for scoreCandidate in matcher.ts"
```

---

## Chunk 6: Tests for lib/bulk-payments/builder.ts (estimateCost)

`estimateCost` is pure and easily testable. `buildBatchTransaction` requires a real Stellar `Account` object and network passphrase — test the math-only parts.

**Files:**
- Create: `tests/lib/bulk-payments/builder.test.ts`

- [ ] **Step 1: Write the tests**

```ts
// tests/lib/bulk-payments/builder.test.ts
import { describe, it, expect } from "vitest";
import {
  estimateCost,
  MIN_PAYMENT_AMOUNT,
  BATCH_SIZE,
  BASE_FEE,
} from "@/lib/bulk-payments/builder";

const MIN_XLM = parseFloat(MIN_PAYMENT_AMOUNT); // 0.0000001

describe("constants", () => {
  it("MIN_PAYMENT_AMOUNT is 1 stroop", () => {
    expect(MIN_PAYMENT_AMOUNT).toBe("0.0000001");
  });
  it("BATCH_SIZE is 100", () => {
    expect(BATCH_SIZE).toBe(100);
  });
  it("BASE_FEE is 100 stroops", () => {
    expect(BASE_FEE).toBe("100");
  });
});

describe("estimateCost", () => {
  it("calculates correct batch count for exact multiple", () => {
    const result = estimateCost(200, 100);
    expect(result.batches).toBe(2);
  });

  it("rounds batch count up for partial batch", () => {
    const result = estimateCost(150, 100);
    expect(result.batches).toBe(2);
  });

  it("counts a single recipient as 1 batch", () => {
    const result = estimateCost(1, 100);
    expect(result.batches).toBe(1);
  });

  it("calculates fees correctly (100 recipients, 1x multiplier)", () => {
    // 100 recipients × 100 stroops × 1 multiplier = 10000 stroops = 0.001 XLM
    const result = estimateCost(100, 100, 1, 0);
    expect(result.feesXlm).toBeCloseTo(0.001, 7);
  });

  it("applies fee multiplier correctly", () => {
    const result1 = estimateCost(100, 100, 1, 0);
    const result2 = estimateCost(100, 100, 2, 0);
    expect(result2.feesXlm).toBeCloseTo(result1.feesXlm * 2, 7);
  });

  it("adds payment XLM for native asset", () => {
    const result = estimateCost(100, 100, 1, MIN_XLM);
    expect(result.paymentsXlm).toBeCloseTo(100 * MIN_XLM, 10);
    expect(result.totalXlm).toBeCloseTo(result.feesXlm + result.paymentsXlm, 10);
  });

  it("payments are zero when paymentXlmEach is 0 (non-native asset)", () => {
    const result = estimateCost(50, 100, 1, 0);
    expect(result.paymentsXlm).toBe(0);
    expect(result.totalXlm).toBe(result.feesXlm);
  });

  it("uses defaults when called with only recipientCount", () => {
    const result = estimateCost(100);
    expect(result.batches).toBe(1);  // 100 / 100 = 1 batch
    expect(result.feesXlm).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify all pass**

```bash
npm test tests/lib/bulk-payments/builder.test.ts
```
Expected: all passing.

- [ ] **Step 3: Remove the canary test**

```bash
rm tests/canary.test.ts
git rm tests/canary.test.ts
```

- [ ] **Step 4: Run full test suite**

```bash
npm test
```
Expected: all tests across all files pass.

- [ ] **Step 5: Commit**

```bash
git add tests/lib/bulk-payments/builder.test.ts
git commit -m "test: add unit tests for estimateCost in bulk-payments/builder.ts; remove canary"
```

---

## Done

All tasks complete. What was shipped:

| Change | Risk | Value |
|--------|------|-------|
| Package name fix | Zero | Correctness |
| use-wallets shim removed | Very low (single import updated) | Dead code eliminated |
| Vitest configured | Zero | Testing foundation |
| format.ts tests | Zero | Regression safety on formatters |
| address-resolver.ts tests | Zero | Regression safety on priority logic |
| matcher.ts tests | Zero | Regression safety on confidence scoring |
| builder.ts tests | Zero | Regression safety on cost estimation |

**Next plans:**
- `2026-03-10-shared-component-extraction.md` — Extract LogPanel, AddressInput, GroupQuickAdd into `components/shared/`
- `2026-03-10-new-features.md` — Command Palette (Cmd+K), DB export/import, Dashboard home page
