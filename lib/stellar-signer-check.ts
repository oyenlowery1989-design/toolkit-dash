export interface RawHorizonAccountSigners {
  signers: Array<{ key: string; weight: number }>;
  thresholds: { low_threshold: number; med_threshold: number; high_threshold: number };
}

export interface SignerCheckResult {
  locked: boolean;
  reason: string | null;
}

/**
 * Checks whether `publicKey` alone has enough signing weight to authorize a
 * medium-threshold operation (payment, trustline change, etc.) on `account`.
 * Does not account for combining multiple signers' weights — flags "locked"
 * for any account needing more than one signature, even if the caller holds
 * another sufficient key too.
 */
export function checkSignerCanPay(
  account: RawHorizonAccountSigners,
  publicKey: string,
): SignerCheckResult {
  const signer = account.signers.find((s) => s.key === publicKey);
  const medThreshold = account.thresholds.med_threshold;

  if (!signer || signer.weight === 0) {
    return {
      locked: true,
      reason: "This key has no signing weight on the account — it cannot authorize payments.",
    };
  }
  if (signer.weight < medThreshold) {
    return {
      locked: true,
      reason: `Signer weight (${signer.weight}) is below the account's payment threshold (${medThreshold}) — additional signers are required.`,
    };
  }
  return { locked: false, reason: null };
}
