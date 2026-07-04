"use client";

import { useCallback, useEffect, useState } from "react";
import { createDbCache, dbPost, dbPatch, dbDelete, debounce } from "@/lib/db-client";

export interface WalletEntry {
  id: string;
  folderId: string;
  name: string;
  publicKey: string;
  secretKey: string;
  position: number;
}

const ENDPOINT = "/api/db/wallets-v2";
const _cache = createDbCache<WalletEntry>();

/** Remove all wallets belonging to a folder from the cache (called by useWalletFolders on delete). */
export function purgeWalletsByFolder(folderId: string) {
  _cache.set(_cache.get().filter((w) => w.folderId !== folderId));
}

export function useWalletsV2() {
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

  const wallets = _cache.get();

  const addWallet = useCallback(
    (folderId: string, name: string, publicKey: string, secretKey: string) => {
      const id = crypto.randomUUID();
      const position = _cache.get().filter((w) => w.folderId === folderId).length;
      const entry: WalletEntry = { id, folderId, name, publicKey, secretKey, position };
      _cache.set([..._cache.get(), entry]);
      dbPost(ENDPOINT, entry).catch(() => _cache.reload(ENDPOINT));
      return id;
    },
    []
  );

  const renameWallet = useCallback((id: string, name: string) => {
    _cache.set(_cache.get().map((w) => (w.id === id ? { ...w, name } : w)));
    dbPatch(ENDPOINT, { id, name }).catch(() => _cache.reload(ENDPOINT));
  }, []);

  const moveWallet = useCallback((id: string, folderId: string) => {
    _cache.set(_cache.get().map((w) => (w.id === id ? { ...w, folderId } : w)));
    dbPatch(ENDPOINT, { id, folderId }).catch(() => _cache.reload(ENDPOINT));
  }, []);

  const removeWallet = useCallback((id: string) => {
    _cache.set(_cache.get().filter((w) => w.id !== id));
    dbDelete(ENDPOINT, id).catch(() => _cache.reload(ENDPOINT));
  }, []);

  return { wallets, addWallet, renameWallet, moveWallet, removeWallet };
}
