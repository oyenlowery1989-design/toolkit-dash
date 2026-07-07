"use client";

import { useCallback, useRef } from "react";
import { authHeaders, waitForAuth } from "@/lib/db-client";

const ENDPOINT = "/api/db/bulk-scan-state";
const DEBOUNCE_MS = 1500;

function post(rowsJson: string, interrupted: boolean) {
  return waitForAuth().then(() =>
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ rowsJson, interrupted }),
    }),
  );
}

/** DB-backed replacement for localStorage persistence of an in-progress scan's
 *  row state (survives refresh, and — unlike localStorage — syncs across devices
 *  in Supabase mode). Writes are debounced so rapid per-row status updates during
 *  a concurrent scan don't each trigger a network round-trip. */
export function useBulkScanState<T>() {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (): Promise<{ rows: T[]; interrupted: boolean } | null> => {
    try {
      await waitForAuth();
      const res = await fetch(ENDPOINT, { headers: authHeaders() });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || typeof data.rowsJson !== "string") return null;
      return { rows: JSON.parse(data.rowsJson) as T[], interrupted: !!data.interrupted };
    } catch {
      return null;
    }
  }, []);

  /** Debounced save — call on every row update during an active scan. */
  const save = useCallback((rows: T[], interrupted = false) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      post(JSON.stringify(rows), interrupted).catch(() => {});
    }, DEBOUNCE_MS);
  }, []);

  /** Immediate, un-debounced save — call at batch start/finish so a checkpoint
   *  is never lost to a pending debounce timer that gets cleared by clear(). */
  const saveImmediate = useCallback((rows: T[], interrupted = false) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    return post(JSON.stringify(rows), interrupted).catch(() => {});
  }, []);

  const clear = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    return waitForAuth()
      .then(() => fetch(ENDPOINT, { method: "DELETE", headers: authHeaders() }))
      .catch(() => {});
  }, []);

  return { load, save, saveImmediate, clear };
}
