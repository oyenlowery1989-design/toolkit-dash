/**
 * Shared helpers for DB-backed hooks.
 * Each hook gets its own module-level cache so all hook instances
 * share a single fetch and notify each other on writes.
 */

export interface DbCache<T> {
  get(): T[];
  set(data: T[]): void;
  notify(): void;
  isLoaded(): boolean;
  subscribe(fn: () => void): () => void;
  load(endpoint: string): Promise<void>;
  /** Force re-fetch from server regardless of cache state */
  reload(endpoint: string): Promise<void>;
}

export function createDbCache<T>(): DbCache<T> {
  let cache: T[] | null = null;
  let loading = false;
  let fetchPromise: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  return {
    get() {
      return cache ?? [];
    },
    set(data: T[]) {
      cache = data;
      listeners.forEach((fn) => fn());
    },
    notify() {
      listeners.forEach((fn) => fn());
    },
    isLoaded() {
      return cache !== null;
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async load(endpoint: string) {
      if (cache !== null || loading) return fetchPromise ?? Promise.resolve();
      loading = true;
      fetchPromise = fetch(endpoint)
        .then((r) => (r.ok ? r.json() : []))
        .then((data: T[]) => {
          cache = data;
          listeners.forEach((fn) => fn());
        })
        .catch(() => {
          cache = [];
          listeners.forEach((fn) => fn());
        })
        .finally(() => {
          loading = false;
        });
      return fetchPromise;
    },
    async reload(endpoint: string) {
      if (loading) return fetchPromise ?? Promise.resolve();
      loading = true;
      cache = null;
      fetchPromise = fetch(endpoint)
        .then((r) => (r.ok ? r.json() : []))
        .then((data: T[]) => {
          cache = data;
          listeners.forEach((fn) => fn());
        })
        .catch(() => {
          cache = [];
          listeners.forEach((fn) => fn());
        })
        .finally(() => {
          loading = false;
        });
      return fetchPromise;
    },
  };
}

export async function dbPost(endpoint: string, data: unknown): Promise<void> {
  await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
    .then((r) => { if (!r.ok) console.error(`[db] POST ${endpoint} failed: ${r.status}`); })
    .catch((e) => console.error(`[db] POST ${endpoint} network error:`, e));
}

export async function dbPatch(endpoint: string, data: unknown): Promise<void> {
  await fetch(endpoint, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
    .then((r) => { if (!r.ok) console.error(`[db] PATCH ${endpoint} failed: ${r.status}`); })
    .catch((e) => console.error(`[db] PATCH ${endpoint} network error:`, e));
}

export async function dbDelete(endpoint: string, key: unknown): Promise<void> {
  await fetch(endpoint, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key }),
  })
    .then((r) => { if (!r.ok) console.error(`[db] DELETE ${endpoint} failed: ${r.status}`); })
    .catch((e) => console.error(`[db] DELETE ${endpoint} network error:`, e));
}
