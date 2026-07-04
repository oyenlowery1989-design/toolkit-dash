"use client";

import { useCallback, useEffect, useState } from "react";
import type { AssetProceedsResult } from "@/lib/proceeds-investigator/types";
import { createDbCache, dbPost, dbPatch, dbDelete, debounce } from "@/lib/db-client";

export interface SavedAnalysis {
  id: string;
  name: string;
  assetCode: string;
  issuer: string;
  distribAddresses: string[];
  network: string;
  timestamp: number;
  result: AssetProceedsResult;
  notes?: string;
  tags?: string[];
}

const ENDPOINT = "/api/db/saved-analyses";
const _cache = createDbCache<SavedAnalysis>();

export function getSavedAnalysesSnapshot(): SavedAnalysis[] {
  return _cache.get();
}

export function useSavedAnalyses() {
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

  const analyses = _cache.get();

  const saveAnalysis = useCallback(
    (entry: Omit<SavedAnalysis, "id" | "timestamp">): string => {
      const newEntry: SavedAnalysis = {
        ...entry,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: Date.now(),
      };
      _cache.set([newEntry, ..._cache.get()].slice(0, 50));
      dbPost(ENDPOINT, newEntry).catch(() => _cache.reload(ENDPOINT));
      return newEntry.id;
    },
    [],
  );

  const updateName = useCallback((id: string, name: string) => {
    _cache.set(_cache.get().map((a) => (a.id === id ? { ...a, name } : a)));
    dbPatch(ENDPOINT, { id, name }).catch(() => _cache.reload(ENDPOINT));
  }, []);

  const updateNotes = useCallback((id: string, notes: string) => {
    _cache.set(_cache.get().map((a) => (a.id === id ? { ...a, notes } : a)));
    dbPatch(ENDPOINT, { id, notes }).catch(() => _cache.reload(ENDPOINT));
  }, []);

  const updateTags = useCallback((id: string, tags: string[]) => {
    _cache.set(_cache.get().map((a) => (a.id === id ? { ...a, tags } : a)));
    dbPatch(ENDPOINT, { id, tags }).catch(() => _cache.reload(ENDPOINT));
  }, []);

  const remove = useCallback((id: string) => {
    _cache.set(_cache.get().filter((a) => a.id !== id));
    dbDelete(ENDPOINT, id).catch(() => _cache.reload(ENDPOINT));
  }, []);

  return { analyses, saveAnalysis, updateName, updateNotes, updateTags, remove };
}
