"use client";

import { useCallback, useEffect, useState } from "react";
import type { KnownIntermediary } from "@/lib/intermediary-tracer/types";
import { createDbCache, dbPost, dbDelete, debounce } from "@/lib/db-client";

const ENDPOINT = "/api/db/known-intermediaries";
const _cache = createDbCache<KnownIntermediary>();

export function resolveIntermediaryName(address: string): string | undefined {
  return _cache.get().find((e) => e.address === address)?.name;
}

export function getIntermediariesMap(): Map<string, string> {
  return new Map(_cache.get().map((e) => [e.address, e.name]));
}

export function useKnownIntermediaries() {
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
    (entry: Omit<KnownIntermediary, "addedAt"> & { addedAt?: number }) => {
      const newEntry: KnownIntermediary = { ...entry, addedAt: entry.addedAt ?? Date.now() };
      const current = _cache.get();
      const idx = current.findIndex((e) => e.address === entry.address);
      _cache.set(
        idx >= 0 ? current.map((e, i) => (i === idx ? newEntry : e)) : [newEntry, ...current],
      );
      dbPost(ENDPOINT, newEntry).catch(() => _cache.reload(ENDPOINT));
    },
    [],
  );

  const remove = useCallback((address: string) => {
    _cache.set(_cache.get().filter((e) => e.address !== address));
    dbDelete(ENDPOINT, address).catch(() => _cache.reload(ENDPOINT));
  }, []);

  return { entries, upsert, remove };
}
