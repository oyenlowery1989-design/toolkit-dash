"use client";

import { useMemo } from "react";
import { Horizon } from "stellar-sdk";
import { useSettings, resolveHorizonUrl } from "@/lib/settings";
import type { Network } from "@/lib/settings";

/**
 * Returns a memoized Horizon.Server instance and its URL.
 * Re-instantiates only when the resolved URL changes.
 *
 * @param network - Override the network from global settings (optional).
 */
export function useHorizonServer(network?: Network) {
  const { settings } = useSettings();
  const url = resolveHorizonUrl(network ? { ...settings, network } : settings);
  const server = useMemo(() => new Horizon.Server(url), [url]);
  return { server, url };
}
