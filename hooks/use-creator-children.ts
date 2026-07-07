"use client";

import { useCallback, useEffect, useState } from "react";
import type { CreatorChild } from "@/lib/intermediary-tracer/types";
import { createDbCache, dbPost, authHeaders, waitForAuth, debounce } from "@/lib/db-client";

const ENDPOINT = "/api/db/creator-children";
const _cache = createDbCache<CreatorChild>();

// This route's DELETE handler expects { id } or { creatorAddress, network } —
// not the generic { key } shape used by lib/db-client's dbDelete — so this
// local wrapper mirrors dbDelete's throw-on-non-OK behavior while preserving
// the endpoint's existing payload shape (same convention as
// hooks/use-auto-send-groups.ts's local dbDelete).
function dbDeleteChild(body: { id: string } | { creatorAddress: string; network: string }): Promise<void> {
  return waitForAuth()
    .then(() =>
      fetch(ENDPOINT, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      }),
    )
    .then((res) => {
      if (!res.ok) throw new Error(`DELETE ${ENDPOINT} failed: ${res.status}`);
    });
}

export function useCreatorChildren() {
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

  const all = _cache.get();

  /** Get children for a specific creator + network */
  const forCreator = useCallback(
    (creatorAddress: string, network: string) =>
      all.filter((c) => c.creatorAddress === creatorAddress && c.network === network),
    [all],
  );

  /** Upsert batch — skips if already known (server handles dedup via UNIQUE constraint) */
  const saveChildren = useCallback(
    async (children: CreatorChild[]) => {
      if (children.length === 0) return { added: 0 };
      // Optimistic update — merge into cache, dedup by (creatorAddress+childAddress+network)
      const current = _cache.get();
      const key = (c: CreatorChild) => `${c.creatorAddress}:${c.childAddress}:${c.network}`;
      const existingKeys = new Set(current.map(key));
      const genuinelyNew = children.filter((c) => !existingKeys.has(key(c)));
      if (genuinelyNew.length > 0) {
        _cache.set([...genuinelyNew, ...current]);
      }
      // Persist all (server deduplicates via ON CONFLICT DO UPDATE)
      await dbPost(ENDPOINT, children).catch(() => _cache.reload(ENDPOINT));
      return { added: genuinelyNew.length };
    },
    [],
  );

  /** Remove a single child by id */
  const removeChild = useCallback((id: string) => {
    _cache.set(_cache.get().filter((c) => c.id !== id));
    dbDeleteChild({ id }).catch(() => _cache.reload(ENDPOINT));
  }, []);

  /** Remove all children for a creator */
  const removeAllForCreator = useCallback((creatorAddress: string, network: string) => {
    _cache.set(_cache.get().filter((c) => !(c.creatorAddress === creatorAddress && c.network === network)));
    dbDeleteChild({ creatorAddress, network }).catch(() => _cache.reload(ENDPOINT));
  }, []);

  return { all, forCreator, saveChildren, removeChild, removeAllForCreator };
}
