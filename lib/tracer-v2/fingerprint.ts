import type { AssetGroup, GroupMemberRole } from "@/lib/asset-groups/types";
import type { SavedAnalysis } from "@/hooks/use-saved-analyses";
import type { CreatorChild } from "@/lib/intermediary-tracer/types";
import type { EvidenceItem, FingerprintInput, OperatorMatch, OperatorTier } from "./types";

// ---------------------------------------------------------------------------
// Locked scoring model constants (see docs/superpowers/plans/2026-07-06-tracer-v2.md)
// ---------------------------------------------------------------------------
const ROLE_WEIGHT: Record<GroupMemberRole, number> = {
  issuer: 0.6, distributor: 0.6,
  intermediary: 0.5, bank: 0.5, creator: 0.5, withdrawal: 0.45,
  destination: 0.3, service: 0.15, other: 0.15,
};
const W_TOP_DESTINATION = 0.4;  // signal 2
const W_HOME_DOMAIN     = 0.35; // signal 3
const W_LINEAGE         = 0.55; // signal 4
const SINGLE_ITEM_CAP   = 0.6;  // one item alone can never exceed 60
const DOMAIN_CLUTTER_K  = 8;    // domains in >8 groups: skip evidence row entirely
const MIN_SCORE_DEFAULT = 25;   // UI hides below this

// Wallet / custodial / federation home domains. Many UNRELATED accounts set
// home_domain to these simply because they use that wallet/exchange — a shared
// value is NOT operator evidence, so signal 3 ignores it regardless of count.
// Suffix-matched (so `vault.lobstr.co` matches `lobstr.co`). Extend as needed.
const WALLET_SERVICE_DOMAINS = new Set<string>([
  "lobstr.co",
  "stellarterm.com",
  "stellarx.com",
  "stellarport.io",
  "keybase.io",
  "stellar.org",
]);

function isWalletServiceDomain(domain: string): boolean {
  const d = domain.trim().toLowerCase();
  for (const w of WALLET_SERVICE_DOMAINS) {
    if (d === w || d.endsWith("." + w)) return true;
  }
  return false;
}

// IDF dampening: k = number of groups (or distinct assets for signal 2) containing the entity
const damp = (k: number) => 1 / (1 + Math.log2(Math.max(k, 2) / 2));
// k=2→1.0, k=4→0.5, k=8→0.33, k=16→0.25

function shortAddr(address: string): string {
  if (address.length <= 8) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function assetKeyOf(code: string, issuer: string): string {
  return `${code}:${issuer}`;
}

function tierFor(score: number, shortCircuit: boolean): OperatorTier {
  if (shortCircuit) return "confirmed";
  if (score >= 80) return "strong";
  if (score >= 50) return "moderate";
  if (score >= 25) return "weak";
  return "hidden";
}

export function computeFingerprints(input: FingerprintInput): OperatorMatch[] {
  const { groups, analyses, creatorChildren } = input;
  const minScore = input.minScore ?? MIN_SCORE_DEFAULT;

  if (groups.length < 2) return [];

  // ---- Build indexes across all groups ----

  // address -> groupId -> Set<role held in that group>
  const addressToGroups = new Map<string, Map<string, Set<GroupMemberRole>>>();
  // domain -> Set<groupId> containing a member with that home domain
  const domainToGroupIds = new Map<string, Set<string>>();

  for (const g of groups) {
    for (const m of g.members) {
      if (!addressToGroups.has(m.address)) addressToGroups.set(m.address, new Map());
      const perGroup = addressToGroups.get(m.address)!;
      if (!perGroup.has(g.id)) perGroup.set(g.id, new Set());
      perGroup.get(g.id)!.add(m.role);

      const domain = m.homeDomain?.trim().toLowerCase();
      if (domain) {
        if (!domainToGroupIds.has(domain)) domainToGroupIds.set(domain, new Set());
        domainToGroupIds.get(domain)!.add(g.id);
      }
    }
  }

  // destination address -> Set<assetKey> it appears as a top destination for
  const destinationToAssets = new Map<string, Set<string>>();
  for (const a of analyses) {
    const assetKey = assetKeyOf(a.assetCode, a.issuer);
    for (const dest of a.result?.topDestinations ?? []) {
      if (!destinationToAssets.has(dest.address)) destinationToAssets.set(dest.address, new Set());
      destinationToAssets.get(dest.address)!.add(assetKey);
    }
  }

  // creator address -> Set<childAddress> (for lineage signal)
  const creatorToChildren = new Map<string, Set<string>>();
  for (const c of creatorChildren) {
    if (!creatorToChildren.has(c.creatorAddress)) creatorToChildren.set(c.creatorAddress, new Set());
    creatorToChildren.get(c.creatorAddress)!.add(c.childAddress);
  }

  const groupAssetKey = (g: AssetGroup): string | undefined =>
    g.assetCode && g.issuer ? assetKeyOf(g.assetCode, g.issuer) : undefined;

  const matches: OperatorMatch[] = [];

  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const a = groups[i];
      const b = groups[j];
      if (a.network !== b.network) continue;

      // ---- Short-circuit: same address is issuer/distributor in BOTH groups ----
      let shortCircuit = false;
      for (const ma of a.members) {
        if (ma.role !== "issuer" && ma.role !== "distributor") continue;
        const hit = b.members.some(
          (mb) => mb.address === ma.address && (mb.role === "issuer" || mb.role === "distributor"),
        );
        if (hit) {
          shortCircuit = true;
          break;
        }
      }

      if (shortCircuit) {
        matches.push({
          groupAId: a.id, groupAName: a.name,
          groupBId: b.id, groupBName: b.name,
          network: a.network,
          score: 100,
          tier: "confirmed",
          evidence: [],
          shortCircuit: true,
        });
        continue;
      }

      // ---- Collect evidence, keyed by shared entity (dedup: keep max effective weight) ----
      const evidenceByEntity = new Map<string, EvidenceItem>();
      const consider = (item: EvidenceItem) => {
        const existing = evidenceByEntity.get(item.entity);
        if (!existing || item.weight > existing.weight) {
          evidenceByEntity.set(item.entity, item);
        }
      };

      // Signal 1: shared address (any role, both groups)
      const bRoleByAddress = new Map(b.members.map((m) => [m.address, m.role]));
      for (const ma of a.members) {
        const roleB = bRoleByAddress.get(ma.address);
        if (!roleB) continue;
        const roleA = ma.role;
        const baseWeight = Math.max(ROLE_WEIGHT[roleA], ROLE_WEIGHT[roleB]);
        const k = addressToGroups.get(ma.address)?.size ?? 2;
        const weight = Math.min(baseWeight * damp(k), SINGLE_ITEM_CAP);
        consider({
          signal: "shared-address",
          entity: ma.address,
          roleA, roleB,
          entityGroupCount: k,
          weight,
          detail: `shared ${roleA === roleB ? roleA : `${roleA}/${roleB}`} ${shortAddr(ma.address)}`,
        });
      }

      // Signal 2: shared top-destination between the two groups' own assets
      const assetKeyA = groupAssetKey(a);
      const assetKeyB = groupAssetKey(b);
      if (assetKeyA && assetKeyB && assetKeyA !== assetKeyB) {
        for (const [destAddr, assetKeys] of destinationToAssets) {
          if (assetKeys.has(assetKeyA) && assetKeys.has(assetKeyB)) {
            const k = assetKeys.size;
            const weight = Math.min(W_TOP_DESTINATION * damp(k), SINGLE_ITEM_CAP);
            consider({
              signal: "shared-destination",
              entity: destAddr,
              entityGroupCount: k,
              weight,
              detail: `shared top destination ${shortAddr(destAddr)}`,
            });
          }
        }
      }

      // Signal 3: shared home domain across members of both groups
      const aDomains = new Set(
        a.members.map((m) => m.homeDomain?.trim().toLowerCase()).filter((d): d is string => !!d),
      );
      const bDomains = new Set(
        b.members.map((m) => m.homeDomain?.trim().toLowerCase()).filter((d): d is string => !!d),
      );
      for (const domain of aDomains) {
        if (!bDomains.has(domain)) continue;
        if (isWalletServiceDomain(domain)) continue; // wallet/federation domain — not operator evidence
        const k = domainToGroupIds.get(domain)?.size ?? 2;
        if (k > DOMAIN_CLUTTER_K) continue; // too common — skip evidence row entirely
        const weight = Math.min(W_HOME_DOMAIN * damp(k), SINGLE_ITEM_CAP);
        consider({
          signal: "shared-domain",
          entity: domain,
          entityGroupCount: k,
          weight,
          detail: `shared home domain ${domain}`,
        });
      }

      // Signal 4: shared lineage — a known creator whose children intersect both groups
      const aAddrs = new Set(a.members.map((m) => m.address));
      const bAddrs = new Set(b.members.map((m) => m.address));
      for (const [creator, children] of creatorToChildren) {
        let inA = false;
        let inB = false;
        for (const child of children) {
          if (aAddrs.has(child)) inA = true;
          if (bAddrs.has(child)) inB = true;
        }
        if (!(inA && inB)) continue;

        const touchedGroups = new Set<string>();
        for (const child of children) {
          const perGroup = addressToGroups.get(child);
          if (perGroup) for (const gid of perGroup.keys()) touchedGroups.add(gid);
        }
        const k = Math.max(touchedGroups.size, 2);
        const weight = Math.min(W_LINEAGE * damp(k), SINGLE_ITEM_CAP);
        consider({
          signal: "shared-lineage",
          entity: creator,
          entityGroupCount: k,
          weight,
          detail: `shared lineage via creator ${shortAddr(creator)}`,
        });
      }

      // ---- Aggregate: dampened probabilistic-OR over deduped evidence ----
      const evidence = Array.from(evidenceByEntity.values()).sort((x, y) => y.weight - x.weight);
      const survivalProduct = evidence.reduce((acc, item) => acc * (1 - item.weight), 1);
      const score = Math.round(100 * (1 - survivalProduct));

      if (score < minScore) continue;

      matches.push({
        groupAId: a.id, groupAName: a.name,
        groupBId: b.id, groupBName: b.name,
        network: a.network,
        score,
        tier: tierFor(score, false),
        evidence,
        shortCircuit: false,
      });
    }
  }

  matches.sort((x, y) => y.score - x.score);
  return matches;
}
