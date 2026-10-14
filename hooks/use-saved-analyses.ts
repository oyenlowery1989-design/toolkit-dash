"use client";

import { useCallback, useEffect, useState } from "react";
import { summarizeSavedAnalysis } from "@/lib/saved-analyses/summary";
import type { AssetProceedsResult } from "@/lib/proceeds-investigator/types";
import { createDbCache, dbPost, dbPatch, dbDelete, debounce, authHeaders, waitForAuth } from "@/lib/db-client";

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

export interface SavedAnalysisCursor { timestamp: number; id: string; }

export interface SavedAnalysisSummary extends Omit<SavedAnalysis, "result"> {
  result: Omit<AssetProceedsResult, "proceedsLedger" | "outgoingLedger"> & Partial<Pick<AssetProceedsResult, "proceedsLedger" | "outgoingLedger">>;
  graphOutgoing?: Pick<AssetProceedsResult["outgoingLedger"][number], "account" | "from" | "to" | "amountXlm" | "successful">[];
  hasOutgoingLedger?: boolean;
  nextCursor?: SavedAnalysisCursor;
}

export async function loadSavedAnalysis(id: string, signal?: AbortSignal): Promise<SavedAnalysis> {
  await waitForAuth();
  const headers = authHeaders();
  const response = await fetch(`${ENDPOINT}?id=${encodeURIComponent(id)}`, { headers, signal });
  if (!response.ok) throw new Error(`Loading saved analysis failed: ${response.status}`);
  const detail: SavedAnalysis = await response.json();
  if (signal?.aborted || JSON.stringify(headers) !== JSON.stringify(authHeaders())) throw new Error("Saved analysis request is no longer current.");
  return detail;
}

const ENDPOINT = "/api/db/saved-analyses";
const _cache = createDbCache<SavedAnalysisSummary>();
const _pageRequests = new Map<string, Promise<SavedAnalysisSummary[]>>();

let _historyGeneration = 0;
_cache.subscribe(() => { if (!_cache.isLoaded()) _historyGeneration++; });

function reloadHistory(): Promise<void> {
  _historyGeneration++;
  return _cache.reload(ENDPOINT);
}

function loadHistoryPage(cursor: SavedAnalysisCursor, headers: Record<string, string>, generation: number): Promise<SavedAnalysisSummary[]> {
  const query = new URLSearchParams({ beforeTimestamp: String(cursor.timestamp), beforeId: cursor.id });
  const key = `${headers.Authorization ?? "local"}:${generation}:${query}`;
  const pending = _pageRequests.get(key);
  if (pending) return pending;
  const request = waitForAuth().then(() => fetch(`${ENDPOINT}?${query}`, { headers }))
    .then(async (response) => {
      if (!response.ok) throw new Error(`Loading older analyses failed: ${response.status}`);
      return response.json() as Promise<SavedAnalysisSummary[]>;
    }).finally(() => _pageRequests.delete(key));
  _pageRequests.set(key, request);
  return request;
}

export function getSavedAnalysesSnapshot(): SavedAnalysisSummary[] {
  return _cache.get();
}

export function useSavedAnalyses(options: { load?: boolean } = {}) {
  const [, rerender] = useState(0);

  useEffect(() => {
    const unsub = _cache.subscribe(() => rerender((n) => n + 1));
    if (options.load === false) return unsub;
    _cache.load(ENDPOINT);
    const onFocus = debounce(() => reloadHistory(), 2000);
    const onSync = () => { _historyGeneration++; };
    window.addEventListener("focus", onFocus);
    window.addEventListener("stellardb:sync", onSync);
    return () => {
      unsub();
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("stellardb:sync", onSync);
    };
  }, [options.load]);

  const analyses = _cache.get();
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyAttempt, setHistoryAttempt] = useState(0);
  const nextCursor = analyses.at(-1)?.nextCursor;
  const cursorKey = nextCursor ? JSON.stringify(nextCursor) : undefined;
  const historyGeneration = _historyGeneration;
  useEffect(() => {
    if (options.load === false || nextCursor === undefined) return;
    const controller = new AbortController();
    const headers = authHeaders();
    setHistoryError(null);
    const generation = historyGeneration;
    loadHistoryPage(nextCursor, headers, generation)
      .then((page) => {
        if (controller.signal.aborted || JSON.stringify(headers) !== JSON.stringify(authHeaders()) || !_cache.isLoaded() || generation !== _historyGeneration || JSON.stringify(_cache.get().at(-1)?.nextCursor) !== cursorKey) return;
        const current = _cache.get().map(({ nextCursor: _cursor, ...entry }) => entry);
        const ids = new Set(current.map((entry) => entry.id));
        _cache.set([...current, ...page.filter((entry) => !ids.has(entry.id))]);
      }).catch((error) => {
        if (!controller.signal.aborted && generation === _historyGeneration && JSON.stringify(headers) === JSON.stringify(authHeaders())) setHistoryError(String(error));
      });
    return () => controller.abort();
  // cursorKey keeps equivalent cursor objects from restarting shared page reads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursorKey, options.load, historyAttempt, historyGeneration]);

  const saveAnalysis = useCallback(
    (entry: Omit<SavedAnalysis, "id" | "timestamp">): string => {
      const newEntry: SavedAnalysis = {
        ...entry,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: Date.now(),
      };
      if (_cache.isLoaded()) _cache.set([summarizeSavedAnalysis(newEntry), ..._cache.get()]);
      dbPost(ENDPOINT, newEntry).catch(() => reloadHistory());
      return newEntry.id;
    },
    [],
  );

  const updateName = useCallback((id: string, name: string) => {
    _cache.set(_cache.get().map((a) => (a.id === id ? { ...a, name } : a)));
    dbPatch(ENDPOINT, { id, name }).catch(() => reloadHistory());
  }, []);

  const updateNotes = useCallback((id: string, notes: string) => {
    _cache.set(_cache.get().map((a) => (a.id === id ? { ...a, notes } : a)));
    dbPatch(ENDPOINT, { id, notes }).catch(() => reloadHistory());
  }, []);

  const updateTags = useCallback((id: string, tags: string[]) => {
    _cache.set(_cache.get().map((a) => (a.id === id ? { ...a, tags } : a)));
    dbPatch(ENDPOINT, { id, tags }).catch(() => reloadHistory());
  }, []);

  const remove = useCallback((id: string) => {
    _cache.set(_cache.get().filter((a) => a.id !== id));
    dbDelete(ENDPOINT, id).then(() => reloadHistory()).catch(() => reloadHistory());
  }, []);

  return {
    analyses,
    isLoaded: _cache.isLoaded(),
    error: historyError ?? _cache.error(),
    loadingHistory: nextCursor !== undefined && !historyError,
    retry: () => {
      if (nextCursor === undefined) void reloadHistory();
      else setHistoryAttempt((attempt) => attempt + 1);
    },
    saveAnalysis,
    updateName,
    updateNotes,
    updateTags,
    remove,
  };
}
