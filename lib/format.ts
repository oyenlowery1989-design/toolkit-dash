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
