"use client";

import { useCallback, useEffect, useState } from "react";
import type { KnownCreator } from "@/lib/intermediary-tracer/types";
import { createDbCache, dbPost, dbDelete, debounce } from "@/lib/db-client";

const ENDPOINT = "/api/db/known-creators";
const _cache = createDbCache<KnownCreator>();

export function resolveCreatorName(address: string): string | undefined {
  return _cache.get().find((e) => e.address === address)?.name;
}

export function getCreatorsMap(): Map<string, string> {
  return new Map(_cache.get().map((e) => [e.address, e.name]));
}

export function useKnownCreators() {
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

  const upsert = useCallback(
    (entry: Omit<KnownCreator, "addedAt"> & { addedAt?: number }) => {
      const newEntry: KnownCreator = { ...entry, addedAt: entry.addedAt ?? Date.now() };
      const current = _cache.get();
      const idx = current.findIndex((e) => e.address === entry.address);
      _cache.set(
        idx >= 0 ? current.map((e, i) => (i === idx ? newEntry : e)) : [newEntry, ...current],
      );
      dbPost(ENDPOINT, newEntry);
    },
    [],
  );

  const remove = useCallback((address: string) => {
    _cache.set(_cache.get().filter((e) => e.address !== address));
    dbDelete(ENDPOINT, address);
  }, []);

  return { entries, upsert, remove };
}
