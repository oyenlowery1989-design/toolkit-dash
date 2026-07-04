"use client";

/**
 * Invisible component — mounts in the root layout to initialise the
 * Supabase session and keep the auth token in db-client up to date.
 * Renders nothing; only the side-effects matter.
 */
import { useAuth } from "@/hooks/use-auth";

export function AuthInit() {
  useAuth(); // side-effects only: sets db-client token + cookie
  return null;
}
