"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ShortAddress } from "@/components/shared/ShortAddress";
import { downloadCSV } from "@/lib/csv-export";
import { useConfirmClick } from "@/hooks/use-confirm-click";
import { Eye, Trash2, Download, ShieldAlert, X, Copy, ClipboardCheck, Trophy } from "lucide-react";
import { toast } from "sonner";
import type { KeyScanHit } from "@/lib/key-scanner/types";

const CLIPBOARD_TTL = 30;

function SecretRevealModal({ hit, onClose }: { hit: KeyScanHit; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
      navigator.clipboard.writeText("").catch(() => {});
    };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleCopy = () => {
    navigator.clipboard
      .writeText(hit.secretKey)
      .then(() => {
        setCopied(true);
        setCountdown(CLIPBOARD_TTL);
        toast.success("Copied to clipboard");
        if (countdownRef.current) clearInterval(countdownRef.current);
        countdownRef.current = setInterval(() => {
          setCountdown((prev) => {
            if (prev === null || prev <= 1) {
              clearInterval(countdownRef.current!);
              countdownRef.current = null;
              navigator.clipboard.writeText("").catch(() => {});
              setCopied(false);
              return null;
            }
            return prev - 1;
          });
        }, 1000);
      })
      .catch(() => toast.error("Clipboard access was denied"));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="relative w-full max-w-lg rounded-xl border border-yellow-500/40 bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border p-4">
          <div className="flex items-center gap-2 text-yellow-500">
            <ShieldAlert className="h-5 w-5" />
            <span className="font-semibold">Secret Key — Live Funded Account</span>
          </div>
          <Button onClick={onClose} variant="ghost" size="icon" className="h-auto w-auto p-1 text-muted-foreground hover:text-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="px-4 pt-4 pb-2 text-xs text-muted-foreground">
          <p className="text-foreground font-medium mb-1">{hit.publicKey}</p>
          <p>This key controls real funds on {hit.network}. Handle it like any other live signing key.</p>
        </div>
        <div className="px-4 py-3">
          <Label className="text-xs text-muted-foreground uppercase">Secret Key</Label>
          <code className="mt-1 block w-full rounded-md border border-border bg-muted p-3 text-xs font-mono break-all leading-relaxed select-all">
            {hit.secretKey}
          </code>
        </div>
        <div className="flex flex-col gap-2 px-4 pb-4">
          <Button onClick={handleCopy} variant={copied ? "outline" : "default"} className="w-full">
            {copied ? (
              <>
                <ClipboardCheck className="mr-2 h-4 w-4 text-green-500" />
                Copied — clipboard clears in {countdown ?? CLIPBOARD_TTL}s
              </>
            ) : (
              <>
                <Copy className="mr-2 h-4 w-4" />
                Copy to Clipboard
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function PurgeButton({ onPurge }: { onPurge: () => void }) {
  const { confirming, onClick } = useConfirmClick(onPurge);
  return (
    <Button
      size="sm"
      variant={confirming ? "destructive" : "ghost"}
      className="text-xs h-7 px-2"
      title={confirming ? "Click again to confirm delete" : "Purge this hit"}
      onClick={onClick}
    >
      {confirming ? "Confirm" : <Trash2 className="h-3.5 w-3.5" />}
    </Button>
  );
}

function ExportButton({ hits }: { hits: KeyScanHit[] }) {
  const doExport = () => {
    downloadCSV(
      `key-scan-hits-${Date.now()}.csv`,
      ["public_key", "secret_key", "network", "xlm_balance", "sequence", "found_at"],
      hits.map((h) => [
        h.publicKey,
        h.secretKey,
        h.network,
        h.xlmBalance != null ? String(h.xlmBalance) : "",
        h.sequence ?? "",
        new Date(h.foundAt).toISOString(),
      ]),
    );
    toast.success(`Exported ${hits.length} hit(s) — file includes live secret keys`);
  };
  const { confirming, onClick } = useConfirmClick(doExport);
  return (
    <Button size="sm" variant={confirming ? "destructive" : "outline"} onClick={onClick}>
      <Download className="mr-1.5 h-3.5 w-3.5" />
      {confirming ? "Confirm — includes secret keys" : "Export CSV"}
    </Button>
  );
}

function HitRow({ hit, onPurge }: { hit: KeyScanHit; onPurge: (id: string) => void }) {
  const [revealing, setRevealing] = useState(false);
  return (
    <div className="flex flex-col md:flex-row md:items-center gap-3 rounded-lg border border-green-500/30 bg-green-500/5 p-4">
      <div className="flex-1 min-w-0 space-y-1">
        <ShortAddress address={hit.publicKey} network={hit.network} />
        <div className="text-xs text-muted-foreground">
          {hit.xlmBalance != null ? `${hit.xlmBalance.toLocaleString()} XLM` : "—"} · {hit.balances.length} asset line(s) · found {new Date(hit.foundAt).toLocaleString()}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button size="sm" variant="outline" className="text-xs h-7 border-yellow-500/40 text-yellow-600 hover:text-yellow-500" onClick={() => setRevealing(true)}>
          <Eye className="mr-1.5 h-3.5 w-3.5" />
          Reveal
        </Button>
        <PurgeButton onPurge={() => onPurge(hit.id)} />
      </div>
      {revealing && <SecretRevealModal hit={hit} onClose={() => setRevealing(false)} />}
    </div>
  );
}

export function HitsTable({ hits, onPurge }: { hits: KeyScanHit[]; onPurge: (id: string) => void }) {
  return (
    <Card className={hits.length > 0 ? "border-green-500/50 bg-green-500/5" : undefined}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Trophy className={`h-5 w-5 ${hits.length > 0 ? "text-green-500" : "text-muted-foreground"}`} />
            Funded Addresses Found ({hits.length})
          </CardTitle>
          {hits.length > 0 && <ExportButton hits={hits} />}
        </div>
        <CardDescription>
          The only bucket that matters — an already-funded account whose keypair the scanner generated. Every row here holds a live, spendable secret key.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {hits.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-sm text-muted-foreground">
            <Trophy className="h-8 w-8 opacity-30" />
            <span>No funded addresses found yet.</span>
          </div>
        ) : (
          <div className="space-y-3">
            {hits.map((hit) => (
              <HitRow key={hit.id} hit={hit} onPurge={onPurge} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
