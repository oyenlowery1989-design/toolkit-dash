"use client";

import { useCallback, useEffect, useState } from "react";
import { StrKey } from "stellar-sdk";
import { createDbCache, dbPost, dbDelete, debounce } from "@/lib/db-client";

export type AddressColor = "amber" | "blue" | "green" | "red" | "purple" | "gray";

export interface AddressBookEntry {
  publicKey: string;
  label: string;
  notes?: string;
  color?: AddressColor;
  timestamp: number;
}

export const ADDRESS_COLORS: Record<
  AddressColor,
  { dot: string; text: string; bg: string; ring: string }
> = {
  amber:  { dot: "bg-amber-400",  text: "text-amber-400",  bg: "bg-amber-400/10",  ring: "ring-amber-400" },
  blue:   { dot: "bg-blue-400",   text: "text-blue-400",   bg: "bg-blue-400/10",   ring: "ring-blue-400" },
  green:  { dot: "bg-green-400",  text: "text-green-400",  bg: "bg-green-400/10",  ring: "ring-green-400" },
  red:    { dot: "bg-red-400",    text: "text-red-400",    bg: "bg-red-400/10",    ring: "ring-red-400" },
  purple: { dot: "bg-purple-400", text: "text-purple-400", bg: "bg-purple-400/10", ring: "ring-purple-400" },
  gray:   { dot: "bg-gray-400",   text: "text-gray-400",   bg: "bg-gray-400/10",   ring: "ring-gray-400" },
};

const ENDPOINT = "/api/db/address-book";
const _cache = createDbCache<AddressBookEntry>();

/** Non-reactive label lookup — returns undefined if DB not yet loaded. */
export function resolveAddressLabel(address: string): string | undefined {
  return _cache.get().find((e) => e.publicKey === address)?.label;
}

export function resolveAddressEntry(address: string): AddressBookEntry | undefined {
  return _cache.get().find((e) => e.publicKey === address);
}

export function useAddressBook() {
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

  const entries = _cache.get();

  const upsert = useCallback(
    (entry: Omit<AddressBookEntry, "timestamp"> & { timestamp?: number }) => {
      const newEntry: AddressBookEntry = { ...entry, timestamp: entry.timestamp ?? Date.now() };
      const current = _cache.get();
      const idx = current.findIndex((e) => e.publicKey === entry.publicKey);
      _cache.set(
        idx >= 0 ? current.map((e, i) => (i === idx ? newEntry : e)) : [newEntry, ...current],
      );
      dbPost(ENDPOINT, newEntry);
    },
    [],
  );

  const remove = useCallback((publicKey: string) => {
    _cache.set(_cache.get().filter((e) => e.publicKey !== publicKey));
    dbDelete(ENDPOINT, publicKey);
  }, []);

  const importBulk = useCallback((text: string): number => {
    const current = new Map(_cache.get().map((e) => [e.publicKey, e]));
    let count = 0;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const match = line.match(/^([A-Z2-7]{56})[=\t ]+(.+)$/);
      if (!match) continue;
      const [, publicKey, label] = match;
      if (!StrKey.isValidEd25519PublicKey(publicKey)) continue;
      const existing = current.get(publicKey);
      const newEntry: AddressBookEntry = {
        publicKey,
        label: label.trim(),
        notes: existing?.notes,
        color: existing?.color,
        timestamp: Date.now(),
      };
      current.set(publicKey, newEntry);
      dbPost(ENDPOINT, newEntry);
      count++;
    }
    _cache.set([...current.values()]);
    return count;
  }, []);

  const setEntries = useCallback((next: AddressBookEntry[]) => {
    _cache.set(next);
    // Replace all: delete all then re-insert — handled by individual upserts
    next.forEach((e) => dbPost(ENDPOINT, e));
  }, []);

  return { entries, upsert, remove, importBulk, setEntries };
}
