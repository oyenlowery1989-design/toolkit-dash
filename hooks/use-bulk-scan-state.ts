"use client";

import { useCallback, useRef } from "react";
import { authHeaders, waitForAuth } from "@/lib/db-client";

const BASE_ENDPOINT = "/api/db/bulk-scan-state";
const DEBOUNCE_MS = 1500;

function endpointFor(scanKey: string): string {
  return `${BASE_ENDPOINT}?scanKey=${encodeURIComponent(scanKey)}`;
}

function post(scanKey: string, rowsJson: string, interrupted: boolean) {
  return waitForAuth().then(() =>
    fetch(endpointFor(scanKey), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ rowsJson, interrupted }),
    }),
  );
}

/** DB-backed replacement for localStorage persistence of an in-progress scan's
 *  row state (survives refresh, and — unlike localStorage — syncs across devices
 *  in Supabase mode). Writes are debounced so rapid per-row status updates during
 *  a concurrent scan don't each trigger a network round-trip.
 *  `key` isolates independent scans (e.g. Bulk Asset Sales vs Address Balances)
 *  so they don't overwrite each other's saved state — defaults to "default" so
 *  existing callers with no key keep their prior behavior unchanged. */
export function useBulkScanState<T>(key: string = "default") {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (): Promise<{ rows: T[]; interrupted: boolean } | null> => {
    try {
      await waitForAuth();
      const res = await fetch(endpointFor(key), { headers: authHeaders() });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || typeof data.rowsJson !== "string") return null;
      return { rows: JSON.parse(data.rowsJson) as T[], interrupted: !!data.interrupted };
    } catch {
      return null;
    }
  }, [key]);

  /** Debounced save — call on every row update during an active scan. */
  const save = useCallback((rows: T[], interrupted = false) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      post(key, JSON.stringify(rows), interrupted).catch(() => {});
    }, DEBOUNCE_MS);
  }, [key]);

  /** Immediate, un-debounced save — call at batch start/finish so a checkpoint
   *  is never lost to a pending debounce timer that gets cleared by clear(). */
  const saveImmediate = useCallback((rows: T[], interrupted = false) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    return post(key, JSON.stringify(rows), interrupted).catch(() => {});
  }, [key]);

  const clear = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    return waitForAuth()
      .then(() => fetch(endpointFor(key), { method: "DELETE", headers: authHeaders() }))
      .catch(() => {});
  }, [key]);

  return { load, save, saveImmediate, clear };
}
