"use client";

import { useEffect } from "react";
import { authHeaders, waitForAuth } from "@/lib/db-client";
import { toast } from "sonner";

const SYNC_KEY = "stellar_last_startup_sync";
const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Silently merges Supabase data into local SQLite on startup.
 * Throttled to once every 5 minutes. No-op on Vercel (handled server-side).
 * INSERT OR IGNORE — never overwrites local data, only adds missing records.
 */
export function StartupSync() {
  useEffect(() => {
    fetch("/api/db/status")
      .then((response) => response.json())
      .then((status) => {
        if (status.backupFailed) {
          toast.error("Some local changes were not backed up to Supabase. Check Data & Backup in Settings.", {
            duration: 10000,
          });
        }
      })
      .catch(() => null);

    const last = Number(localStorage.getItem(SYNC_KEY) ?? 0);
    if (Date.now() - last < SYNC_INTERVAL_MS) return;

    waitForAuth().then(() => fetch("/api/db/startup-sync", { method: "POST", headers: authHeaders() }))
      .then(async (r) => {
        if (!r.ok) throw new Error("Startup sync request failed");
        return r.json();
      })
      .then((data) => {
        if (!data.ok && !data.skipped) throw new Error("Startup sync failed");
        if (data.ok && !data.skipped) {
          localStorage.setItem(SYNC_KEY, String(Date.now()));
          if (data.merged > 0) {
            // Use a custom event — avoids re-triggering all focus-reload hooks
            window.dispatchEvent(new CustomEvent("stellardb:sync"));
            console.log(`[startup-sync] merged ${data.merged} records from Supabase`);
          }
        }
      })
      .catch(() => toast.error("Could not load cloud data into the local database. Please retry later."));
  }, []);

  return null;
}
