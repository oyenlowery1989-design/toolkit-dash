// ---------------------------------------------------------------------------
// Shared Stellar helpers — deduplicated from page-level utility functions.
// ---------------------------------------------------------------------------

/**
 * Extract a user-friendly error message from an unknown thrown value.
 */
export function getErrorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) {
    // Horizon 400 errors carry result_codes in the response body
    const codes = (err as any)?.response?.data?.extras?.result_codes;
    if (codes) {
      const tx: string = codes.transaction ?? "";
      const ops: string[] = codes.operations ?? [];
      const parts: string[] = [];
      if (tx) parts.push(`tx: ${tx}`);
      if (ops.length) parts.push(`ops: ${ops.join(", ")}`);
      if (parts.length) return `${err.message} — ${parts.join(" | ")}`;
    }
    return err.message;
  }
  return "An unexpected error occurred.";
}

/**
 * Format an ISO-8601 timestamp as a relative "time ago" string.
 */
export function timeAgo(isoDate: string | number): string {
  const diff = Math.floor((Date.now() - (typeof isoDate === "number" ? isoDate : new Date(isoDate).getTime())) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
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
