"use client";

import { useCallback, useEffect, useState } from "react";
import { createDbCache, dbPost, dbPatch, authHeaders, debounce } from "@/lib/db-client";
import type { Person, PersonAddress } from "@/lib/persons/types";

const ENDPOINT = "/api/db/persons";

function dbDeletePerson(id: string) {
  fetch(ENDPOINT, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ key: id, type: "person" }),
  }).catch(() => {});
}
function dbDeleteAddress(id: string) {
  fetch(ENDPOINT, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ key: id, type: "address" }),
  }).catch(() => {});
}
const _cache = createDbCache<Person>();

// asset_groups.person_id is a foreign key — a PATCH linking a group to a
// still-in-flight new person can commit before the person's own INSERT does,
// tripping the FK constraint. Callers that immediately link a freshly created
// person (e.g. GroupsPanel's "+ New Person" flow) must await this first.
const _pendingPersonCreates = new Map<string, Promise<void>>();

export function getPersonsSnapshot(): Person[] {
  return _cache.get();
}

export function isPersonsLoaded(): boolean {
  return _cache.isLoaded();
}

/** Resolves once a person created via createPerson has been persisted server-side. */
export function waitForPersonId(id: string): Promise<string> {
  return (_pendingPersonCreates.get(id) ?? Promise.resolve()).then(() => id);
}

export function usePersons() {
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

  const persons = _cache.get();

  const createPerson = useCallback((entry: { name: string; role?: string; notes?: string }): string => {
    const id = `per-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = Date.now();
    const nameTrimmed = entry.name.trim();
    const newPerson: Person = {
      id,
      name: nameTrimmed,
      role: entry.role?.trim() || undefined,
      notes: entry.notes?.trim() || undefined,
      addresses: [],
      createdAt: now,
      updatedAt: now,
    };
    _cache.set([newPerson, ..._cache.get()]);
    const p = dbPost(ENDPOINT, { type: "person", id, name: nameTrimmed, role: entry.role, notes: entry.notes })
      .then(() => undefined)
      .catch((err) => {
        _cache.reload(ENDPOINT);
        throw err;
      });
    _pendingPersonCreates.set(id, p);
    return id;
  }, []);

  const updatePerson = useCallback(
    (id: string, patch: Partial<Pick<Person, "name" | "role" | "notes">>) => {
      _cache.set(
        _cache.get().map((p) => (p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p)),
      );
      dbPatch(ENDPOINT, { type: "person", id, ...patch }).catch(() => _cache.reload(ENDPOINT));
    },
    [],
  );

  const deletePerson = useCallback((id: string) => {
    _cache.set(_cache.get().filter((p) => p.id !== id));
    dbDeletePerson(id);
  }, []);

  const addPersonAddress = useCallback(
    (personId: string, entry: { address: string; label?: string }) => {
      const id = `pa-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const now = Date.now();
      const newAddress: PersonAddress = { id, personId, address: entry.address, label: entry.label, addedAt: now };
      _cache.set(
        _cache.get().map((p) => {
          if (p.id !== personId) return p;
          const existing = p.addresses.findIndex((a) => a.address === entry.address);
          const addresses =
            existing >= 0
              ? p.addresses.map((a, i) => (i === existing ? { ...a, ...entry } : a))
              : [...p.addresses, newAddress];
          return { ...p, addresses, updatedAt: now };
        }),
      );
      dbPost(ENDPOINT, { type: "address", id, personId, ...entry }).catch(() => _cache.reload(ENDPOINT));
    },
    [],
  );

  const removePersonAddress = useCallback((personId: string, addressId: string) => {
    _cache.set(
      _cache.get().map((p) =>
        p.id !== personId ? p : { ...p, addresses: p.addresses.filter((a) => a.id !== addressId) },
      ),
    );
    dbDeleteAddress(addressId);
  }, []);

  return {
    persons,
    isLoaded: _cache.isLoaded(),
    createPerson,
    updatePerson,
    deletePerson,
    addPersonAddress,
    removePersonAddress,
  };
}
