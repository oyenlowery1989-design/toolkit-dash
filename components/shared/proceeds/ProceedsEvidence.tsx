"use client";

import type { AssetProceedsResult } from "@/lib/proceeds-investigator/types";
import { ShortAddress } from "@/components/shared/ShortAddress";
import { BeneficiaryGroups } from "./BeneficiaryGroups";
import { formatXlm } from "@/lib/format";

type EvidenceResult = Pick<AssetProceedsResult, "assetCode" | "issuer" | "accounts" | "coverage" | "accountSummaries" | "sellerAttributions" | "beneficiaryGrouping">;

export function ProceedsEvidence({ result, network }: { result: EvidenceResult; network: string }) {
  const coverage = result.coverage;
  const explorer = `https://stellar.expert/explorer/${network === "testnet" ? "testnet" : "public"}`;
  return <div className="space-y-3 text-xs mt-3">
    <div className="rounded-md border p-3 space-y-1" role="status">
      <p className="font-medium">{coverage?.complete ? (coverage.accountHistoryStarts?.length ? "History covered since observed account creation" : "Requested period covered") : "History coverage is incomplete or unproven"}</p>
      {coverage ? <>
        <p>Requested: {coverage.requestedFrom ?? "all retained history"} → {coverage.requestedTo}</p>
        {coverage.oldestObserved && <p>Observed records: {coverage.oldestObserved} → {coverage.newestObserved ?? "unknown"}</p>}
        {coverage.accountHistoryStarts?.map(start => <p key={start.account}>
          <ShortAddress address={start.account} network={network} /> · {start.createdAt}{" "}
          <a className="underline" href={`${explorer}/tx/${start.txHash}`} target="_blank" rel="noopener noreferrer">Creation proof</a>
        </p>)}
        {!!coverage.accountHistoryStarts?.length && <p className="text-muted-foreground">Selected accounts only; earlier account incarnations are unverified.</p>}
        {(Array.isArray(coverage.warnings) ? coverage.warnings : []).map(warning => <p key={warning} className="text-muted-foreground">{warning}</p>)}
      </> : <p className="text-muted-foreground">This older snapshot did not store its coverage. Re-run to verify attribution and accounting.</p>}
    </div>
    <BeneficiaryGroups groupings={[result.beneficiaryGrouping]} historyIncomplete={!coverage?.complete} />
    <p className="text-muted-foreground">Balances, purchases and outgoing transfers concern the selected accounts. They do not establish profit, ownership, or which receipt funded a later payment.</p>
    {(Array.isArray(result.accounts) ? result.accounts : []).map(account => {
      const summary = result.accountSummaries?.find(item => item.account === account);
      const attribution = result.sellerAttributions?.find(item => item.account === account);
      const confirmed = summary?.confirmedSeller ?? attribution?.confirmedSeller;
      const saleIds = summary?.saleEvidenceIds ?? attribution?.saleEvidenceIds ?? [];
      return <details key={account} className="rounded-md border p-3">
        <summary className="cursor-pointer font-medium">{confirmed ? "Confirmed asset → XLM seller" : "Scanned account; no confirmed sale in covered records"}{summary ? ` · ${formatXlm(summary.totalXlmProceeds)} XLM gross` : ""}</summary>
        <div className="space-y-2 mt-2">
          <ShortAddress address={account} network={network} />
          <p>Selection: {attribution?.source ?? "previously saved accounts"}. Funding evidence alone does not prove selling.</p>
          {attribution?.evidence.map((evidence, index) => <div key={`${evidence.operationId}-${evidence.claimOperationId ?? ""}-${index}`} className="border-l pl-3 space-y-1">
            <p>{evidence.kind === "claimable_balance" ? "Confirmed claim" : "Issuer payment"} · {evidence.amount} asset units</p>
            <div className="flex flex-wrap items-center gap-2"><ShortAddress address={evidence.from} network={network} /><span>→</span><ShortAddress address={evidence.to} network={network} /></div>
            {evidence.attributedAmount && <p>Proven issuer-funded portion: at most {evidence.attributedAmount} asset units of this claim.</p>}
            <p>Operation: {evidence.operationId}{evidence.claimOperationId ? ` · claim: ${evidence.claimOperationId}` : ""}</p>
            {evidence.balanceId && <p className="break-all">Balance: {evidence.balanceId}</p>}
            {(evidence.claimTransactionHash ?? evidence.transactionHash) && <a className="underline" href={`${explorer}/tx/${evidence.claimTransactionHash ?? evidence.transactionHash}`} target="_blank" rel="noopener noreferrer">View ledger transaction</a>}
          </div>)}
          {saleIds.length > 0 && <div><p>{saleIds.length} distinct sale evidence record(s); full records are retained in the analysis.</p><p className="break-all font-mono text-muted-foreground">{saleIds.slice(0,5).join(", ")}{saleIds.length > 5 ? " …" : ""}</p></div>}
        </div>
      </details>;
    })}
  </div>;
}
