"use client";

import { useCallback, useEffect, useState } from "react";
import { createDbCache, dbPost, debounce } from "@/lib/db-client";
import type { Network } from "@/lib/settings";

export interface BulkRunSummary {
  id: string;
  network: Network;
  memo: string;
  recipientCount: number;
  successCount: number;
  failedCount: number;
  ranAt: number;
}

const ENDPOINT = "/api/db/bulk-runs";
const _cache = createDbCache<BulkRunSummary>();

export function useBulkRunHistory() {
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

  const runs = _cache.get();

  const addRun = useCallback((run: Omit<BulkRunSummary, "id" | "ranAt">) => {
    const entry: BulkRunSummary = {
      ...run,
      id: String(Date.now()),
      ranAt: Date.now(),
    };
    _cache.set([entry, ..._cache.get()].slice(0, 10));
    dbPost(ENDPOINT, entry);
  }, []);

  return { runs, addRun };
}

/** Read runs without subscribing — for the dashboard snapshot. */
export function getBulkRunSnapshot(): BulkRunSummary[] {
  return _cache.get();
}
