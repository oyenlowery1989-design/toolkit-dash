"use client";

import { useState } from "react";
import { TransactionBuilder, type Horizon, type Keypair } from "stellar-sdk";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2, Search, ShieldOff, AlertTriangle } from "lucide-react";
import { parseAddresses } from "@/lib/format";
import { resolveNetworkPassphrase, type Network } from "@/lib/settings";
import { getErrorMessage } from "@/lib/stellar-helpers";
import { scanSponsoredEntries, type RevokableItem } from "@/lib/sponsorship/fetchers";
import { buildRevokeOp, chunkItems } from "@/lib/sponsorship/builder";
import { ShortAddress } from "@/components/shared/ShortAddress";

interface AddressResult {
  address: string;
  items: RevokableItem[];
  error?: string;
}

interface RevokeSponsorshipPanelProps {
  sponsorPublicKey: string;
  signerKeypair: Keypair | null;
  horizonServer: Horizon.Server;
  horizonUrl: string;
  network: Network | string;
}

/**
 * Horizon has no "list everything this account sponsors" endpoint — the user
 * pastes addresses they know were sponsored (e.g. saved via Account Funder's
 * Sponsored tab), and this checks each one's live sponsor field against
 * `sponsorPublicKey`, then builds/signs/submits revokeXSponsorship ops.
 */
export function RevokeSponsorshipPanel({
  sponsorPublicKey,
  signerKeypair,
  horizonServer,
  horizonUrl,
  network,
}: RevokeSponsorshipPanelProps) {
  const [addressesText, setAddressesText] = useState("");
  const [scanning, setScanning] = useState(false);
  const [results, setResults] = useState<AddressResult[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleScan = async () => {
    const addresses = parseAddresses(addressesText);
    if (addresses.length === 0) return;
    setScanning(true);
    setSubmitStatus(null);
    setSubmitError(null);
    const next: AddressResult[] = [];
    for (const address of addresses) {
      try {
        const items = await scanSponsoredEntries(horizonUrl, sponsorPublicKey, address);
        next.push({ address, items });
      } catch (e) {
        next.push({ address, items: [], error: getErrorMessage(e) });
      }
    }
    setResults(next);
    setSelected(new Set(next.flatMap((r) => r.items.map((i) => i.key))));
    setScanning(false);
  };

  const allItems = results.flatMap((r) => r.items);

  const toggleItem = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleRevoke = async () => {
    if (!signerKeypair) return;
    const selectedItems = allItems.filter((i) => selected.has(i.key));
    if (selectedItems.length === 0) return;

    setSubmitting(true);
    setSubmitError(null);
    const chunks = chunkItems(selectedItems);
    const revokedKeys = new Set<string>();

    try {
      for (let i = 0; i < chunks.length; i++) {
        setSubmitStatus(`Submitting batch ${i + 1} of ${chunks.length}…`);
        const account = await horizonServer.loadAccount(sponsorPublicKey);
        const networkPassphrase = resolveNetworkPassphrase(network as Network);
        const builder = new TransactionBuilder(account, { fee: "10000", networkPassphrase });
        for (const item of chunks[i]) {
          builder.addOperation(buildRevokeOp(item));
        }
        const tx = builder.setTimeout(30).build();
        tx.sign(signerKeypair);
        await horizonServer.submitTransaction(tx);
        chunks[i].forEach((item) => revokedKeys.add(item.key));
      }
      setSubmitStatus(`Revoked ${revokedKeys.size} sponsorship${revokedKeys.size === 1 ? "" : "s"}.`);
      setResults((prev) =>
        prev
          .map((r) => ({ ...r, items: r.items.filter((i) => !revokedKeys.has(i.key)) }))
          .filter((r) => r.items.length > 0 || r.error),
      );
      setSelected((prev) => {
        const next = new Set(prev);
        revokedKeys.forEach((k) => next.delete(k));
        return next;
      });
    } catch (e) {
      setSubmitError(getErrorMessage(e));
      setSubmitStatus(null);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Paste addresses this account may have sponsored (e.g. via Account Funder's
        Sponsored tab). Each is checked live against this account's sponsor field —
        no bulk discovery exists on Horizon.
      </p>

      <div className="space-y-1.5">
        <Label htmlFor="sponsor-scan-addresses">Addresses to check</Label>
        <textarea
          id="sponsor-scan-addresses"
          className="w-full min-h-24 rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono"
          placeholder={"GABC...\nGDEF..."}
          value={addressesText}
          onChange={(e) => setAddressesText(e.target.value)}
          disabled={scanning || submitting}
        />
      </div>

      <Button onClick={handleScan} disabled={scanning || submitting || !addressesText.trim()} size="sm">
        {scanning ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Search className="h-3.5 w-3.5 mr-1.5" />}
        Scan
      </Button>

      {results.length > 0 && (
        <div className="space-y-2 rounded-md border border-border p-3">
          {allItems.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              None of the checked addresses show a sponsorship from this account.
            </p>
          ) : (
            <>
              {results.map((r) =>
                r.items.length === 0 ? null : (
                  <div key={r.address} className="space-y-1">
                    <ShortAddress address={r.address} network={network} />
                    {r.items.map((item) => (
                      <label key={item.key} className="flex items-center gap-2 text-xs pl-2">
                        <input
                          type="checkbox"
                          checked={selected.has(item.key)}
                          onChange={() => toggleItem(item.key)}
                          disabled={submitting}
                        />
                        {item.label}
                      </label>
                    ))}
                  </div>
                ),
              )}
              <Button
                onClick={handleRevoke}
                disabled={submitting || !signerKeypair || selected.size === 0}
                size="sm"
                variant="destructive"
              >
                {submitting ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <ShieldOff className="h-3.5 w-3.5 mr-1.5" />}
                Revoke {selected.size} Selected
              </Button>
              {!signerKeypair && (
                <p className="text-xs text-amber-500 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  No signing key available — connect a full wallet or enter a secret key.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {submitStatus && <p className="text-xs text-muted-foreground">{submitStatus}</p>}
      {submitError && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          {submitError}
        </p>
      )}
    </div>
  );
}
