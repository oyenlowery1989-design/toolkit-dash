"use client";

import { useCallback, useEffect, useState } from "react";
import type { WatchlistEntry } from "@/lib/tracer-v2/types";
import { createDbCache, dbPost, dbPatch, dbDelete, debounce } from "@/lib/db-client";

const ENDPOINT = "/api/db/tracer-watchlist";
const _cache = createDbCache<WatchlistEntry>();

export function useTracerWatchlist() {
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

  const entries = _cache.get();
  const isLoaded = _cache.isLoaded();

  /** Add a new watch. Optimistically inserted; rolled back on server rejection. */
  const addWatch = useCallback(
    async (entry: { address: string; label?: string; network: string; enabled?: boolean }) => {
      const id = crypto.randomUUID();
      const now = Date.now();
      const optimistic: WatchlistEntry = {
        id,
        address: entry.address,
        label: entry.label ?? "",
        network: entry.network,
        enabled: entry.enabled ?? true,
        createdAt: now,
      };
      _cache.set([optimistic, ..._cache.get()]);
      await dbPost(ENDPOINT, { id, ...entry }).catch(() => _cache.reload(ENDPOINT));
      return id;
    },
    [],
  );

  /** Partial update (label, enabled, pollCursor, lastCheckedAt). */
  const updateWatch = useCallback(
    (id: string, updates: Partial<Pick<WatchlistEntry, "label" | "enabled" | "pollCursor" | "lastCheckedAt">>) => {
      _cache.set(_cache.get().map((w) => (w.id === id ? { ...w, ...updates } : w)));
      dbPatch(ENDPOINT, { id, ...updates }).catch(() => _cache.reload(ENDPOINT));
    },
    [],
  );

  const removeWatch = useCallback((id: string) => {
    _cache.set(_cache.get().filter((w) => w.id !== id));
    dbDelete(ENDPOINT, id).catch(() => _cache.reload(ENDPOINT));
  }, []);

  return { entries, isLoaded, addWatch, updateWatch, removeWatch };
}
