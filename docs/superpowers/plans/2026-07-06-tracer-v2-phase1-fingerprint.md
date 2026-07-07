# Tracer v2 — Phase 1 (Fingerprint) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New "Tracer v2" module whose first tab (Fingerprint) scores every pair of asset groups 0–100 for "likely same operator" from data already in the local DB — zero Horizon calls.

**Architecture:** Pure scoring engine in `lib/tracer-v2/fingerprint.ts` (unit-tested with vitest), consumed by a client component `FingerprintTab` inside a new `TracerV2Panel` tabs shell at route `app/(analysis)/tracer-v2/`. All inputs come from five existing DB-cache hooks. Aggregation is dampened probabilistic-OR with a single-item cap and an issuer/distributor short-circuit.

**Tech Stack:** Next.js App Router, React client components, shared UI kit (`@/components/ui`), vitest, lucide-react icons.

## Global Constraints

- Do NOT modify any file under `components/intermediary-tracer/` and do not change existing exports in `lib/intermediary-tracer/` (signed-off module).
- Spec: `docs/superpowers/specs/2026-07-06-tracer-v2-design.md`. Phase 1 only — do NOT add UI or stubs for Bulk Trace / Watchlist / Flow Graph tabs.
- Never use raw HTML `<input>`, `<button>`, `<select>` — use `@/components/ui` (`Button`, `Input`, `Select`).
- All Stellar addresses render via `<ShortAddress address={...} />` from `@/components/shared/ShortAddress` (verify exact import path by looking at how `components/wallet-balances/WalletBalancesPanel.tsx` imports it, and copy that import).
- Asset codes: never force-uppercase for display; comparisons use `.toUpperCase()` on both sides.
- The member type is `GroupMember` (there is no `AssetGroupMember`).
- Test command: `npx vitest run tests/lib/tracer-v2/fingerprint.test.ts`. Typecheck: `npx tsc --noEmit`.
- Commit after each task, message style: conventional commits, no Claude attribution of any kind.

## File Structure

- Create `lib/tracer-v2/types.ts` — dataset/result types for the engine
- Create `lib/tracer-v2/fingerprint.ts` — constants + `computeFingerprints()`
- Create `tests/lib/tracer-v2/fingerprint.test.ts` — engine unit tests
- Create `components/tracer-v2/FingerprintTab.tsx` — results table UI
- Create `components/tracer-v2/TracerV2Panel.tsx` — tabs shell (one tab for now)
- Create `app/(analysis)/tracer-v2/page.tsx` — route
- Modify `lib/navigation.ts` — add menu entry in the Analysis section

---

### Task 1: Fingerprint engine (types + scoring, TDD)

**Files:**
- Create: `lib/tracer-v2/types.ts`
- Create: `lib/tracer-v2/fingerprint.ts`
- Test: `tests/lib/tracer-v2/fingerprint.test.ts`

**Interfaces:**
- Consumes: `AssetGroup`, `GroupMember`, `GroupMemberRole` from `@/lib/asset-groups/types`; `KnownCreator`, `CreatorChild` from `@/lib/intermediary-tracer/types`; `SavedAnalysis` from `@/hooks/use-saved-analyses` (type-only import — it is exported from the hook file).
- Produces: `computeFingerprints(data: FingerprintDatasets): OperatorMatch[]` plus types `FingerprintDatasets`, `OperatorMatch`, `EvidenceItem`, `FingerprintSignal`, and constant `MIN_VISIBLE_SCORE` — Task 2 imports all of these.

- [ ] **Step 1: Write `lib/tracer-v2/types.ts`**

```typescript
import type { AssetGroup } from "@/lib/asset-groups/types";
import type { KnownCreator, CreatorChild } from "@/lib/intermediary-tracer/types";
import type { SavedAnalysis } from "@/hooks/use-saved-analyses";

/** Everything the fingerprint engine reads. All arrays come from existing DB-cache hooks. */
export interface FingerprintDatasets {
  groups: AssetGroup[];
  knownCreators: KnownCreator[];
  creatorChildren: CreatorChild[];
  analyses: SavedAnalysis[];
}

export type FingerprintSignal =
  | "shared-address"
  | "shared-top-destination"
  | "shared-home-domain"
  | "shared-lineage";

export interface EvidenceItem {
  signal: FingerprintSignal;
  /** Stellar address for address/lineage signals; lowercased domain for domain signal */
  entity: string;
  /** Human-readable summary, e.g. "BANK in Group A / INTERMEDIARY in Group B" */
  detail: string;
  /** Effective weight after dampening and cap, 0..1 */
  weight: number;
  /** How many groups (or assets, for top-destination) this entity appears in */
  entityGroupCount: number;
}

export type MatchTier = "confirmed" | "strong" | "moderate" | "weak";

export interface OperatorMatch {
  groupAId: string;
  groupBId: string;
  network: string;
  score: number; // 0-100
  tier: MatchTier;
  /** True when issuer/distributor short-circuit fired */
  confirmedByRole: boolean;
  evidence: EvidenceItem[];
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/lib/tracer-v2/fingerprint.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { computeFingerprints, damp } from "@/lib/tracer-v2/fingerprint";
import type { FingerprintDatasets } from "@/lib/tracer-v2/types";
import type { AssetGroup, GroupMember, GroupMemberRole } from "@/lib/asset-groups/types";
import type { SavedAnalysis } from "@/hooks/use-saved-analyses";

let idCounter = 0;
function member(groupId: string, address: string, role: GroupMemberRole, homeDomain?: string): GroupMember {
  return { id: `m${++idCounter}`, groupId, address, role, homeDomain, addedAt: 0 };
}
function group(id: string, name: string, members: Omit<GroupMember, "groupId">[], opts?: Partial<AssetGroup>): AssetGroup {
  return {
    id, name, network: "public", createdAt: 0, updatedAt: 0,
    members: members.map((m) => ({ ...m, groupId: id })),
    ...opts,
  };
}
function base(groups: AssetGroup[], extra?: Partial<FingerprintDatasets>): FingerprintDatasets {
  return { groups, knownCreators: [], creatorChildren: [], analyses: [], ...extra };
}

const ADDR = (n: number) => `G${String(n).padStart(55, "A")}`; // fake but distinct addresses

describe("damp", () => {
  it("is 1.0 at k=2 and decays", () => {
    expect(damp(2)).toBeCloseTo(1.0);
    expect(damp(4)).toBeCloseTo(0.5);
    expect(damp(8)).toBeCloseTo(1 / 3);
  });
});

describe("computeFingerprints", () => {
  it("returns empty for fewer than 2 groups", () => {
    const g = group("a", "A", [member("a", ADDR(1), "issuer")]);
    expect(computeFingerprints(base([g]))).toEqual([]);
  });

  it("short-circuits to 100 confirmed when issuer shared as issuer/distributor in both groups", () => {
    const shared = ADDR(1);
    const a = group("a", "A", [member("a", shared, "issuer")]);
    const b = group("b", "B", [member("b", shared, "distributor")]);
    const [m] = computeFingerprints(base([a, b]));
    expect(m.score).toBe(100);
    expect(m.tier).toBe("confirmed");
    expect(m.confirmedByRole).toBe(true);
  });

  it("scores a single shared intermediary at 50 (moderate)", () => {
    const shared = ADDR(2);
    const a = group("a", "A", [member("a", shared, "intermediary")]);
    const b = group("b", "B", [member("b", shared, "intermediary")]);
    const [m] = computeFingerprints(base([a, b]));
    expect(m.score).toBe(50); // 0.5 weight, damp(2)=1, prob-OR of one item
    expect(m.tier).toBe("moderate");
  });

  it("dampens an address that appears in many groups", () => {
    const noisy = ADDR(3);
    const groups = Array.from({ length: 10 }, (_, i) =>
      group(`g${i}`, `G${i}`, [member(`g${i}`, noisy, "other")]),
    );
    const matches = computeFingerprints(base(groups));
    for (const m of matches) expect(m.score).toBeLessThanOrEqual(10); // 0.15 × damp(10) ≈ 0.045
  });

  it("compounds independent evidence with diminishing returns, capped per item", () => {
    // 4 distinct shared bank addresses (weight 0.5 each, k=2) → 1-(0.5^4) = 93.75 → 94
    const a = group("a", "A", [1, 2, 3, 4].map((n) => member("a", ADDR(10 + n), "bank")));
    const b = group("b", "B", [1, 2, 3, 4].map((n) => member("b", ADDR(10 + n), "bank")));
    const [m] = computeFingerprints(base([a, b]));
    expect(m.score).toBe(94);
    expect(m.tier).toBe("strong");
    expect(m.evidence).toHaveLength(4);
  });

  it("detects shared home domain, skipping domains in more than 8 groups", () => {
    const a = group("a", "A", [member("a", ADDR(20), "issuer", "operator.example")]);
    const b = group("b", "B", [member("b", ADDR(21), "issuer", "operator.example")]);
    const [m] = computeFingerprints(base([a, b]));
    expect(m.score).toBe(35); // W_HOME_DOMAIN 0.35, damp(2)=1
    expect(m.evidence[0].signal).toBe("shared-home-domain");

    const noisy = Array.from({ length: 9 }, (_, i) =>
      group(`n${i}`, `N${i}`, [member(`n${i}`, ADDR(30 + i), "issuer", "lobstr.co")]),
    );
    const noisyMatches = computeFingerprints(base(noisy));
    expect(noisyMatches).toEqual([]); // domain clutter — no evidence emitted
  });

  it("detects shared lineage via a known creator's children", () => {
    const creator = ADDR(40);
    const childA = ADDR(41);
    const childB = ADDR(42);
    const a = group("a", "A", [member("a", childA, "other")]);
    const b = group("b", "B", [member("b", childB, "other")]);
    const data = base([a, b], {
      knownCreators: [{ address: creator, name: "Creator X", addedAt: 0 }],
      creatorChildren: [
        { id: "c1", creatorAddress: creator, childAddress: childA, network: "public", discoveredAt: 0 },
        { id: "c2", creatorAddress: creator, childAddress: childB, network: "public", discoveredAt: 0 },
      ],
    });
    const [m] = computeFingerprints(data);
    expect(m.score).toBe(55); // W_LINEAGE 0.55, damp(2)=1
    expect(m.evidence[0].signal).toBe("shared-lineage");
    expect(m.evidence[0].entity).toBe(creator);
  });

  it("detects shared top destination across analyses of two different assets", () => {
    const dest = ADDR(50);
    const a = group("a", "AAA Asset", [member("a", ADDR(51), "issuer")], { assetCode: "AAA", issuer: ADDR(51) });
    const b = group("b", "BBB Asset", [member("b", ADDR(52), "issuer")], { assetCode: "BBB", issuer: ADDR(52) });
    const mkAnalysis = (assetCode: string, issuer: string): SavedAnalysis => ({
      id: `an-${assetCode}`, name: assetCode, assetCode, issuer, distribAddresses: [],
      network: "public", timestamp: 0,
      result: {
        assetCode, issuer, accounts: [], totalAssetSold: 0, totalXlmProceeds: 0,
        totalOutgoingXlm: 0, estimatedOnHandXlm: 0, dexTradeCount: 0, pathSaleCount: 0,
        proceedsLedger: [], outgoingLedger: [],
        topDestinations: [{ address: dest, totalXlm: 1000, count: 3 }],
      },
    });
    const data = base([a, b], { analyses: [mkAnalysis("AAA", ADDR(51)), mkAnalysis("BBB", ADDR(52))] });
    const [m] = computeFingerprints(data);
    expect(m.score).toBe(40); // W_TOP_DESTINATION 0.4, damp(2)=1
    expect(m.evidence[0].signal).toBe("shared-top-destination");
  });

  it("dedups by entity — same address firing multiple signals counts once at its highest weight", () => {
    const shared = ADDR(60);
    // shared as bank member AND as top destination of both assets
    const a = group("a", "A", [member("a", shared, "bank"), member("a", ADDR(61), "issuer")], { assetCode: "CCC", issuer: ADDR(61) });
    const b = group("b", "B", [member("b", shared, "bank"), member("b", ADDR(62), "issuer")], { assetCode: "DDD", issuer: ADDR(62) });
    const mk = (assetCode: string, issuer: string): SavedAnalysis => ({
      id: `an-${assetCode}`, name: assetCode, assetCode, issuer, distribAddresses: [],
      network: "public", timestamp: 0,
      result: {
        assetCode, issuer, accounts: [], totalAssetSold: 0, totalXlmProceeds: 0,
        totalOutgoingXlm: 0, estimatedOnHandXlm: 0, dexTradeCount: 0, pathSaleCount: 0,
        proceedsLedger: [], outgoingLedger: [],
        topDestinations: [{ address: shared, totalXlm: 500, count: 1 }],
      },
    });
    const data = base([a, b], { analyses: [mk("CCC", ADDR(61)), mk("DDD", ADDR(62))] });
    const [m] = computeFingerprints(data);
    const items = m.evidence.filter((e) => e.entity === shared);
    expect(items).toHaveLength(1);
    expect(items[0].signal).toBe("shared-address"); // 0.5 bank beats 0.4 destination
    expect(m.score).toBe(50);
  });

  it("never pairs groups on different networks", () => {
    const shared = ADDR(70);
    const a = group("a", "A", [member("a", shared, "intermediary")]);
    const b = group("b", "B", [member("b", shared, "intermediary")], { network: "testnet" });
    expect(computeFingerprints(base([a, b]))).toEqual([]);
  });

  it("sorts results by score descending", () => {
    const s1 = ADDR(80); const s2 = ADDR(81);
    const a = group("a", "A", [member("a", s1, "intermediary")]);
    const b = group("b", "B", [member("b", s1, "intermediary")]);
    const c = group("c", "C", [member("c", s2, "other")]);
    const d = group("d", "D", [member("d", s2, "other")]);
    const matches = computeFingerprints(base([a, b, c, d]));
    expect(matches[0].score).toBeGreaterThan(matches[1].score);
  });
});
```

- [ ] **Step 3: Run tests, verify they fail**

Run: `npx vitest run tests/lib/tracer-v2/fingerprint.test.ts`
Expected: FAIL — cannot resolve `@/lib/tracer-v2/fingerprint`.

- [ ] **Step 4: Write `lib/tracer-v2/fingerprint.ts`**

```typescript
import type { AssetGroup, GroupMemberRole } from "@/lib/asset-groups/types";
import { ROLE_LABELS } from "@/lib/asset-groups/types";
import type {
  EvidenceItem,
  FingerprintDatasets,
  MatchTier,
  OperatorMatch,
} from "./types";

// ── Tuning constants (all scoring knobs live here) ──────────────────────────
export const ROLE_WEIGHT: Record<GroupMemberRole, number> = {
  issuer: 0.6,
  distributor: 0.6,
  intermediary: 0.5,
  bank: 0.5,
  creator: 0.5,
  withdrawal: 0.45,
  destination: 0.3,
  service: 0.15,
  other: 0.15,
};
export const W_TOP_DESTINATION = 0.4;
export const W_HOME_DOMAIN = 0.35;
export const W_LINEAGE = 0.55;
/** A single evidence item can never push a pair past "moderate" on its own */
export const SINGLE_ITEM_CAP = 0.6;
/** Domains present in more than this many groups are pure clutter — no evidence emitted */
export const DOMAIN_CLUTTER_LIMIT = 8;
export const MIN_VISIBLE_SCORE = 25;

/** IDF-style dampening: k=2 → 1.0, k=4 → 0.5, k=8 → 1/3. Exchange-address noise self-suppresses. */
export function damp(k: number): number {
  return 1 / (1 + Math.log2(Math.max(k, 2) / 2));
}

function tierFor(score: number, confirmedByRole: boolean): MatchTier {
  if (confirmedByRole) return "confirmed";
  if (score >= 80) return "strong";
  if (score >= 50) return "moderate";
  return "weak";
}

const CONFIRM_ROLES: ReadonlySet<GroupMemberRole> = new Set(["issuer", "distributor"]);

interface GroupIndex {
  group: AssetGroup;
  /** address → role (highest-weight role wins if duplicated) */
  roleByAddress: Map<string, GroupMemberRole>;
  /** lowercased non-empty home domains of members */
  domains: Set<string>;
  /** addresses from topDestinations of analyses matching this group's asset */
  topDestinations: Set<string>;
}

function buildIndex(group: AssetGroup, datasets: FingerprintDatasets): GroupIndex {
  const roleByAddress = new Map<string, GroupMemberRole>();
  const domains = new Set<string>();
  for (const m of group.members) {
    const prev = roleByAddress.get(m.address);
    if (!prev || ROLE_WEIGHT[m.role] > ROLE_WEIGHT[prev]) roleByAddress.set(m.address, m.role);
    const d = m.homeDomain?.trim().toLowerCase();
    if (d) domains.add(d);
  }
  const topDestinations = new Set<string>();
  if (group.assetCode && group.issuer) {
    for (const an of datasets.analyses) {
      if (
        an.network === group.network &&
        an.issuer === group.issuer &&
        an.assetCode.toUpperCase() === group.assetCode.toUpperCase()
      ) {
        for (const d of an.result.topDestinations) topDestinations.add(d.address);
      }
    }
  }
  return { group, roleByAddress, domains, topDestinations };
}

export function computeFingerprints(datasets: FingerprintDatasets): OperatorMatch[] {
  const indexes = datasets.groups.map((g) => buildIndex(g, datasets));

  // Global entity frequencies for dampening
  const addressGroupCount = new Map<string, number>();
  const domainGroupCount = new Map<string, number>();
  const destAssetCount = new Map<string, number>();
  for (const idx of indexes) {
    for (const addr of idx.roleByAddress.keys())
      addressGroupCount.set(addr, (addressGroupCount.get(addr) ?? 0) + 1);
    for (const d of idx.domains) domainGroupCount.set(d, (domainGroupCount.get(d) ?? 0) + 1);
    for (const a of idx.topDestinations) destAssetCount.set(a, (destAssetCount.get(a) ?? 0) + 1);
  }

  // creator → set of child addresses, and creator → # groups containing ≥1 child
  const childrenByCreator = new Map<string, Set<string>>();
  for (const c of datasets.creatorChildren) {
    let set = childrenByCreator.get(c.creatorAddress);
    if (!set) childrenByCreator.set(c.creatorAddress, (set = new Set()));
    set.add(c.childAddress);
  }
  const creatorGroupCount = new Map<string, number>();
  for (const [creator, children] of childrenByCreator) {
    let n = 0;
    for (const idx of indexes) {
      let hit = false;
      for (const child of children) if (idx.roleByAddress.has(child)) { hit = true; break; }
      if (hit) n++;
    }
    creatorGroupCount.set(creator, n);
  }
  const creatorName = new Map(datasets.knownCreators.map((c) => [c.address, c.name]));

  const matches: OperatorMatch[] = [];

  for (let i = 0; i < indexes.length; i++) {
    for (let j = i + 1; j < indexes.length; j++) {
      const A = indexes[i];
      const B = indexes[j];
      if (A.group.network !== B.group.network) continue;

      // entity → best evidence item (dedup: one address firing several signals counts once)
      const best = new Map<string, EvidenceItem>();
      let confirmedByRole = false;

      const offer = (item: EvidenceItem) => {
        const prev = best.get(item.entity);
        if (!prev || item.weight > prev.weight) best.set(item.entity, item);
      };

      // Signal 1 — shared member address
      for (const [addr, roleA] of A.roleByAddress) {
        const roleB = B.roleByAddress.get(addr);
        if (!roleB) continue;
        if (CONFIRM_ROLES.has(roleA) && CONFIRM_ROLES.has(roleB)) confirmedByRole = true;
        const k = addressGroupCount.get(addr) ?? 2;
        const baseWeight = Math.max(ROLE_WEIGHT[roleA], ROLE_WEIGHT[roleB]);
        offer({
          signal: "shared-address",
          entity: addr,
          detail: `${ROLE_LABELS[roleA]} in ${A.group.name} / ${ROLE_LABELS[roleB]} in ${B.group.name}`,
          weight: Math.min(baseWeight * damp(k), SINGLE_ITEM_CAP),
          entityGroupCount: k,
        });
      }

      // Signal 2 — shared top destination across the two assets' analyses
      for (const addr of A.topDestinations) {
        if (!B.topDestinations.has(addr)) continue;
        const k = destAssetCount.get(addr) ?? 2;
        offer({
          signal: "shared-top-destination",
          entity: addr,
          detail: `top XLM destination of both ${A.group.name} and ${B.group.name}`,
          weight: Math.min(W_TOP_DESTINATION * damp(k), SINGLE_ITEM_CAP),
          entityGroupCount: k,
        });
      }

      // Signal 3 — shared home domain
      for (const d of A.domains) {
        if (!B.domains.has(d)) continue;
        const k = domainGroupCount.get(d) ?? 2;
        if (k > DOMAIN_CLUTTER_LIMIT) continue;
        offer({
          signal: "shared-home-domain",
          entity: d,
          detail: `home domain "${d}" on members of both groups`,
          weight: Math.min(W_HOME_DOMAIN * damp(k), SINGLE_ITEM_CAP),
          entityGroupCount: k,
        });
      }

      // Signal 4 — shared lineage (same known creator's children in both groups)
      for (const [creator, children] of childrenByCreator) {
        let inA = false;
        let inB = false;
        for (const child of children) {
          if (A.roleByAddress.has(child)) inA = true;
          if (B.roleByAddress.has(child)) inB = true;
          if (inA && inB) break;
        }
        if (!inA || !inB) continue;
        const k = creatorGroupCount.get(creator) ?? 2;
        offer({
          signal: "shared-lineage",
          entity: creator,
          detail: `children of ${creatorName.get(creator) ?? "known creator"} in both groups`,
          weight: Math.min(W_LINEAGE * damp(k), SINGLE_ITEM_CAP),
          entityGroupCount: k,
        });
      }

      if (best.size === 0 && !confirmedByRole) continue;

      const evidence = [...best.values()].sort((a, b) => b.weight - a.weight);
      const score = confirmedByRole
        ? 100
        : Math.round(100 * (1 - evidence.reduce((p, e) => p * (1 - e.weight), 1)));

      matches.push({
        groupAId: A.group.id,
        groupBId: B.group.id,
        network: A.group.network,
        score,
        tier: tierFor(score, confirmedByRole),
        confirmedByRole,
        evidence,
      });
    }
  }

  return matches.sort((a, b) => b.score - a.score);
}
```

Note: check `lib/asset-groups/types.ts` actually exports `ROLE_LABELS` as a `Record<GroupMemberRole, string>` — it does per project docs; if the shape differs, adapt the `detail` strings, not the types.

- [ ] **Step 5: Run tests, verify they pass**

Run: `npx vitest run tests/lib/tracer-v2/fingerprint.test.ts`
Expected: PASS (all tests). If a score assertion is off by 1, check `Math.round` placement — round once, at the end, never per item.

- [ ] **Step 6: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add lib/tracer-v2/ tests/lib/tracer-v2/
git commit -m "feat(tracer-v2): fingerprint scoring engine with tests"
```

---

### Task 2: FingerprintTab UI

**Files:**
- Create: `components/tracer-v2/FingerprintTab.tsx`

**Interfaces:**
- Consumes: `computeFingerprints`, `MIN_VISIBLE_SCORE` from `@/lib/tracer-v2/fingerprint`; `OperatorMatch`, `EvidenceItem` from `@/lib/tracer-v2/types`; hooks `useAssetGroups()` (→ `{ groups, isLoaded, ... }`), `useKnownCreators()` (→ `{ entries }`), `useCreatorChildren()` (→ `{ all }`), `useSavedAnalyses()` (→ `{ analyses }`); `ShortAddress`; UI kit `Button`, `Select`.
- Produces: named export `FingerprintTab` (no props) — Task 3 renders it inside the panel.

- [ ] **Step 1: Write the component**

Full component. Before writing, open `components/wallet-balances/WalletBalancesPanel.tsx` and copy its exact import lines for `ShortAddress` and the `Select` family — use identical paths/idioms. Skeleton to impl