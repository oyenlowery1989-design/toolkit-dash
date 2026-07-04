"use client";

import { useCallback, useEffect, useState } from "react";
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

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const sb = getSupabaseBrowser();
    if (!sb) {
      // Auth not configured — local dev mode, no restrictions
      setLoading(false);
      return;
    }

    // Restore existing session
    sb.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      setSession(session);
      // Always call setDbAuthToken so _authReadyPromise resolves even when
      // there is no session — prevents data hooks from hanging forever.
      setDbAuthToken(session?.access_token ?? null);
      if (session) {
        setLoggedInCookie(session.expires_in ?? 3600);
      }
      setLoading(false);
    });

    // Listen for token refresh / sign-out
    const { data: { subscription } } = sb.auth.onAuthStateChange((_, session) => {
      setSession(session);
      if (session) {
        setDbAuthToken(session.access_token);
        setLoggedInCookie(session.expires_in ?? 3600);
      } else {
        setDbAuthToken(null);
        clearAllCaches();
        clearLoggedInCookie();
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

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
