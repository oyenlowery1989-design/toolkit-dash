import type { ProceedsLedgerEntry } from "./types";

export type TransactionMemo = { type: "none"; value: null } | { type: "text" | "id" | "hash" | "return"; value: string };
export interface BeneficiaryTransfer {
  operationId: string;
  account: string;
  txHash: string;
  createdAt: string;
  amountXlm: number;
}
export interface BeneficiaryGroup {
  network: string;
  address: string;
  baseAddress?: string;
  memoType: TransactionMemo["type"];
  memoValue: string | null;
  totalXlm: number;
  senders: string[];
  transfers: BeneficiaryTransfer[];
}
export interface BeneficiaryGrouping {
  network: string;
  groups: BeneficiaryGroup[];
  unresolvedOperationCount: number;
}

/** Unknown metadata is never equivalent to an explicitly verified MEMO_NONE. */
export function readTransactionMemo(tx: Record<string, unknown>): TransactionMemo | undefined {
  const { memo_type: type, memo: value } = tx;
  if (type === "none") return value == null ? { type, value: null } : undefined;
  if (typeof value !== "string") return;
  if (type === "text") {
    const bytes = new TextEncoder().encode(value);
    if (bytes.length > 28 || new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes) !== value) return;
    if (tx.memo_bytes !== undefined && tx.memo_bytes !== btoa(String.fromCharCode(...bytes))) return;
    return { type, value };
  }
  if (type === "id") {
    if (!/^\d+$/.test(value) || value.length > 20 || BigInt(value) > BigInt("18446744073709551615")) return;
    return { type, value };
  }
  if (type === "hash" || type === "return") {
    try { if (atob(value).length === 32 && btoa(atob(value)) === value) return { type, value }; } catch { /* Invalid base64 is unknown. */ }
  }
}

export function mergeBeneficiaryGroups(groups: readonly BeneficiaryGroup[]): BeneficiaryGroup[] {
  const buckets = new Map<string, { group: BeneficiaryGroup; events: Set<string> }>();
  for (const input of groups) {
    const key = JSON.stringify([input.network, input.address, input.memoType, input.memoValue]);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { group: { ...input, totalXlm: 0, senders: [], transfers: [] }, events: new Set() };
      buckets.set(key, bucket);
    }
    for (const transfer of input.transfers) {
      const id = JSON.stringify([transfer.txHash, transfer.operationId]);
      if (bucket.events.has(id)) continue;
      bucket.events.add(id);
      bucket.group.transfers.push(transfer);
      bucket.group.totalXlm += transfer.amountXlm;
    }
  }
  return [...buckets.values()].map(({ group }) => ({ ...group,
    senders: [...new Set(group.transfers.map(transfer => transfer.account))].sort(),
    transfers: [...group.transfers].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.operationId.localeCompare(b.operationId)),
  })).sort((a, b) => b.senders.length - a.senders.length || b.totalXlm - a.totalXlm);
}

export function groupBeneficiaries(sources: readonly { network: string; entries: readonly ProceedsLedgerEntry[] }[]): BeneficiaryGroup[] {
  return mergeBeneficiaryGroups(sources.flatMap(({ network, entries }) => entries.flatMap(entry => {
    if (!network || !entry.successful || !entry.to || !entry.operationId || !entry.txHash || !entry.memo || (entry.toMuxedId !== undefined && !entry.toMuxed) || !Number.isFinite(entry.amountXlm) || entry.amountXlm <= 0) return [];
    return [{ network, address: entry.toMuxed ?? entry.to, baseAddress: entry.toMuxed ? entry.to : undefined, memoType: entry.memo.type, memoValue: entry.memo.value, totalXlm: entry.amountXlm,
      senders: [entry.account], transfers: [{ operationId: entry.operationId, account: entry.account, txHash: entry.txHash, createdAt: entry.createdAt, amountXlm: entry.amountXlm }] }];
  })));
}

/** Enrich only external transfers; one lookup per transaction, at most four in flight. */
export async function fetchBeneficiaryGrouping(entries: ProceedsLedgerEntry[], network: string, signal: AbortSignal,
  loadTransaction: (hash: string) => Promise<Record<string, unknown>>): Promise<BeneficiaryGrouping> {
  const hashes = [...new Set(entries.map(entry => entry.txHash).filter(Boolean))];
  const memos = new Map<string, TransactionMemo>();
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, hashes.length) }, async () => {
    while (next < hashes.length) {
      signal.throwIfAborted();
      const hash = hashes[next++];
      try {
        const tx = await loadTransaction(hash);
        signal.throwIfAborted();
        const memo = tx.hash === hash && tx.successful === true ? readTransactionMemo(tx) : undefined;
        if (memo) memos.set(hash, memo);
      } catch {
        signal.throwIfAborted();
      }
    }
  }));
  signal.throwIfAborted();
  for (const entry of entries) entry.memo = memos.get(entry.txHash);
  return { network, groups: groupBeneficiaries([{ network, entries }]),
    unresolvedOperationCount: entries.filter(entry => !entry.memo || (entry.toMuxedId !== undefined && !entry.toMuxed)).length };
}
