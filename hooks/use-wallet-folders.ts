"use client";

import { useCallback, useEffect, useState } from "react";
import { createDbCache, dbPost, dbPatch, dbDelete, debounce } from "@/lib/db-client";
import { purgeWalletsByFolder, reloadWalletsV2 } from "./use-wallets-v2";

export interface WalletFolder {
  id: string;
  name: string;
  position: number;
}

const ENDPOINT = "/api/db/wallet-folders";
const _cache = createDbCache<WalletFolder>();

export function useWalletFolders() {
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

  const folders = _cache.get();

  const createFolder = useCallback((name: string) => {
    const id = crypto.randomUUID();
    const position = _cache.get().length;
    const entry: WalletFolder = { id, name, position };
    _cache.set([..._cache.get(), entry]);
    dbPost(ENDPOINT, entry).catch(() => _cache.reload(ENDPOINT));
    return id;
  }, []);

  const renameFolder = useCallback((id: string, name: string) => {
    _cache.set(_cache.get().map((f) => (f.id === id ? { ...f, name } : f)));
    dbPatch(ENDPOINT, { id, name }).catch(() => _cache.reload(ENDPOINT));
  }, []);

  const deleteFolder = useCallback((id: string) => {
    _cache.set(_cache.get().filter((f) => f.id !== id));
    purgeWalletsByFolder(id); // optimistic cascade — DB cascade handled in API route
    dbDelete(ENDPOINT, id).catch(() => {
      // Both caches were optimistically mutated together — if the delete
      // actually failed server-side, restore both so the UI matches the
      // (unchanged) DB state. Restoring only the folders cache would leave
      // the folder back but its wallets still wrongly purged from view.
      _cache.reload(ENDPOINT);
      reloadWalletsV2();
    });
  }, []);

  return { folders, createFolder, renameFolder, deleteFolder };
}
