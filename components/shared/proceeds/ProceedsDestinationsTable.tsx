"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, UserSearch, Layers, Wallet, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ShortAddress } from "@/components/shared/ShortAddress";
import { formatXlm } from "@/lib/format";
import { SaveToGroupButton } from "./SaveToGroupButton";
import { useHorizonServer } from "@/hooks/use-horizon-server";
import { fetchXlmBalance, type XlmBalanceValue } from "@/lib/horizon-balance";
import type { DestinationSummary } from "@/lib/proceeds-investigator/types";

const BALANCE_CHECK_BATCH = 10;

interface ProceedsDestinationsTableProps {
  destinations: DestinationSummary[];
  /** Denominator for the percentage column. Ignored when showPercentColumn is false. */
  totalXlmProceeds: number;
  network: string;
  /** Required only when showGroupAction is used (asset-level Save-to-Group). */
  assetCode?: string;
  issuer?: string;
  /** Render a horizontal progress bar next to the percentage value. */
  showProgressBar?: boolean;
  /** Show the percentage-of-total column at all. Default true (existing behavior). */
  showPercentColumn?: boolean;
  /** Header label for the percentage column. Default "% of Proceeds". */
  percentColumnLabel?: string;
  /** Header label for the address column. Default "Destination". */
  addressColumnLabel?: string;
  /** Per-row CSV download action for that destination's ledger entries. Omit to hide. */
  onDownloadCsv?: (address: string) => void;
  /** Per-row "investigate this address" navigation. Omit to hide. */
  onInvestigate?: (address: string) => void;
  /** Show the Save-to-Group / in-group action per row (asset-level context — requires assetCode/issuer). */
  showGroupAction?: boolean;
  /** Alternative to showGroupAction for callers with no asset context (e.g. address investigation) —
   *  caller owns the group-picker UI and receives the clicked address. */
  onAddToGroup?: (address: string) => void;
  /** Message shown when destinations is empty. Default "No destination outflows found." */
  emptyMessage?: string;
  /** Show the live "Holds Now" balance-check column. Default true. */
  showBalanceColumn?: boolean;
}

/** Standard table for a list of counterparty/destination address summaries
 *  ({ address, totalXlm, count }) — used for both proceeds "top destinations"
 *  and address-investigation "top senders/recipients". */
export function ProceedsDestinationsTable({
  destinations,
  totalXlmProceeds,
  network,
  assetCode = "",
  issuer = "",
  showProgressBar = false,
  showPercentColumn = true,
  percentColumnLabel = "% of Proceeds",
  addressColumnLabel = "Destination",
  onDownloadCsv,
  onInvestigate,
  showGroupAction = false,
  onAddToGroup,
  emptyMessage = "No destination outflows found.",
  showBalanceColumn = true,
}: ProceedsDestinationsTableProps) {
  const hasActions = !!onDownloadCsv || !!onInvestigate || showGroupAction || !!onAddToGroup;
  const colSpan =
    3 + (showPercentColumn ? 1 : 0) + (hasActions ? 1 : 0) + (showBalanceColumn ? 1 : 0);

  const { url: horizonUrl } = useHorizonServer();
  const [balances, setBalances] = useState<Record<string, XlmBalanceValue | "loading">>({});
  const abortRef = useRef<AbortController | null>(null);

  const addressKey = useMemo(
    () => destinations.map((d) => d.address).join(","),
    [destinations],
  );

  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBalances({});
    return () => controller.abort();
  }, [addressKey]);

  async function checkBalance(address: string) {
    setBalances((prev) => ({ ...prev, [address]: "loading" }));
    const controller = abortRef.current;
    const result = await fetchXlmBalance(horizonUrl, address, controller?.signal);
    if (controller?.signal.aborted) return;
    setBalances((prev) => ({ ...prev, [address]: result }));
  }

  async function checkTopBatch() {
    const targets = destinations
      .filter((d) => balances[d.address] === undefined)
      .slice(0, BALANCE_CHECK_BATCH);
    if (targets.length === 0) return;
    const controller = abortRef.current;
    setBalances((prev) => {
      const next = { ...prev };
      for (const t of targets) next[t.address] = "loading";
      return next;
    });
    await Promise.allSettled(
      targets.map(async (t) => {
        const result = await fetchXlmBalance(horizonUrl, t.address, controller?.signal);
        if (controller?.signal.aborted) return;
        setBalances((prev) => ({ ...prev, [t.address]: result }));
      }),
    );
  }

  return (
    <div className="overflow-x-auto border rounded-md">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/40">
            <th className="text-left px-3 py-2">{addressColumnLabel}</th>
            <th className="text-right px-3 py-2">Amount XLM</th>
            {showPercentColumn && <th className="text-right px-3 py-2">{percentColumnLabel}</th>}
            {showBalanceColumn && (
              <th className="text-right px-3 py-2">
                <div className="flex items-center justify-end gap-1.5">
                  <span title="Live balance still held by this address now — distinct from % of proceeds ever received">
                    Holds Now
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto py-0.5 px-1.5 text-[10px] font-normal"
                    onClick={checkTopBatch}
                    title={`Check current balance for the first ${BALANCE_CHECK_BATCH} unchecked rows`}
                  >
                    check top {BALANCE_CHECK_BATCH}
                  </Button>
                </div>
              </th>
            )}
            <th className="text-right px-3 py-2">Tx Count</th>
            {hasActions && <th className="text-right px-3 py-2">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {destinations.map((row) => {
            const pct = totalXlmProceeds > 0 ? (row.totalXlm / totalXlmProceeds) * 100 : 0;
            return (
              <tr key={row.address} className="border-b last:border-0">
                <td className="px-3 py-2 text-xs">
                  <ShortAddress address={row.address} network={network} />
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{formatXlm(row.totalXlm)}</td>
                {showPercentColumn && (
                  <td className="px-3 py-2 text-right tabular-nums">
                    {showProgressBar ? (
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${Math.min(pct, 100)}%` }}
                          />
                        </div>
                        <span className="tabular-nums w-12 text-right">{pct.toFixed(1)}%</span>
                      </div>
                    ) : (
                      <>{pct.toFixed(2)}%</>
                    )}
                  </td>
                )}
                {showBalanceColumn && (
                  <td className="px-3 py-2 text-right tabular-nums">
                    {(() => {
                      const bal = balances[row.address];
                      if (bal === undefined) {
                        return (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-auto py-0.5 px-1.5 text-xs"
                            onClick={() => checkBalance(row.address)}
                            title="Check current XLM balance"
                          >
                            <Wallet className="h-3 w-3" />
                          </Button>
                        );
                      }
                      if (bal === "loading") {
                        return <Loader2 className="h-3.5 w-3.5 animate-spin ml-auto text-muted-foreground" />;
                      }
                      if (bal === "unfunded") {
                        return <span className="text-xs text-muted-foreground/60">closed</span>;
                      }
                      if (bal === "error") {
                        return (
                          <Button
                            variant="ghost"
                            className="h-auto p-0 text-xs text-destructive/70 hover:bg-transparent hover:text-destructive"
                            onClick={() => checkBalance(row.address)}
                            title="Click to retry"
                          >
                            error ↺
                          </Button>
                        );
                      }
                      return (
                        <span
                          className="text-xs text-muted-foreground"
                          title="Live balance still held by this address — not yet forwarded/spent"
                        >
                          ~{formatXlm(bal)} unspent
                        </span>
                      );
                    })()}
                  </td>
                )}
                <td className="px-3 py-2 text-right tabular-nums">{row.count}</td>
                {hasActions && (
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {onDownloadCsv && (
                        <Button variant="ghost" size="sm" onClick={() => onDownloadCsv(row.address)} title="Download CSV">
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {onInvestigate && (
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Investigate in Address Investigator"
                          onClick={() => onInvestigate(row.address)}
                        >
                          <UserSearch className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {showGroupAction && (
                        <SaveToGroupButton
                          assetCode={assetCode}
                          issuer={issuer}
                          network={network}
                          targetAddress={row.address}
                          size="sm"
                        />
                      )}
                      {onAddToGroup && (
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Add to group"
                          onClick={() => onAddToGroup(row.address)}
                        >
                          <Layers className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
          {destinations.length === 0 && (
            <tr>
              <td colSpan={colSpan} className="px-3 py-4 text-center text-sm text-muted-foreground">
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
