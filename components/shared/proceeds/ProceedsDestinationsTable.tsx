"use client";

import { Download, UserSearch, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ShortAddress } from "@/components/shared/ShortAddress";
import { formatXlm } from "@/lib/format";
import { SaveToGroupButton } from "./SaveToGroupButton";
import type { DestinationSummary } from "@/lib/proceeds-investigator/types";

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
}: ProceedsDestinationsTableProps) {
  const hasActions = !!onDownloadCsv || !!onInvestigate || showGroupAction || !!onAddToGroup;
  const colSpan = 3 + (showPercentColumn ? 1 : 0) + (hasActions ? 1 : 0);

  return (
    <div className="overflow-x-auto border rounded-md">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/40">
            <th className="text-left px-3 py-2">{addressColumnLabel}</th>
            <th className="text-right px-3 py-2">Amount XLM</th>
            {showPercentColumn && <th className="text-right px-3 py-2">{percentColumnLabel}</th>}
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
