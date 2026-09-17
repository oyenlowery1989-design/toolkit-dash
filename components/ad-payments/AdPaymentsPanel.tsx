"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useSavedAnalyses } from "@/hooks/use-saved-analyses";
import { useSettings } from "@/lib/settings";
import { summarizeAdPayments } from "@/lib/saved-analyses/payment-review";
import { formatXlm } from "@/lib/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function AdPaymentsPanel() {
  const { analyses, isLoaded, error } = useSavedAnalyses();
  const { settings } = useSettings();
  const review = useMemo(() => summarizeAdPayments(analyses, settings.adPaymentRecipient), [analyses, settings.adPaymentRecipient]);
  const items = review.items.filter((item) => item.classification.status !== "compliant" || item.sharedEvidence);

  return <div className="space-y-6">
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Ad payments</h1>
      <p className="text-sm text-muted-foreground">Review the latest saved result for each asset against your 25% XLM recipient rule.</p>
    </div>
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Needs review ({items.length})</CardTitle>
        <CardDescription>Only verified native XLM payments count. Shared evidence is flagged instead of double-counted.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {!isLoaded ? <p className="text-sm text-muted-foreground">Loading saved analyses…</p> : error ? <p role="alert" className="text-sm text-destructive">Could not load saved analyses: {error}</p> : items.length === 0 ? <p className="text-sm text-muted-foreground">No ad payments need review.</p> : items.map((item) => {
          const { classification } = item;
          return <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm">
            <div><p className="font-medium">{item.assetCode} · {item.issuer}</p><p className="text-xs text-muted-foreground">{classification.status} · required {formatXlm(classification.requiredXlm)} XLM · shortfall {formatXlm(classification.shortfallXlm)} XLM{item.sharedEvidence ? " · shared evidence" : ""}</p></div>
            <Link className="text-xs underline" href={`/asset-sales?asset=${encodeURIComponent(item.assetCode)}&issuer=${encodeURIComponent(item.issuer)}&network=${encodeURIComponent(item.network)}`}>Open Asset Sales</Link>
          </div>;
        })}
        {review.items.length > 0 && <p className="pt-2 text-xs text-muted-foreground">Unique verified payments: {formatXlm(review.uniquePaidXlm)} XLM across the latest snapshots.</p>}
      </CardContent>
    </Card>
  </div>;
}
