"use client";

import { useCallback, useEffect, useState } from "react";
import { createDbCache, dbPost, authHeaders, waitForAuth, debounce } from "@/lib/db-client";

export type SavedSearchType = "address" | "asset" | "intermediary-trace" | "intermediary-scan" | "address-balances" | "asset-sales-bulk";

export interface SavedSearch {
  /** Row id — present once the entry has round-tripped through the server (GET response). Absent on freshly-optimistic entries. */
  id?: number;
  type: SavedSearchType;
  /** G... for address, CODE:ISSUER for asset */
  value: string;
  /** Optional human-readable label */
  label?: string;
  /** Network at time of search */
  network?: string;
  /** Inferred or known distribution address (assets only) */
  distribAddress?: string;
  /** Total XLM proceeds from last scan (assets only) */
  totalXlmProceeds?: number;
  /** Total asset sold from last scan (assets only) */
  totalAssetSold?: number;
  /** Intermediary name (intermediary-trace / intermediary-scan only) */
  intermediaryName?: string;
  /** Number of accounts found (intermediary-scan only) */
  accountsFound?: number;
  timestamp: number;
}

const ENDPOINT = "/api/db/saved-searches";
const _cache = createDbCache<SavedSearch>();

// Local delete wrapper (mirrors the pattern in use-auto-send-groups.ts / use-asset-groups.ts):
// the shared dbDelete always sends { key }, but this route needs to key on `id` when the
// cached entry has one (round-tripped from the server) and fall back to `created_at`
// (the `timestamp` field) only for optimistic entries that haven't been reloaded yet.
function rawDelete(body: Record<string, unknown>): Promise<void> {
  return waitForAuth()
    .then(() =>
      fetch(ENDPOINT, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      }),
    )
    .then((r) => {
      if (!r.ok) throw new Error(`DELETE ${ENDPOINT} failed: ${r.status}`);
    });
}

export function useSavedSearches() {
  const [, rerender] = useState(0);

  useEffect(() => {
    const unsub = _cache.subscribe(() => rerender((n) => n + 1));
    _cache.load(ENDPOINT);
    const onFocus = debounce(() => _cache.reload(ENDPOINT), 2000);
    window.addEventListener("focus", onFocus);
    return () => {
      unsub();
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const history = _cache.get();

  const upsert = useCallback((entry: Omit<SavedSearch, "timestamp">) => {
    const newEntry: SavedSearch = { ...entry, timestamp: Date.now() };
    const current = _cache.get();
    // Deduplicate by type + value (most recent wins)
    const deduped = current.filter(
      (s) => !(s.type === entry.type && s.value === entry.value),
    );
    _cache.set([newEntry, ...deduped].slice(0, 30));
    dbPost(ENDPOINT, newEntry).catch(() => _cache.reload(ENDPOINT));
  }, []);

  const remove = useCallback((timestamp: number) => {
    const entry = _cache.get().find((s) => s.timestamp === timestamp);
    _cache.set(_cache.get().filter((s) => s.timestamp !== timestamp));
    const body = entry?.id !== undefined ? { id: entry.id } : { key: timestamp };
    rawDelete(body).catch(() => _cache.reload(ENDPOINT));
  }, []);

  return { history, upsert, remove };
}

export function getSavedSearchesSnapshot(): SavedSearch[] {
  return _cache.get();
}
