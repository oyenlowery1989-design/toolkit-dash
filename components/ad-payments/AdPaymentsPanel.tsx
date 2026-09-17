"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSettings } from "@/lib/settings";
import { authHeaders, waitForAuth } from "@/lib/db-client";
import type { PaymentReviewItem } from "@/lib/saved-analyses/payment-review";
import { formatXlm } from "@/lib/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function AdPaymentsPanel() {
  const { settings } = useSettings();
  const [review, setReview] = useState<{ items: PaymentReviewItem[]; uniquePaidXlm: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    waitForAuth().then(() => fetch(`/api/db/ad-payments?recipient=${encodeURIComponent(settings.adPaymentRecipient)}`, { headers: authHeaders() }))
      .then(async (response) => { if (!response.ok) throw new Error(`GET ad payments failed: ${response.status}`); return response.json() as Promise<{ items: PaymentReviewItem[]; uniquePaidXlm: number }>; })
      .then((data) => { if (active) { setReview(data); setError(null); } })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, [settings.adPaymentRecipient]);
  const items = (review?.items ?? []).filter((item) => item.classification.status !== "compliant" || item.sharedEvidence);

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
        {!review && !error ? <p className="text-sm text-muted-foreground">Loading payment review…</p> : error ? <p role="alert" className="text-sm text-destructive">Could not load payment review: {error}</p> : items.length === 0 ? <p className="text-sm text-muted-foreground">No ad payments need review.</p> : items.map((item) => {
          const { classification } = item;
          return <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm">
            <div><p className="font-medium">{item.assetCode} · {item.issuer}</p><p className="text-xs text-muted-foreground">{classification.status} · required {formatXlm(classification.requiredXlm)} XLM · shortfall {formatXlm(classification.shortfallXlm)} XLM{item.sharedEvidence ? " · shared evidence" : ""}</p></div>
            <Link className="text-xs underline" href={`/asset-sales?asset=${encodeURIComponent(item.assetCode)}&issuer=${encodeURIComponent(item.issuer)}&network=${encodeURIComponent(item.network)}`}>Open Asset Sales</Link>
          </div>;
        })}
        {(review?.items.length ?? 0) > 0 && <p className="pt-2 text-xs text-muted-foreground">Unique verified payments: {formatXlm(review!.uniquePaidXlm)} XLM across the latest snapshots.</p>}
      </CardContent>
    </Card>
  </div>;
}
