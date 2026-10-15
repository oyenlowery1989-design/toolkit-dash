import { inferDistribLite } from "@/lib/asset-lookup/fetchers";
import type { DistributionEvidence } from "@/lib/asset-lookup/types";
import { findSavedDistributors, type AssetGroup } from "@/lib/asset-groups/types";

export interface SellerAttribution {
  account: string;
  source: "manual" | "saved" | "inferred";
  evidence: DistributionEvidence[];
  confirmedSeller?: boolean;
  saleEvidenceIds?: string[];
}

export interface SellerSelection {
  accounts: string[];
  attributions: SellerAttribution[];
}

/** Explicit choices take precedence; funding evidence identifies candidates, not sales. */
export async function selectSellerAccounts(options: {
  horizonUrl: string;
  assetCode: string;
  issuer: string;
  network: string;
  groups: AssetGroup[];
  savedAccounts?: string[];
  manualAccounts?: string[];
  signal: AbortSignal;
  onLog?: (message: string) => void;
  onResult?: (attribution: SellerAttribution) => void;
}): Promise<SellerSelection> {
  options.signal.throwIfAborted();
  const manual = [...new Set(options.manualAccounts?.map(a => a.trim()).filter(Boolean))];
  const saved = options.savedAccounts ?? findSavedDistributors(options.groups, options.assetCode, options.issuer, options.network);
  let attributions: SellerAttribution[];
  if (manual.length || saved.length) {
    const source = manual.length ? "manual" : "saved";
    attributions = (manual.length ? manual : saved).map(account => ({ account, source, evidence: [] }));
  } else {
    const candidates = await inferDistribLite(options.horizonUrl, options.assetCode, options.issuer,
      options.signal, options.onLog);
    attributions = candidates.map(candidate => ({ account: candidate.address, source: "inferred", evidence: candidate.evidence ?? [] }));
  }
  options.signal.throwIfAborted();
  attributions.forEach(attribution => options.onResult?.(attribution));
  options.onLog?.(`Selected ${attributions.length} account(s) for asset-specific sales verification; funding alone does not prove selling.`);
  return { accounts: attributions.map(a => a.account), attributions };
}
