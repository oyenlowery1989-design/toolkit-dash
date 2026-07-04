"use client";

import { useCallback, useSyncExternalStore } from "react";

export interface SearchHistoryEntry {
  timestamp: number;
}

export interface UseSearchHistoryOptions<T extends SearchHistoryEntry> {
  /** localStorage key to persist history */
  storageKey: string;
  /** CustomEvent name dispatched on modifications */
  eventName: string;
  /** Maximum entries to keep */
  maxEntries?: number;
  /** Return true if an existing entry `a` is a duplicate of the new entry `b` (so `a` should be removed before inserting `b`). */
  isDuplicate: (a: T, b: Omit<T, "timestamp">) => boolean;
}

/**
 * Generic, reactive search-history hook backed by localStorage.
 * Syncs across browser tabs via the `storage` event and within the
 * same tab via a custom event.
 */
export function createSearchHistory<T extends SearchHistoryEntry>(
  options: UseSearchHistoryOptions<T>,
) {
  const { storageKey, eventName, maxEntries = 20, isDuplicate } = options;

  // Module-level cache so all hook instances share the same parsed array
  let cachedRaw: string | null | undefined = undefined;
  let cachedSnapshot: T[] = [];

  function save(entries: T[]): void {
    try {
      localStorage.setItem(storageKey, JSON.stringify(entries));
    } catch {
      // ignore quota / private-mode errors
    }
  }

  function getSnapshot(): T[] {
    if (typeof window === "undefined") return [];
    const raw = localStorage.getItem(storageKey);
    if (raw === cachedRaw) return cachedSnapshot;
    cachedRaw = raw;
    cachedSnapshot = raw ? (JSON.parse(raw) as T[]) : [];
    return cachedSnapshot;
  }

  function getServerSnapshot(): T[] {
    return [];
  }

  function dispatch() {
    cachedRaw = undefined;
    window.dispatchEvent(new Event(eventName));
  }

  function subscribe(callback: () => void): () => void {
    window.addEventListener("storage", callback);
    window.addEventListener(eventName, callback);
    return () => {
      window.removeEventListener("storage", callback);
      window.removeEventListener(eventName, callback);
    };
  }

  function useHistory() {
    const history = useSyncExternalStore(
      subscribe,
      getSnapshot,
      getServerSnapshot,
    );

    const upsert = useCallback((entry: Omit<T, "timestamp">) => {
      const current = getSnapshot();
      const filtered = current.filter((row) => !isDuplicate(row, entry));
      const next = [
        { ...entry, timestamp: Date.now() } as T,
        ...filtered,
      ].slice(0, maxEntries);
      save(next);
      dispatch();
    }, []);

    const remove = useCallback((timestamp: number) => {
      const next = getSnapshot().filter((row) => row.timestamp !== timestamp);
      save(next);
      dispatch();
    }, []);

    return { history, upsert, remove };
  }

  return { useHistory, getSnapshot };
}
