"use client";

import { useEffect } from "react";
import { authHeaders, waitForAuth } from "@/lib/db-client";

const SYNC_KEY = "stellar_last_startup_sync";
const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Silently merges Supabase data into local SQLite on startup.
 * Throttled to once every 5 minutes. No-op on Vercel (handled server-side).
 * INSERT OR IGNORE — never overwrites local data, only adds missing records.
 */
export function StartupSync() {
  useEffect(() => {
    const last = Number(localStorage.getItem(SYNC_KEY) ?? 0);
    if (Date.now() - last < SYNC_INTERVAL_MS) return;

    waitForAuth().then(() => fetch("/api/db/startup-sync", { method: "POST", headers: authHeaders() }))
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && !data.skipped) {
          localStorage.setItem(SYNC_KEY, String(Date.now()));
          if (data.merged > 0) {
            // Use a custom event — avoids re-triggering all focus-reload hooks
            window.dispatchEvent(new CustomEvent("stellardb:sync"));
            console.log(`[startup-sync] merged ${data.merged} records from Supabase`);
          }
        }
      })
      .catch(() => null); // silent — never block the UI
  }, []);

  return null;
}
