import { shortAddr } from "@/lib/format";

const FETCH_TIMEOUT_MS = 15_000;

export interface RevokableItem {
  key: string;
  kind: "account" | "trustline" | "signer";
  address: string;
  assetCode?: string;
  assetIssuer?: string;
  signerKey?: string;
  label: string;
}

interface RawSponsoredAccount {
  sponsor?: string;
  balances: Array<{
    asset_type: string;
    asset_code?: string;
    asset_issuer?: string;
    sponsor?: string;
  }>;
  signers: Array<{ key: string; sponsor?: string }>;
}

/**
 * Horizon has no reverse index for "everything account X sponsors" — this
 * checks one target account's live record for entries whose `sponsor` field
 * matches the given sponsor address (account creation, trustlines, signers).
 */
export async function scanSponsoredEntries(
  horizonUrl: string,
  sponsor: string,
  address: string,
  signal?: AbortSignal,
): Promise<RevokableItem[]> {
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onExternalAbort);
  }
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(`${horizonUrl}/accounts/${address}`, {
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as RawSponsoredAccount;
    const items: RevokableItem[] = [];

    if (data.sponsor === sponsor) {
      items.push({
        key: `account:${address}`,
        kind: "account",
        address,
        label: "Account creation reserve",
      });
    }
    for (const b of data.balances) {
      if (b.asset_type !== "native" && b.sponsor === sponsor && b.asset_code && b.asset_issuer) {
        items.push({
          key: `trustline:${address}:${b.asset_code}:${b.asset_issuer}`,
          kind: "trustline",
          address,
          assetCode: b.asset_code,
          assetIssuer: b.asset_issuer,
          label: `Trustline ${b.asset_code}`,
        });
      }
    }
    for (const s of data.signers) {
      if (s.sponsor === sponsor) {
        items.push({
          key: `signer:${address}:${s.key}`,
          kind: "signer",
          address,
          signerKey: s.key,
          label: `Signer ${shortAddr(s.key)}`,
        });
      }
    }
    return items;
  } catch {
    return [];
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", onExternalAbort);
  }
}
