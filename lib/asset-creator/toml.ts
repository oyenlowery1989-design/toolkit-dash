// lib/asset-creator/toml.ts
import type { AssetCreatorForm } from "./types";

/**
 * Generate a stellar.toml [[CURRENCIES]] snippet for the asset.
 * - code: exact case from form.assetCode (never uppercased)
 * - issuer: full 56-character public key (never shortAddr)
 * - display_decimals: hardcoded 7 (Stellar convention)
 */
export function generateTomlSnippet(form: AssetCreatorForm): string {
  return [
    "[[CURRENCIES]]",
    `code = "${form.assetCode}"`,
    `issuer = "${form.issuerPublicKey}"`,
    `display_decimals = 7`,
    `name = "${form.tokenName}"`,
    `desc = ""`,
    `is_asset_anchored = false`,
    `anchor_asset_type = "other"`,
  ].join("\n");
}
