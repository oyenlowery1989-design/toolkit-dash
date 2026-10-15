"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ShortAddress } from "@/components/shared/ShortAddress";
import { getErrorMessage } from "@/lib/stellar-helpers";
import { fetchTopAssetHolders, type TopHoldersResult } from "@/lib/proceeds-investigator/top-holders";

export function TopHolders({ assetCode, issuer, horizonUrl, network, selectedAccounts, disabled, onUseHolder }: {
  assetCode: string; issuer: string; horizonUrl: string; network: string;
  selectedAccounts: string[]; disabled: boolean; onUseHolder: (address: string) => void;
}) {
  const [result, setResult] = useState<TopHoldersResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanned, setScanned] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);
  async function check() {
    abortRef.current?.abort();
    const controller = new AbortController();abortRef.current = controller;
    setLoading(true);setError(null);setScanned(0);
    try {
      const next = await fetchTopAssetHolders(horizonUrl, assetCode, issuer, controller.signal, {
        onLog: message => console.info(`[Top holders ${assetCode}] ${message}`),
        onProgress: count => { if (!controller.signal.aborted) setScanned(count); },
      });
      if (!controller.signal.aborted) setResult(next);
    } catch (cause) {
      if (!controller.signal.aborted) setError(getErrorMessage(cause));
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }
  return <section aria-label="Top 3 asset holders" className="rounded-md border p-3 space-y-3 text-xs">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="font-medium">Top 3 holders · {assetCode}</h4>
      <div className="flex gap-2">
        {loading ? <Button variant="outline" size="sm" onClick={() => { abortRef.current?.abort();setLoading(false); }}>Stop holder check</Button>
          : <Button variant="outline" size="sm" onClick={check} disabled={disabled}>{result ? "Refresh top holders" : "Check top 3 holders"}</Button>}
      </div>
    </div>
    <p className="text-muted-foreground">Current account balances are clues, not confirmed distribution or sales. Adding a holder selects it for the manual seller accounts list.</p>
    {loading && <p role="status">Checking all accounts… {scanned.toLocaleString()} scanned.</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {result && <>
      <p className="text-muted-foreground">{result.holderCount.toLocaleString()} accounts with a positive balance · checked {new Date(result.checkedAt).toLocaleString()}.</p>
      {result.observedSupply && <p className="text-muted-foreground">Observed supply: {result.observedSupply} {assetCode}.</p>}
      {result.warning && <p role="status">{result.warning}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="border-b"><th className="text-left p-2">Holder</th><th className="text-right p-2">{assetCode} balance</th><th className="text-right p-2">% of observed supply</th><th className="p-2"><span className="sr-only">Seller selection</span></th></tr></thead>
          <tbody>{result.holders.map(holder => <tr key={holder.address} className="border-b last:border-0">
            <td className="p-2"><ShortAddress address={holder.address} network={network} /></td>
            <td className="p-2 text-right font-mono">{holder.balance}</td>
            <td className="p-2 text-right tabular-nums">{holder.percentage === null ? "Unknown" : holder.percentage < 0.01 ? "<0.01%" : `${holder.percentage.toFixed(2)}%`}</td>
            <td className="p-2 text-right"><Button variant="outline" size="sm" disabled={disabled || selectedAccounts.includes(holder.address)} onClick={() => onUseHolder(holder.address)}>{selectedAccounts.includes(holder.address) ? "Added" : "Use as seller"}</Button></td>
          </tr>)}</tbody>
        </table>
      </div>
      {result.holders.length === 0 && <p>No account currently holds a positive balance of this asset.</p>}
      <p className="text-muted-foreground">Percentages include account balances, claimable balances, liquidity pools and contracts. Only account holders are ranked. Balances may change during the scan.</p>
    </>}
  </section>;
}
