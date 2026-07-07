import { StrKey } from "stellar-sdk";

const ASSET_PAIR_RE = /([A-Za-z0-9]{1,12}):([A-Z2-7]{56})/;

export interface AssetPair {
  assetCode: string;
  issuer: string;
}

/** Parses the first CODE:ISSUER pair out of raw text (e.g. pasted clipboard content
 *  or a Lobstr trade URL). Returns null if no match or the issuer isn't a valid
 *  Ed25519 public key. */
export function parseAssetPair(raw: string): AssetPair | null {
  const match = raw.match(ASSET_PAIR_RE);
  if (!match) return null;
  const [, assetCode, issuer] = match;
  if (!StrKey.isValidEd25519PublicKey(issuer)) return null;
  return { assetCode, issuer };
}

/** Parses every CODE:ISSUER pair, one per line, deduping by assetCode:issuer. */
export function parseAssetPairs(text: string): AssetPair[] {
  const seen = new Set<string>();
  const results: AssetPair[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const pair = parseAssetPair(trimmed);
    if (!pair) continue;
    const key = `${pair.assetCode}:${pair.issuer}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(pair);
  }
  return results;
}
