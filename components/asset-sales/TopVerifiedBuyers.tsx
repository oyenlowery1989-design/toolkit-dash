"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ShortAddress } from "@/components/shared/ShortAddress";
import { shortAddr } from "@/lib/format";
import { getErrorMessage } from "@/lib/stellar-helpers";
import { fetchTopVerifiedBuyers, type BuyerWindow, type TopBuyersResult } from "@/lib/proceeds-investigator/top-buyers";

const periods: Array<{ value: BuyerWindow; label: string }> = [
  { value: "7d", label: "7 days" }, { value: "30d", label: "30 days" }, { value: "all", label: "All history" },
];

export function TopVerifiedBuyers({ assetCode, issuer, horizonUrl, network, disabled }: {
  assetCode: string; issuer: string; horizonUrl: string; network: string; disabled: boolean;
}) {
  const [period, setPeriod] = useState<BuyerWindow>("7d");
  const [result, setResult] = useState<TopBuyersResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanned, setScanned] = useState(0);
  const [visible, setVisible] = useState(10);
  const [proofAddress, setProofAddress] = useState<string | null>(null);
  const [proofVisible, setProofVisible] = useState(10);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  async function check(nextPeriod = period) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);setStopped(false);setError(null);setResult(null);setScanned(0);setVisible(10);setProofAddress(null);
    try {
      const next = await fetchTopVerifiedBuyers(horizonUrl, assetCode, issuer, nextPeriod, controller.signal, {
        requestTimeoutMs: 30_000,
        onLog: message => console.info(`[Verified buyers ${assetCode}] ${message}`),
        onProgress: count => { if (!controller.signal.aborted) setScanned(count); },
        onResult: partial => { if (!controller.signal.aborted) setResult(partial); },
      });
      if (!controller.signal.aborted) setResult(next);
    } catch (cause) {
      if (!controller.signal.aborted) setError(getErrorMessage(cause));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  function changePeriod(next: BuyerWindow) {
    if (next === period) return;
    const rerun = loading || result !== null;
    abortRef.current?.abort();setPeriod(next);setResult(null);setStopped(false);setError(null);setLoading(false);setProofAddress(null);
    if (rerun) void check(next);
  }
  const proof = result?.buyers.find(buyer => buyer.address === proofAddress);
  const explorer = `https://stellar.expert/explorer/${network === "testnet" ? "testnet" : "public"}`;
  return <section aria-label="Top Verified Buyers" className="rounded-md border p-3 space-y-3 text-xs">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="font-medium">Top Verified Buyers · {assetCode}</h4>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Buyer period" className="flex gap-1">
          {periods.map(item => <Button key={item.value} size="sm" variant={item.value === period ? "secondary" : "ghost"}
            aria-pressed={item.value === period} disabled={disabled} onClick={() => changePeriod(item.value)}>{item.label}</Button>)}
        </div>
        {loading ? <Button variant="outline" size="sm" onClick={() => { abortRef.current?.abort();setLoading(false);setStopped(true); }}>Stop buyer check</Button>
          : <Button variant="outline" size="sm" disabled={disabled} onClick={() => void check()}>{result ? "Refresh buyers" : "Check verified buyers"}</Button>}
      </div>
    </div>
    <p className="text-muted-foreground">Ranked by verified XLM spent on the {assetCode}/XLM market. Transfers and airdrops do not qualify.</p>
    {loading && <p role="status">Verifying purchases… {scanned.toLocaleString()} trades checked. Ranking is provisional.</p>}
    {stopped && <p role="status">Buyer check stopped. Retained results are partial.</p>}
    {error && <p role="alert" className="text-destructive">Buyer check failed; any retained ranking is partial. {error}</p>}
    {result && <>
      <p className="text-muted-foreground">{result.requestedFrom ?? "All available history"} → {result.requestedTo} · {result.buyers.length.toLocaleString()} verified buyers</p>
      {!!result.warnings.length && <details><summary className="cursor-pointer">Coverage limited or unverified — details ({result.warnings.length})</summary>
        <div className="space-y-1 mt-2">{result.warnings.map(warning => <p key={warning}>{warning}</p>)}</div>
      </details>}
      {result.skippedRecords > 0 && <p role="status">{result.skippedRecords.toLocaleString()} records excluded; ranking may be incomplete.</p>}
      {result.buyers.length > 0 ? <>
        <Table aria-label="Verified buyer ranking" className="text-xs [&_th]:px-2 [&_td]:px-2 [&_td]:py-2">
          <TableHeader><TableRow>
            <TableHead className="min-w-40">Buyer</TableHead><TableHead className="text-right">XLM spent ↓</TableHead>
            <TableHead className="text-right">{assetCode} bought</TableHead><TableHead className="text-right">Avg XLM/token</TableHead>
            <TableHead className="text-right">Purchases</TableHead><TableHead>Latest purchase</TableHead><TableHead>Proof</TableHead>
          </TableRow></TableHeader>
          <TableBody>{result.buyers.slice(0, visible).map(buyer => <TableRow key={buyer.address}>
            <TableCell><ShortAddress address={buyer.address} network={network} /></TableCell>
            <TableCell className="text-right font-mono whitespace-nowrap">{buyer.xlmSpent}</TableCell>
            <TableCell className="text-right font-mono whitespace-nowrap">{buyer.assetBought}</TableCell>
            <TableCell className="text-right font-mono">{buyer.averagePrice.toLocaleString(undefined, { maximumSignificantDigits: 10 })}</TableCell>
            <TableCell className="text-right">{buyer.purchaseCount}</TableCell>
            <TableCell className="whitespace-nowrap" title={`First: ${new Date(buyer.firstPurchase).toLocaleString()} · latest: ${new Date(buyer.latestPurchase).toLocaleString()}`}>{new Date(buyer.latestPurchase).toLocaleDateString()}</TableCell>
            <TableCell><Button variant="ghost" size="sm" aria-label={`View purchases for ${shortAddr(buyer.address)}`} aria-expanded={proofAddress === buyer.address}
              onClick={() => { setProofAddress(previous => previous === buyer.address ? null : buyer.address);setProofVisible(10); }}>Proof</Button></TableCell>
          </TableRow>)}</TableBody>
        </Table>
        <div className="flex items-center justify-between gap-2"><p className="text-muted-foreground">Showing {Math.min(visible, result.buyers.length)} of {result.buyers.length} buyers.</p>
          {visible < result.buyers.length && <Button variant="outline" size="sm" onClick={() => setVisible(count => count + 10)}>Show 10 more buyers</Button>}
        </div>
      </> : !loading && <p>No verified XLM purchases found in the covered records.</p>}
      {proof && <div aria-label="Verified purchase evidence" role="region" className="rounded-md border p-3 space-y-2">
        <div className="flex flex-wrap justify-between gap-2"><ShortAddress address={proof.address} network={network} />
          <Button variant="ghost" size="sm" onClick={() => setProofAddress(null)}>Close purchase proof</Button></div>
        <p>First purchase: {new Date(proof.firstPurchase).toLocaleString()} · latest: {new Date(proof.latestPurchase).toLocaleString()}</p>
        {proof.evidence.slice(0, proofVisible).map(entry => <div key={entry.id} className="flex flex-wrap gap-2 border-b py-2">
          <a className="underline" href={`${explorer}/tx/${entry.txHash}`} target="_blank" rel="noopener noreferrer">{new Date(entry.createdAt).toLocaleString()}</a>
          <span>{entry.xlmSpent} XLM → {entry.assetBought} {assetCode}</span>
          {entry.recipient && entry.recipient !== proof.address && <span className="flex items-center gap-1">Delivered to <ShortAddress address={entry.recipient} network={network} /></span>}
        </div>)}
        <p className="text-muted-foreground">Showing {Math.min(proofVisible, proof.evidence.length)} of {proof.evidence.length} evidence records.</p>
        {proofVisible < proof.evidence.length && <Button variant="outline" size="sm" onClick={() => setProofVisible(count => count + 10)}>Show 10 more purchases</Button>}
      </div>}
      <p className="text-muted-foreground">Available classic XLM-market history only; other pairs, OTC payments and contract swaps are not covered. Spending does not prove current wealth or ownership.</p>
    </>}
  </section>;
}
