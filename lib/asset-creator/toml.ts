// lib/asset-creator/toml.ts
import type { AssetCreatorForm } from "./types";

/**
 * Generate a stellar.toml [[CURRENCIES]] snippet for the asset.
 * - code: exact case from form.assetCode (never uppercased)
 * - issuer: full 56-character public key (never shortAddr)
 * - display_decimals: hardcoded 7 (Stellar convention)
 * - name/desc: omitted when empty
 */
export function generateTomlSnippet(form: AssetCreatorForm): string {
  const lines = [
    "[[CURRENCIES]]",
    `code = "${form.assetCode}"`,
    `issuer = "${form.issuerPublicKey}"`,
    `display_decimals = 7`,
  ];
  if (form.tokenName) lines.push(`name = "${form.tokenName}"`);
  lines.push(`is_asset_anchored = false`);
  lines.push(`anchor_asset_type = "other"`);
  return lines.join("\n");
}
