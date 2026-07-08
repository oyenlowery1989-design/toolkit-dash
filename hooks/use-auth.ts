"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseBrowser } from "@/lib/supabase-client";
import { setDbAuthToken, clearAllCaches } from "@/lib/db-client";

/** Persist logged-in cookie so middleware can gate page routes. */
function setLoggedInCookie(expiresIn: number) {
  document.cookie = `sb-logged-in=1; path=/; max-age=${expiresIn}; SameSite=Lax`;
}

function clearLoggedInCookie() {
  document.cookie = "sb-logged-in=; path=/; max-age=0";
}

// ---------------------------------------------------------------------------
// Module-level singleton — ONE Supabase auth subscription for the whole app,
// no matter how many components call useAuth() (AuthInit + Header's
// AuthButton both used to call it independently). Two independent
// subscriptions raced: supabase-js can deliver a transient null session to a
// *freshly registered* onAuthStateChange listener before the real persisted
// session resolves, and that stale null was silently clobbering a real token
// the other subscription had already set — causing intermittent 401 storms
// on every DB-backed hook. A single shared subscription removes the race.
// ---------------------------------------------------------------------------

interface AuthState {
  session: Session | null;
  loading: boolean;
}

const INITIAL_STATE: AuthState = { session: null, loading: true };

let state: AuthState = INITIAL_STATE;
let initialized = false;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

function setState(next: Partial<AuthState>) {
  state = { ...state, ...next };
  notify();
}

function applySession(session: Session | null) {
  if (session) {
    setDbAuthToken(session.access_token);
    setLoggedInCookie(session.expires_in ?? 3600);
  } else {
    setDbAuthToken(null);
    clearAllCaches();
    clearLoggedInCookie();
  }
  setState({ session, loading: false });
}

function ensureInitialized() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  const sb = getSupabaseBrowser();
  if (!sb) {
    // Auth not configured — local dev mode, no restrictions
    setState({ loading: false });
    return;
  }

  sb.auth
    .getSession()
    .then(({ data: { session } }) => applySession(session))
    .catch((e) => {
      // Unblock waitForAuth() on network failure so DB fetches proceed (and
      // surface their own error state via createDbCache's retry) instead of
      // hanging forever with cache stuck at isLoaded()===false. Deliberately
      // does NOT clear cookies/caches here — this is a fetch failure, not a
      // confirmed sign-out.
      console.error("[auth] getSession failed:", e);
      setDbAuthToken(null);
      setState({ loading: false });
    });
  sb.auth.onAuthStateChange((_, session) => applySession(session));
}

function subscribe(callback: () => void): () => void {
  ensureInitialized();
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getSnapshot(): AuthState {
  return state;
}

function getServerSnapshot(): AuthState {
  return INITIAL_STATE;
}

export function useAuth() {
  const { session, loading } = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const signOut = useCallback(async () => {
    const sb = getSupabaseBrowser();
    if (sb) await sb.auth.signOut();
    setDbAuthToken(null);
    clearAllCaches();
    clearLoggedInCookie();
    window.location.href = "/login";
  }, []);

  return {
    session,
    loading,
    isAuthenticated: !!session,
    signOut,
  };
}
