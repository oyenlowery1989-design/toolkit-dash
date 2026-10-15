"use client";

import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ShortAddress } from "@/components/shared/ShortAddress";
import { formatXlm } from "@/lib/format";
import { mergeBeneficiaryGroups, type BeneficiaryGrouping } from "@/lib/proceeds-investigator/beneficiaries";

export function BeneficiaryGroups({ groupings, historyIncomplete = false }: {
  groupings: readonly (BeneficiaryGrouping | undefined)[];
  historyIncomplete?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(20);
  const id = useId();
  const groups = useMemo(() => open ? mergeBeneficiaryGroups(groupings.flatMap(grouping => grouping?.groups ?? [])) : [], [open, groupings]);
  const missing = groupings.filter(grouping => !grouping).length;
  const unresolved = groupings.reduce((total, grouping) => total + (grouping?.unresolvedOperationCount ?? 0), 0);
  return <section className="rounded-md border p-3 space-y-2 text-xs" aria-label="Beneficiary credit destinations">
    <div className="flex items-center justify-between gap-2">
      <h4 className="font-medium">Beneficiary credit destinations</h4>
      <Button variant="outline" size="sm" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>{open ? "Hide beneficiary groups" : "Show beneficiary groups"}</Button>
    </div>
    <p>Possible common credit destination — matching network, recipient address, memo type and exact memo value does not prove sender identity or common ownership. Exchange/service identity is unverified.</p>
    <p className="text-muted-foreground">External XLM transfers from selected accounts; totals do not prove which sales funded them. A verified absence of memo groups by address only and does not identify a credit beneficiary.</p>
    {historyIncomplete && <p className="text-muted-foreground">History is incomplete or unproven; groups cover only the retained records in these snapshots.</p>}
    {missing > 0 && <p role="status">{missing} snapshot(s) have no memo grouping metadata. Re-run to populate it; older records are not inferred.</p>}
    {unresolved > 0 && <p role="status">{unresolved} unresolved memo or recipient record(s) across these snapshots (may overlap). They are excluded from groups, not treated as no memo or a base-only recipient.</p>}
    <div id={id}>
      {open && <>
        <p className="text-muted-foreground">Showing {Math.min(visibleCount, groups.length)} of {groups.length} exact destination groups. Each operation is counted once across snapshots.</p>
        {groups.length === 0 && <p>No verified memo destination groups in these snapshots.</p>}
        {groups.slice(0, visibleCount).map(group => {
          const key = JSON.stringify([group.network, group.address, group.memoType, group.memoValue]);
          const explorer = group.network === "public" || group.network === "testnet" ? `https://stellar.expert/explorer/${group.network}` : undefined;
          return <div key={key} className="rounded-md border p-3 space-y-2" data-beneficiary-group>
            <div className="flex flex-wrap items-center gap-2"><span>{group.network}</span><ShortAddress address={group.address} network={group.network} /></div>
            {group.baseAddress && <div className="flex items-center gap-2"><span>Base address:</span><ShortAddress address={group.baseAddress} network={group.network} /></div>}
            <p className="font-mono whitespace-pre-wrap break-all">Memo {group.memoType}: {group.memoValue === null ? "(none — address only)" : JSON.stringify(group.memoValue)}</p>
            <p>{group.senders.length} sender(s) · {group.transfers.length} operation(s) · {formatXlm(group.totalXlm)} XLM transferred</p>
            <div className="flex flex-wrap gap-2">{group.senders.map(account => <ShortAddress key={account} address={account} network={group.network} />)}</div>
            <details>
              <summary className="cursor-pointer">Transaction evidence</summary>
              <ul className="space-y-1 mt-2">
                {group.transfers.slice(0, 20).map(transfer => <li key={`${transfer.txHash}:${transfer.operationId}`} className="break-all">
                  {transfer.createdAt} · {formatXlm(transfer.amountXlm)} XLM · operation {transfer.operationId}{" "}
                  {explorer ? <a className="underline" target="_blank" rel="noopener noreferrer" href={`${explorer}/tx/${encodeURIComponent(transfer.txHash)}`}>View transaction</a> : <span>{transfer.txHash}</span>}
                </li>)}
              </ul>
              {group.transfers.length > 20 && <p>First 20 evidence records shown; all {group.transfers.length} are retained in the snapshot.</p>}
            </details>
          </div>;
        })}
        {groups.length > visibleCount && <Button variant="outline" size="sm" onClick={() => setVisibleCount(value => value + 20)}>Show 20 more beneficiary groups</Button>}
      </>}
    </div>
  </section>;
}
