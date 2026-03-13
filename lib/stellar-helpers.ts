// ---------------------------------------------------------------------------
// Shared Stellar helpers — deduplicated from page-level utility functions.
// ---------------------------------------------------------------------------

/**
 * Extract a user-friendly error message from an unknown thrown value.
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "An unexpected error occurred.";
}

/**
 * Format an ISO-8601 timestamp as a relative "time ago" string.
 */
export function timeAgo(isoDate: string): string {
  const diff = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

/**
 * Truncate a Stellar key or hash for display: `GABCD…WXYZ`.
 */
export function shortKey(key: string, head = 8, tail = 6): string {
  if (key.length <= head + tail + 1) return key;
  return `${key.slice(0, head)}…${key.slice(-tail)}`;
}

/**
 * Return a display name for a Stellar asset.
 * Native lumens → "XLM", credit assets → their code, fallback → "unknown".
 */
export function formatAsset(assetType: string, assetCode?: string): string {
  if (assetType === "native") return "XLM";
  return assetCode ?? "unknown";
}

/**
 * Locale-format a numeric balance string.
 */
export function formatBalance(amount: string, decimals = 7): string {
  return Number(amount).toLocaleString(undefined, {
    maximumFractionDigits: decimals,
  });
}
