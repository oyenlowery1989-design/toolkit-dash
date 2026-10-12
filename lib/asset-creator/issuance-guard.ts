import { getDb } from "@/lib/db";
import { getSupabase, isSupabaseOnly } from "@/lib/supabase-server";

type IssuanceClaim = {
  network: string;
  issuer: string;
  asset_code: string;
  unsigned_xdr: string;
  unsigned_hash: string;
  signed_xdr: string;
  created_at: number;
};

export class IssuanceAlreadyClaimedError extends Error {
  constructor() {
    super("The original issuance transaction has expired. Reconcile this asset on the ledger manually before taking further action; the issuance claim remains locked.");
    this.name = "IssuanceAlreadyClaimedError";
  }
}

export class IssuanceProtectionUnavailableError extends Error {
  constructor() {
    super("Could not protect asset issuance; retry when storage is available");
    this.name = "IssuanceProtectionUnavailableError";
  }
}

export async function readAssetIssuanceClaim(network: string, issuer: string, assetCode: string): Promise<string | null> {
  try {
    if (isSupabaseOnly()) {
      const sb = getSupabase();
      if (!sb) throw new IssuanceProtectionUnavailableError();
      const { data, error } = await sb.from("asset_creator_issuance_claims")
        .select("signed_xdr").eq("network", network).eq("issuer", issuer).eq("asset_code", assetCode).maybeSingle();
      if (error) throw new IssuanceProtectionUnavailableError();
      return data?.signed_xdr ?? null;
    }
    const row = getDb().prepare(`SELECT signed_xdr FROM asset_creator_issuance_claims
      WHERE network = ? AND issuer = ? AND asset_code = ?`).get(network, issuer, assetCode) as { signed_xdr: string } | undefined;
    return row?.signed_xdr ?? null;
  } catch {
    throw new IssuanceProtectionUnavailableError();
  }
}

/** The first signed issuance wins permanently, including if submission later fails. */
export async function claimAssetIssuance(claim: IssuanceClaim): Promise<string> {
  let existing: Pick<IssuanceClaim, "signed_xdr"> | null;
  try {
    if (isSupabaseOnly()) {
      const sb = getSupabase();
      if (!sb) throw new IssuanceProtectionUnavailableError();
      const { error } = await sb.from("asset_creator_issuance_claims").insert(claim);
      if (!error) return claim.signed_xdr;
      if (error.code !== "23505") throw new IssuanceProtectionUnavailableError();
      const result = await sb.from("asset_creator_issuance_claims")
        .select("signed_xdr")
        .eq("network", claim.network).eq("issuer", claim.issuer).eq("asset_code", claim.asset_code).single();
      if (result.error) throw new IssuanceProtectionUnavailableError();
      existing = result.data;
    } else {
      const db = getDb();
      const changes = db.prepare(`INSERT INTO asset_creator_issuance_claims
        (network, issuer, asset_code, unsigned_xdr, unsigned_hash, signed_xdr, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(network, issuer, asset_code) DO NOTHING`)
        .run(claim.network, claim.issuer, claim.asset_code, claim.unsigned_xdr, claim.unsigned_hash, claim.signed_xdr, claim.created_at).changes;
      if (changes === 1) return claim.signed_xdr;
      existing = db.prepare(`SELECT signed_xdr FROM asset_creator_issuance_claims
        WHERE network = ? AND issuer = ? AND asset_code = ?`)
        .get(claim.network, claim.issuer, claim.asset_code) as typeof existing;
    }
    if (!existing) throw new IssuanceProtectionUnavailableError();
    return existing.signed_xdr;
  } catch (error) {
    if (error instanceof IssuanceProtectionUnavailableError) throw error;
    throw new IssuanceProtectionUnavailableError();
  }
}
