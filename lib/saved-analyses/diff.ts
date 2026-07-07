import type { SavedAnalysis } from "@/hooks/use-saved-analyses";
import type { DestinationSummary } from "@/lib/proceeds-investigator/types";

export function assetKey(a: Pick<SavedAnalysis, "assetCode" | "issuer" | "network">): string {
  // Exact case — asset codes are case-sensitive on the Stellar ledger.
  return `${a.assetCode}:${a.issuer}:${a.network}`;
}

/** Groups analyses by asset identity (code+issuer+network), each group sorted newest-first. */
export function groupSnapshots(analyses: SavedAnalysis[]): Map<string, SavedAnalysis[]> {
  const map = new Map<string, SavedAnalysis[]>();
  for (const a of analyses) {
    const key = assetKey(a);
    const group = map.get(key);
    if (group) group.push(a);
    else map.set(key, [a]);
  }
  for (const group of map.values()) {
    group.sort((x, y) => y.timestamp - x.timestamp);
  }
  return map;
}

/** Only groups with 2+ snapshots — the minimum needed to show a diff. */
export function comparableGroups(
  analyses: SavedAnalysis[],
): { key: string; snapshots: SavedAnalysis[] }[] {
  return [...groupSnapshots(analyses).entries()]
    .filter(([, snapshots]) => snapshots.length >= 2)
    .map(([key, snapshots]) => ({ key, snapshots }));
}

export type ProceedsFieldKey =
  | "totalXlmProceeds"
  | "totalAssetSold"
  | "totalOutgoingXlm"
  | "estimatedOnHandXlm";

const FIELD_LABELS: Record<ProceedsFieldKey, string> = {
  totalXlmProceeds: "XLM Proceeds",
  totalAssetSold: "Asset Sold",
  totalOutgoingXlm: "Outgoing XLM",
  estimatedOnHandXlm: "Est. On Hand",
};

export interface FieldDelta {
  key: ProceedsFieldKey;
  label: string;
  before: number;
  after: number;
  delta: number;
}

export type DestinationDeltaKind = "new" | "increased" | "decreased" | "dropped";

export interface DestinationDelta {
  address: string;
  kind: DestinationDeltaKind;
  beforeXlm: number;
  afterXlm: number;
  deltaXlm: number;
  beforeCount: number;
  afterCount: number;
}

export interface SnapshotDiff {
  fields: FieldDelta[];
  destinations: DestinationDelta[];
}

function toMap(list: DestinationSummary[]): Map<string, DestinationSummary> {
  return new Map(list.map((d) => [d.address, d]));
}

/** Diffs two snapshots of the same asset. Defensively swaps if passed out of chronological order. */
export function diffSnapshots(older: SavedAnalysis, newer: SavedAnalysis): SnapshotDiff {
  if (older.timestamp > newer.timestamp) {
    return diffSnapshots(newer, older);
  }

  const fields: FieldDelta[] = (Object.keys(FIELD_LABELS) as ProceedsFieldKey[]).map((key) => {
    const before = older.result[key] ?? 0;
    const after = newer.result[key] ?? 0;
    return { key, label: FIELD_LABELS[key], before, after, delta: after - before };
  });

  const beforeMap = toMap(older.result.topDestinations);
  const afterMap = toMap(newer.result.topDestinations);
  const addresses = new Set([...beforeMap.keys(), ...afterMap.keys()]);

  const destinations: DestinationDelta[] = [];
  for (const address of addresses) {
    const before = beforeMap.get(address);
    const after = afterMap.get(address);
    const beforeXlm = before?.totalXlm ?? 0;
    const afterXlm = after?.totalXlm ?? 0;
    const deltaXlm = afterXlm - beforeXlm;

    let kind: DestinationDeltaKind;
    if (!before && after) kind = "new";
    else if (before && !after) kind = "dropped";
    else if (deltaXlm > 0) kind = "increased";
    else if (deltaXlm < 0) kind = "decreased";
    else continue; // no change — skip

    destinations.push({
      address,
      kind,
      beforeXlm,
      afterXlm,
      deltaXlm,
      beforeCount: before?.count ?? 0,
      afterCount: after?.count ?? 0,
    });
  }

  destinations.sort((a, b) => Math.abs(b.deltaXlm) - Math.abs(a.deltaXlm));

  return { fields, destinations };
}
