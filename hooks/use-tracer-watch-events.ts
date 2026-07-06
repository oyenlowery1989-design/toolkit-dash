"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { WatchEvent } from "@/lib/tracer-v2/types";
import { createDbCache, dbPatch, debounce } from "@/lib/db-client";

const ENDPOINT = "/api/db/tracer-watch-events";
const _cache = createDbCache<WatchEvent>();

export function useTracerWatchEvents() {
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

  const events = _cache.get();
  const isLoaded = _cache.isLoaded();
  const unseenCount = useMemo(() => events.filter((e) => !e.seen).length, [events]);

  const markSeen = useCallback((id: string) => {
    _cache.set(_cache.get().map((e) => (e.id === id ? { ...e, seen: true } : e)));
    dbPatch(ENDPOINT, { id }).catch(() => _cache.reload(ENDPOINT));
  }, []);

  const markAllSeen = useCallback(() => {
    _cache.set(_cache.get().map((e) => ({ ...e, seen: true })));
    dbPatch(ENDPOINT, { markAllSeen: true }).catch(() => _cache.reload(ENDPOINT));
  }, []);

  return { events, isLoaded, unseenCount, markSeen, markAllSeen };
}
