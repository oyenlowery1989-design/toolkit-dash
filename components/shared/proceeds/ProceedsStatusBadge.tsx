"use client";

import { Loader2, CheckCircle2, XCircle } from "lucide-react";

export type ProceedsScanStatus = "pending" | "inferring" | "scanning" | "done" | "error";

export function ProceedsStatusBadge({ status }: { status: ProceedsScanStatus }) {
  if (status === "pending")
    return <span className="text-xs text-muted-foreground">Pending</span>;
  if (status === "inferring")
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Inferring distrib…
      </span>
    );
  if (status === "scanning")
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Scanning trades…
      </span>
    );
  if (status === "done")
    return (
      <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
        <CheckCircle2 className="h-3 w-3" /> Done
      </span>
    );
  return (
    <span className="flex items-center gap-1 text-xs text-destructive">
      <XCircle className="h-3 w-3" /> Error
    </span>
  );
}
