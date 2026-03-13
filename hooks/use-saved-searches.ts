"use client";

import { useCallback, useEffect, useState } from "react";
import { createDbCache, dbPost, dbDelete } from "@/lib/db-client";

export type SavedSearchType = "address" | "asset" | "intermediary-trace" | "intermediary-scan";

export interface SavedSearch {
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

export function useSavedSearches() {
  const [, rerender] = useState(0);

  useEffect(() => {
    const unsub = _cache.subscribe(() => rerender((n) => n + 1));
    _cache.load(ENDPOINT);
    return unsub;
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
    dbPost(ENDPOINT, newEntry);
  }, []);

  const remove = useCallback((timestamp: number) => {
    _cache.set(_cache.get().filter((s) => s.timestamp !== timestamp));
    dbDelete(ENDPOINT, timestamp);
  }, []);

  return { history, upsert, remove };
}

export function getSavedSearchesSnapshot(): SavedSearch[] {
  return _cache.get();
}
