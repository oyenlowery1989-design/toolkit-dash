// components/asset-creator/steps/Step4Result.tsx
"use client";

import { CheckCircle2, XCircle, SkipForward, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { StepResult } from "@/lib/asset-creator/types";

const STEP_LABELS: Record<string, string> = {
  "fund-accounts": "Fund issuer + distributor accounts",
  "friendbot": "Friendbot account funding (testnet)",
  "set-home-domain": "Set home domain on issuer",
  "trustline": "Distributor establishes trustline",
  "issuance": "Issuer mints supply to distributor",
};

interface Props {
  results: StepResult[];
  groupId?: string;
  network: string;
  onRetry: (failedStepIds: string[]) => void;
  onStartOver: () => void;
}

export function Step4Result({ results, groupId, network, onRetry, onStartOver }: Props) {
  const expertBase = network === "public"
    ? "https://stellar.expert/explorer/public/tx"
    : network === "testnet"
      ? "https://stellar.expert/explorer/testnet/tx"
      : null; // futurenet not supported by Stellar.Expert

  const failed = results.filter((r) => r.status === "failed");
  const allSuccess = results.length > 0 && failed.length === 0;

  const statusIcon = (status: StepResult["status"]) => {
    if (status === "success") return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />;
    if (status === "failed") return <XCircle className="h-4 w-4 text-destructive shrink-0" />;
    if (status === "skipped") return <SkipForward className="h-4 w-4 text-muted-foreground shrink-0" />;
    return null;
  };

  return (
    <div className="space-y-6">
      {allSuccess && (
        <div className="rounded-md bg-green-500/10 border border-green-500/30 p-4 text-green-700 dark:text-green-300 text-sm font-medium">
          ✓ Asset created successfully!
        </div>
      )}

      {/* Per-step rows */}
      <div className="space-y-2">
        {results.map((r, i) => (
          <div key={i} className="flex items-start gap-3 py-2 border-b border-border/50 last:border-0">
            {statusIcon(r.status)}
            <div className="flex-1 min-w-0">
              <p className="text-sm">{STEP_LABELS[r.stepId] ?? r.stepId}</p>
              {r.txHash && expertBase && (
                <a
                  href={`${expertBase}/${r.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-mono text-primary hover:underline flex items-center gap-1 mt-0.5"
                >
                  {r.txHash.slice(0, 8)}…{r.txHash.slice(-8)}
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {r.txHash && !expertBase && (
                <span className="text-xs font-mono text-muted-foreground mt-0.5">{r.txHash.slice(0, 8)}…{r.txHash.slice(-8)}</span>
              )}
              {r.error && <p className="text-xs text-destructive mt-0.5">{r.error}</p>}
            </div>
          </div>
        ))}
      </div>

      {/* Group link + next-step actions */}
      {allSuccess && (
        <div className="flex flex-wrap gap-2">
          {groupId && (
            <a
              href={`/groups?open=${groupId}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="default" className="bg-green-600 hover:bg-green-700 gap-2">
                Open Group → <ExternalLink className="h-4 w-4" />
              </Button>
            </a>
          )}
          <a href="/asset-manager">
            <Button variant="outline" className="gap-2">
              Manage asset (Token Control) →
            </Button>
          </a>
          <a href="/soroban">
            <Button variant="outline" className="gap-2">
              Wrap with Soroban →
            </Button>
          </a>
        </div>
      )}
      {!allSuccess && groupId && (
        <a
          href={`/groups?open=${groupId}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Button variant="default" className="bg-green-600 hover:bg-green-700 gap-2">
            Open Group → <ExternalLink className="h-4 w-4" />
          </Button>
        </a>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        {failed.length > 0 && (
          <Button onClick={() => onRetry(failed.map((r) => r.stepId))}>
            Retry failed steps
          </Button>
        )}
        <Button variant="outline" onClick={onStartOver}>Start over</Button>
      </div>
    </div>
  );
}
