import { StrKey } from "stellar-sdk";

/**
 * Shorten a Stellar address to GABC…WXYZ format (4 + 4 chars).
 */
export function shortAddr(addr: string): string {
  if (!addr || addr.length < 8) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

/**
 * Format a number as XLM with up to 7 decimal places, trimming trailing zeros.
 */
export function formatXlm(n: number): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 7,
  });
}

/**
 * Live-price USD estimate for an XLM amount, e.g. "~$1,234.56".
 * Always CURRENT price × amount — Horizon exposes no historical XLM/USD rate,
 * so this is not "value at the time" for older/saved figures.
 * Returns null when no price is loaded yet (caller should render nothing).
 * Pair with `useXlmUsdPrice()` (hooks/use-xlm-usd-price.ts) for the price feed.
 */
export function formatUsdEstimate(xlmAmount: number, price: number | null): string | null {
  if (price === null) return null;
  return `~$${(xlmAmount * price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Parse a multiline string of Stellar addresses.
 * - Splits by newline, trims whitespace
 * - Keeps only valid Ed25519 public keys (G...)
 * - Deduplicates
 */
export function parseAddresses(text: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of text.split("\n")) {
    const addr = line.trim();
    if (addr && StrKey.isValidEd25519PublicKey(addr) && !seen.has(addr)) {
      seen.add(addr);
      result.push(addr);
    }
  }
  return result;
}
