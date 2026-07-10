"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { waitForAuth, authHeaders, dbPost, dbDelete } from "@/lib/db-client";
import { notifyIfHidden } from "@/lib/notifications";
import type { KeyScanHit, KeyScanState } from "@/lib/key-scanner/types";

// Deliberately NOT the createDbCache optimistic-write pattern used by every other
// DB-backed hook in this app — that pattern is built for user-driven CRUD with
// rollback-on-rejection semantics. This data is continuously mutated server-side
// by a background loop, so a simple poll-while-running model fits better.

const STATE_ENDPOINT = "/api/db/key-scan";
const CONTROL_ENDPOINT = "/api/keyscan/control";
const RUNNING_POLL_MS = 1500;
const IDLE_POLL_MS = 5000;

interface KeyScanControlOpts {
  pacedRps?: number;
  concurrency?: number;
  resumeOnBoot?: boolean;
}

interface KeyScanData {
  disabled: boolean;
  state: KeyScanState | null;
  hits: KeyScanHit[];
}

const EMPTY: KeyScanData = { disabled: false, state: null, hits: [] };

export function useKeyScan() {
  const [data, setData] = useState<KeyScanData>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const hitsCountRef = useRef(0);
  const initializedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      await waitForAuth();
      const res = await fetch(STATE_ENDPOINT, { headers: authHeaders() });
      if (!res.ok) return;
      const json: KeyScanData = await res.json();
      if (!mountedRef.current) return;

      if (initializedRef.current && json.hits.length > hitsCountRef.current) {
        notifyIfHidden(
          "Key Scanner — funded address found",
          `${json.hits.length} address(es) with balance so far.`,
        );
      }
      hitsCountRef.current = json.hits.length;
      initializedRef.current = true;

      setData(json);
      setLoaded(true);
    } catch {
      // transient network error — next poll retries
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [refresh]);

  useEffect(() => {
    const interval = data.state?.running ? RUNNING_POLL_MS : IDLE_POLL_MS;
    timerRef.current = setTimeout(refresh, interval);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [data, refresh]);

  const start = useCallback(
    async (opts?: KeyScanControlOpts) => {
      await dbPost(CONTROL_ENDPOINT, { action: "start", ...opts });
      await refresh();
    },
    [refresh],
  );

  const stop = useCallback(async () => {
    await dbPost(CONTROL_ENDPOINT, { action: "stop" });
    await refresh();
  }, [refresh]);

  const configure = useCallback(
    async (opts: KeyScanControlOpts) => {
      await dbPost(CONTROL_ENDPOINT, { action: "configure", ...opts });
      await refresh();
    },
    [refresh],
  );

  const purgeHit = useCallback(
    async (id: string) => {
      await dbDelete(STATE_ENDPOINT, id);
      await refresh();
    },
    [refresh],
  );

  return { ...data, loaded, start, stop, configure, purgeHit, refresh };
}
