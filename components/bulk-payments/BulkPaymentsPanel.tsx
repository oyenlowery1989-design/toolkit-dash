"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Asset, StrKey, Keypair } from "stellar-sdk";
import { useAssetGroups } from "@/hooks/use-asset-groups";
import { useActiveWallet } from "@/hooks/use-active-wallet";
import { WalletSelect } from "@/components/ui/wallet-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAutoSaveSigningKey } from "@/hooks/use-auto-save-signing-key";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertTriangle,
  BookMarked,
  CheckCircle2,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  Save,
  Send,
  Trash2,
  Users,
  Wallet,
  X,
  XCircle,
} from "lucide-react";
import {
  useSettings,
  type Network,
} from "@/lib/settings";
import { getErrorMessage } from "@/lib/stellar-helpers";
import { ShortAddress } from "@/components/asset-lookup";
import { downloadCSV } from "@/lib/csv-export";
import { fetchAllHolders } from "@/lib/asset-lookup/fetchers";
import { estimateCost } from "@/lib/bulk-payments/builder";
import { runBulkPayments } from "@/lib/bulk-payments/runner";
import type { BatchResult, AssetSource } from "@/lib/bulk-payments/types";
import { useBulkRecipients } from "@/hooks/use-bulk-recipients";
import { useBulkRunHistory } from "@/hooks/use-bulk-run-history";
import { useHorizonServer } from "@/hooks/use-horizon-server";
import { formatXlm, parseAddresses as parseValidAddresses, shortAddr } from "@/lib/format";
import { toast } from "sonner";
import { notifyIfHidden } from "@/lib/notifications";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MEMO_MAX_BYTES = 28;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function byteLength(str: string): number {
  return new TextEncoder().encode(str).length;
}

/**
 * Parse asset pairs from free-form text.
 * Accepts bare `CODE:ISSUER` or any URL/string containing that pattern
 * (e.g. Lobstr trade URLs: https://lobstr.co/trade/GSF:GAD23...).
 * Silently skips lines that don't contain a valid pair.
 */
function parseAssetPairs(
  text: string,
): { assetCode: string; issuer: string }[] {
  const seen = new Set<string>();
  const results: { assetCode: string; issuer: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Match CODE:ISSUER anywhere in the line (handles raw pairs and URLs)
    const match = trimmed.match(/([A-Za-z0-9]{1,12}):([A-Z2-7]{56})/);
    if (!match) continue;
    const assetCode = match[1]; // preserve original case — Stellar asset codes are case-sensitive
    const issuer = match[2];
    if (!StrKey.isValidEd25519PublicKey(issuer)) continue;
    const key = `${assetCode.toUpperCase()}:${issuer}`; // uppercase only for dedup
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ assetCode, issuer });
  }
  return results;
}

function explorerTxUrl(network: Network, hash: string): string {
  const base =
    network === "public"
      ? "https://stellar.expert/explorer/public/tx"
      : "https://stellar.expert/explorer/testnet/tx";
  return `${base}/${hash}`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function BatchRow({
  result,
  network,
}: {
  result: BatchResult;
  network: Network;
}) {
  return (
    <tr className="border-b last:border-0 text-xs">
      <td className="px-3 py-2 tabular-nums text-muted-foreground">
        #{result.batchIndex + 1}
      </td>
      <td className="px-3 py-2 tabular-nums">{result.count}</td>
      <td className="px-3 py-2">
        {result.status === "pending" && (
          <span className="text-muted-foreground">Pending</span>
        )}
        {result.status === "sending" && (
          <span className="flex items-center gap-1 text-blue-500">
            <Loader2 className="h-3 w-3 animate-spin" /> Sending…
          </span>
        )}
        {result.status === "success" && (
          <span className="flex items-center gap-1 text-green-500">
            <CheckCircle2 className="h-3 w-3" /> Sent
          </span>
        )}
        {result.status === "failed" && (
          <span className="flex items-center gap-1 text-destructive">
            <XCircle className="h-3 w-3" /> Failed
          </span>
        )}
      </td>
      <td className="px-3 py-2">
        {result.txHash ? (
          <a
            href={explorerTxUrl(network, result.txHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline font-mono"
          >
            {result.txHash.slice(0, 10)}…
            <ExternalLink className="h-3 w-3" />
          </a>
        ) : result.error ? (
          <span className="text-destructive" title={result.error}>
            {result.error.length > 60
              ? result.error.slice(0, 60) + "…"
              : result.error}
          </span>
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

type Phase = "configure" | "preview" | "sending" | "done";

export function BulkPaymentsPanel() {
  const searchParams = useSearchParams();
  const urlAssets = searchParams.get("assets");

  const { activeWallet } = useActiveWallet();

  const { autoSave: autoSaveSigningKey } = useAutoSaveSigningKey();

  // --- Form state ---
  const [memo, setMemo] = useState("");
  const [secretKey, setSecretKey] = useState("");

  const effectiveSecretKey = activeWallet?.secretKey ?? secretKey;
  const [batchSize, setBatchSize] = useState(100);
  const [feeMultiplier, setFeeMultiplier] = useState(1);
  const [showSecret, setShowSecret] = useState(false);
  const [sourceTab, setSourceTab] = useState<"manual" | "assets" | "group">(
    urlAssets ? "assets" : "manual",
  );

  // Payment asset/amount
  const [amount, setAmount] = useState("0.0000001");
  const [assetType, setAssetType] = useState<"xlm" | "custom">("xlm");
  const [customAssetCode, setCustomAssetCode] = useState("");
  const [customAssetIssuer, setCustomAssetIssuer] = useState("");

  // Manual source
  const [manualText, setManualText] = useState("");

  // Asset source
  const [assetsText, setAssetsText] = useState(urlAssets ?? "");
  const [assetSources, setAssetSources] = useState<AssetSource[]>([]);
  const [fetchingHolders, setFetchingHolders] = useState(false);
  const [fetchProgress, setFetchProgress] = useState<string | null>(null);

  // Exclude list
  const [excludeText, setExcludeText] = useState("");
  const [showExclude, setShowExclude] = useState(false);

  // Min balance filter (asset holders tab)
  const [minBalance, setMinBalance] = useState(0);

  // Group tab
  const [selectedGroupId, setSelectedGroupId] = useState<string>("");

  // Built recipient list
  const [recipients, setRecipients] = useState<string[]>([]);

  // Send state
  const [phase, setPhase] = useState<Phase>("configure");
  const [batchResults, setBatchResults] = useState<BatchResult[]>([]);
  const [batches, setBatches] = useState<string[][]>([]);
  const [error, setError] = useState<string | null>(null);

  // Balance preflight
  const [balanceXlm, setBalanceXlm] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const { addRun } = useBulkRunHistory();
  const { settings } = useSettings();
  const network = settings.network;
  const { server: horizonServer, url: horizonUrl } = useHorizonServer(network);

  // Asset groups (for "From Group" tab)
  const { groups } = useAssetGroups();

  // Saved recipient lists
  const { save: saveList, remove: removeList, forNetwork } = useBulkRecipients();
  const [saveName, setSaveName] = useState("");
  const savedLists = forNetwork(network);

  const handleSaveList = useCallback(() => {
    const addresses =
      sourceTab === "manual" ? parseValidAddresses(manualText) : recipients.length > 0 ? recipients : [];
    if (addresses.length === 0) {
      setError("Nothing to save — add addresses first.");
      return;
    }
    const name = saveName.trim() || `List ${new Date().toLocaleDateString()}`;
    const assets = sourceTab === "assets" && assetsText.trim() ? assetsText.trim() : undefined;
    saveList(name, network, addresses, assets);
    setSaveName("");
  }, [saveName, sourceTab, manualText, assetsText, recipients, network, saveList]);

  const handleLoadList = useCallback(
    (id: string) => {
      const list = savedLists.find((l) => l.id === id);
      if (!list) return;
      if (list.assetsText) {
        setAssetsText(list.assetsText);
        setRecipients(list.addresses);
        setSourceTab("assets");
      } else {
        setManualText(list.addresses.join("\n"));
        setSourceTab("manual");
      }
    },
    [savedLists],
  );

  function getPaymentAsset(): Asset {
    if (assetType === "custom") {
      const code = customAssetCode.trim();
      const issuer = customAssetIssuer.trim();
      if (code && StrKey.isValidEd25519PublicKey(issuer)) {
        return new Asset(code, issuer);
      }
    }
    return Asset.native();
  }

  const paymentAsset = getPaymentAsset();
  const isNative = paymentAsset.isNative();
  const memoBytes = byteLength(memo);
  const parsedAmount = parseFloat(amount) || 0;
  const cost = estimateCost(
    recipients.length,
    batchSize,
    feeMultiplier,
    isNative ? parsedAmount : 0,
  );

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  function getExcludeSet(): Set<string> {
    return new Set(parseValidAddresses(excludeText));
  }

  function validateForm(): string | null {
    if (memoBytes > MEMO_MAX_BYTES)
      return `Memo exceeds ${MEMO_MAX_BYTES} bytes (currently ${memoBytes}).`;
    if (!effectiveSecretKey.trim()) return "Signing secret key is required.";
    if (!effectiveSecretKey.trim().startsWith("S") || effectiveSecretKey.trim().length !== 56)
      return "Secret key must start with S and be 56 characters.";
    if (!amount.trim() || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0)
      return "Payment amount must be a positive number.";
    if (assetType === "custom") {
      const code = customAssetCode.trim();
      const issuer = customAssetIssuer.trim();
      if (!code) return "Custom asset code is required.";
      if (!StrKey.isValidEd25519PublicKey(issuer)) return "Custom asset issuer is not a valid address.";
    }
    return null;
  }

  function buildManualRecipients(): string | null {
    const addresses = parseValidAddresses(manualText);
    if (addresses.length === 0) return "Add at least one recipient address.";
    const invalid = addresses.find(
      (a) => !StrKey.isValidEd25519PublicKey(a),
    );
    if (invalid) return `Invalid address: ${invalid}`;

    // Exclude sender + exclude list
    const senderPub = getSenderPublicKey();
    const excludeSet = getExcludeSet();
    if (senderPub) excludeSet.add(senderPub);
    const filtered = addresses.filter((a) => !excludeSet.has(a));

    setRecipients(filtered);
    return null;
  }

  function getSenderPublicKey(): string | null {
    try {
      return Keypair.fromSecret(effectiveSecretKey.trim()).publicKey();
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Fetch holders from assets
  // ---------------------------------------------------------------------------

  async function handleFetchHolders() {
    const pairs = parseAssetPairs(assetsText);
    if (pairs.length === 0) {
      setError(
        "No valid assets found. Use CODE:ISSUER format or paste a Lobstr trade URL.",
      );
      return;
    }

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    setFetchingHolders(true);
    setFetchProgress(null);
    setError(null);
    setAssetSources([]);

    const server = horizonServer;

    const sources: AssetSource[] = pairs.map((p) => ({
      assetCode: p.assetCode,
      issuer: p.issuer,
    }));
    setAssetSources([...sources]);

    const allAddresses = new Set<string>();
    const senderPub = getSenderPublicKey();

    for (let i = 0; i < pairs.length; i++) {
      if (signal.aborted) break;
      const { assetCode, issuer } = pairs[i];
      setFetchProgress(
        `Fetching holders for ${assetCode} (${i + 1}/${pairs.length})…`,
      );
      try {
        const asset = new Asset(assetCode, issuer);
        const holders = await fetchAllHolders(
          server,
          asset,
          assetCode,
          issuer,
          signal,
          (count) =>
            setFetchProgress(
              `${assetCode}: ${count.toLocaleString()} holders fetched…`,
            ),
        );
        const excludeSet = getExcludeSet();
        if (senderPub) excludeSet.add(senderPub);
        const valid = holders.filter(
          (h) =>
            parseFloat(h.balance) >= Math.max(minBalance, 0.0000001) &&
            !excludeSet.has(h.id),
        );
        valid.forEach((h) => allAddresses.add(h.id));
        sources[i] = { ...sources[i], holderCount: valid.length };
        setAssetSources([...sources]);
      } catch (err) {
        if (signal.aborted) break;
        sources[i] = { ...sources[i], error: getErrorMessage(err) };
        setAssetSources([...sources]);
      }
    }

    if (!signal.aborted) {
      setRecipients([...allAddresses]);
      setFetchProgress(`Done — ${allAddresses.size.toLocaleString()} unique recipients.`);
    }

    setFetchingHolders(false);
  }

  // ---------------------------------------------------------------------------
  // Preview step
  // ---------------------------------------------------------------------------

  async function handlePreview() {
    const formErr = validateForm();
    if (formErr) {
      setError(formErr);
      return;
    }
    setError(null);

    if (sourceTab === "manual") {
      const recipErr = buildManualRecipients();
      if (recipErr) {
        setError(recipErr);
        return;
      }
    } else if (sourceTab === "group") {
      const grp = groups.find((g) => g.id === selectedGroupId);
      if (!grp || grp.members.length === 0) {
        setError("Select a group with at least one member.");
        return;
      }
      const senderPub = getSenderPublicKey();
      const excludeSet = getExcludeSet();
      if (senderPub) excludeSet.add(senderPub);
      const addrs = grp.members
        .map((m) => m.address)
        .filter((a) => !excludeSet.has(a));
      setRecipients(addrs);
    } else {
      if (recipients.length === 0) {
        setError("Fetch holders first, or switch to the Manual tab.");
        return;
      }
    }

    setPhase("preview");

    // Load sender balance for the preflight warning
    try {
      const senderPub = getSenderPublicKey();
      if (senderPub) {
        setBalanceLoading(true);
        const account = await horizonServer.loadAccount(senderPub);
        const native = account.balances.find((b) => b.asset_type === "native");
        setBalanceXlm(native ? parseFloat(native.balance) : 0);
      }
    } catch {
      setBalanceXlm(null);
    } finally {
      setBalanceLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Send
  // ---------------------------------------------------------------------------

  async function handleSend() {
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    // Split recipients into batches upfront so retry can reference them
    const newBatches: string[][] = [];
    for (let i = 0; i < recipients.length; i += batchSize) {
      newBatches.push(recipients.slice(i, i + batchSize));
    }
    setBatches(newBatches);

    const initial: BatchResult[] = newBatches.map((b, i) => ({
      batchIndex: i,
      count: b.length,
      status: "pending",
    }));
    setBatchResults(initial);
    setPhase("sending");
    setError(null);

    let finalResults = initial;

    try {
      await runBulkPayments({
        horizonUrl,
        network,
        secretKey: effectiveSecretKey.trim(),
        recipients,
        memo: memo.trim(),
        batchSize,
        feeMultiplier,
        amount: amount.trim(),
        asset: getPaymentAsset(),
        signal: abortRef.current.signal,
        onBatchUpdate: (result) => {
          setBatchResults((prev) => {
            const next = [...prev];
            next[result.batchIndex] = result;
            finalResults = next;
            return next;
          });
        },
      });
    } catch (err) {
      if (!abortRef.current.signal.aborted) {
        setError(getErrorMessage(err));
      }
    }

    // Auto-save manual signing key if not already in a group
    if (!activeWallet) {
      try {
        const { Keypair } = await import("stellar-sdk");
        const pub = Keypair.fromSecret(effectiveSecretKey.trim()).publicKey();
        autoSaveSigningKey(pub);
      } catch { /* invalid key — skip */ }
    }

    setPhase("done");

    // Save run summary
    const successCount = finalResults.filter((r) => r.status === "success").reduce((s, r) => s + r.count, 0);
    const failedCount = finalResults.filter((r) => r.status === "failed").reduce((s, r) => s + r.count, 0);
    addRun({ network, memo: memo.trim(), recipientCount: recipients.length, successCount, failedCount });

    if (failedCount > 0) {
      toast.error(`Batch failed \u2014 ${failedCount} payments failed`);
    } else {
      toast.success("Batch sent successfully");
    }
    notifyIfHidden("Bulk Payments Complete", `${recipients.length} payments sent`);
  }

  function handleAbort() {
    abortRef.current?.abort();
  }

  async function handleRetryFailed() {
    const failedIndices = batchResults
      .filter((r) => r.status === "failed")
      .map((r) => r.batchIndex);
    if (failedIndices.length === 0) return;

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    // Mark failed batches as pending again
    setBatchResults((prev) =>
      prev.map((r) =>
        failedIndices.includes(r.batchIndex) ? { ...r, status: "pending", error: undefined } : r,
      ),
    );
    setPhase("sending");
    setError(null);

    const failedRecipients = failedIndices.flatMap((i) => batches[i] ?? []);

    let finalResults = batchResults;
    try {
      await runBulkPayments({
        horizonUrl,
        network,
        secretKey: effectiveSecretKey.trim(),
        recipients: failedRecipients,
        memo: memo.trim(),
        batchSize,
        feeMultiplier,
        amount: amount.trim(),
        asset: getPaymentAsset(),
        signal: abortRef.current.signal,
        onBatchUpdate: (result) => {
          // Map back to original batch indices
          const originalIndex = failedIndices[result.batchIndex];
          const mapped = { ...result, batchIndex: originalIndex };
          setBatchResults((prev) => {
            const next = [...prev];
            next[originalIndex] = mapped;
            finalResults = next;
            return next;
          });
        },
      });
    } catch (err) {
      if (!abortRef.current.signal.aborted) setError(getErrorMessage(err));
    }
    setPhase("done");

    const successCount = finalResults.filter((r) => r.status === "success").reduce((s, r) => s + r.count, 0);
    const failedCount = finalResults.filter((r) => r.status === "failed").reduce((s, r) => s + r.count, 0);
    addRun({ network, memo: memo.trim(), recipientCount: recipients.length, successCount, failedCount });
  }

  function handleReset() {
    abortRef.current?.abort();
    setPhase("configure");
    setBatchResults([]);
    setBatches([]);
    setRecipients([]);
    setAssetSources([]);
    setFetchProgress(null);
    setBalanceXlm(null);
    setError(null);
  }

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------

  function handleExport() {
    const rows: string[][] = [];
    for (const result of batchResults) {
      rows.push([
        String(result.batchIndex + 1),
        String(result.count),
        result.status,
        result.txHash ?? "",
        result.error ?? "",
      ]);
    }
    downloadCSV("bulk-payments-results.csv", [
      "Batch",
      "Recipients",
      "Status",
      "Tx Hash",
      "Error",
    ], rows);
  }

  // ---------------------------------------------------------------------------
  // Derived stats for done phase
  // ---------------------------------------------------------------------------

  const successCount = batchResults.filter(
    (r) => r.status === "success",
  ).reduce((sum, r) => sum + r.count, 0);
  const failedCount = batchResults.filter(
    (r) => r.status === "failed",
  ).reduce((sum, r) => sum + r.count, 0);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (phase === "preview") {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Review before sending</CardTitle>
            <CardDescription>
              Confirm the details below. This will submit real transactions on{" "}
              <strong>{network}</strong>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 text-sm">
              <div className="rounded-md bg-muted/50 p-3 space-y-1">
                <p className="text-xs text-muted-foreground">Recipients</p>
                <p className="text-2xl font-bold font-mono">
                  {recipients.length.toLocaleString()}
                </p>
              </div>
              <div className="rounded-md bg-muted/50 p-3 space-y-1">
                <p className="text-xs text-muted-foreground">Batches ({batchSize} ops each)</p>
                <p className="text-2xl font-bold font-mono">{cost.batches}</p>
              </div>
              <div className="rounded-md bg-muted/50 p-3 space-y-1">
                <p className="text-xs text-muted-foreground">Transaction fees</p>
                <p className="text-2xl font-bold font-mono">
                  {formatXlm(cost.feesXlm)}{" "}
                  <span className="text-sm font-normal text-muted-foreground">
                    XLM
                  </span>
                </p>
              </div>
              <div className="rounded-md bg-muted/50 p-3 space-y-1">
                <p className="text-xs text-muted-foreground">Total cost (est.)</p>
                <p className="text-2xl font-bold font-mono">
                  {formatXlm(cost.totalXlm)}{" "}
                  <span className="text-sm font-normal text-muted-foreground">
                    XLM
                  </span>
                </p>
              </div>
            </div>

            <div className="rounded-md border border-border p-3 text-sm space-y-1">
              <p className="text-xs text-muted-foreground">Payment</p>
              <p className="font-mono font-semibold">
                {amount} {isNative ? "XLM" : `${customAssetCode.trim()} (${customAssetIssuer.trim().slice(0, 4)}…${customAssetIssuer.trim().slice(-4)})`}
              </p>
            </div>

            {recipients.length > 0 && (
              <div className="rounded-md border border-border p-3 text-sm space-y-2">
                <p className="text-xs text-muted-foreground">First recipients (sample)</p>
                <div className="flex flex-wrap gap-1.5">
                  {recipients.slice(0, 8).map((addr) => (
                    <ShortAddress key={addr} address={addr} network={network} />
                  ))}
                  {recipients.length > 8 && (
                    <span className="text-xs text-muted-foreground self-center">
                      +{(recipients.length - 8).toLocaleString()} more
                    </span>
                  )}
                </div>
              </div>
            )}

            {memo.trim() && (
              <div className="rounded-md border border-border p-3 text-sm">
                <p className="text-xs text-muted-foreground mb-1">Memo</p>
                <p className="font-mono">{memo.trim()}</p>
              </div>
            )}

            {balanceLoading && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Checking balance…
              </p>
            )}
            {!balanceLoading && balanceXlm !== null && balanceXlm < cost.totalXlm && (
              <div className="rounded-md bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  Insufficient balance. Sender has{" "}
                  <strong>{balanceXlm.toLocaleString(undefined, { maximumFractionDigits: 4 })} XLM</strong>{" "}
                  but estimated cost is{" "}
                  <strong>{cost.totalXlm.toLocaleString(undefined, { maximumFractionDigits: 4 })} XLM</strong>.
                </span>
              </div>
            )}
            <div className="rounded-md bg-yellow-500/10 border border-yellow-500/30 p-3 text-sm text-yellow-700 dark:text-yellow-400 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                Recipients must have existing accounts. Payments to
                non-existent accounts will fail — those batches will be marked
                failed and skipped.
              </span>
            </div>
          </CardContent>
          <CardFooter className="flex gap-2">
            <Button onClick={handleSend}>
              <Send className="mr-2 h-4 w-4" />
              Send Now
            </Button>
            <Button variant="outline" onClick={() => setPhase("configure")}>
              Back
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  if (phase === "sending" || phase === "done") {
    const sent = batchResults.filter((r) => r.status === "success").length;
    const failed = batchResults.filter((r) => r.status === "failed").length;
    const total = batchResults.length;

    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>
                {phase === "sending" ? "Sending…" : "Complete"}
              </span>
              {phase === "done" && (
                <div className="flex items-center gap-2 text-sm font-normal">
                  <span className="text-green-500">
                    {successCount.toLocaleString()} sent
                  </span>
                  {failedCount > 0 && (
                    <span className="text-destructive">
                      {failedCount.toLocaleString()} failed
                    </span>
                  )}
                </div>
              )}
            </CardTitle>
            {phase === "sending" && (
              <CardDescription>
                Batch {Math.min(sent + failed + 1, total)} of {total}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto border rounded-md">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="text-left px-3 py-2">Batch</th>
                    <th className="text-left px-3 py-2">Recipients</th>
                    <th className="text-left px-3 py-2">Status</th>
                    <th className="text-left px-3 py-2">Tx / Error</th>
                  </tr>
                </thead>
                <tbody>
                  {batchResults.map((r) => (
                    <BatchRow key={r.batchIndex} result={r} network={network} />
                  ))}
                </tbody>
              </table>
            </div>

            {error && (
              <p className="mt-3 text-sm text-destructive flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                {error}
              </p>
            )}
          </CardContent>
          <CardFooter className="flex gap-2">
            {phase === "sending" && (
              <Button variant="outline" onClick={handleAbort}>
                <X className="mr-2 h-4 w-4" />
                Abort
              </Button>
            )}
            {phase === "done" && (
              <>
                {batchResults.some((r) => r.status === "failed") && (
                  <Button variant="outline" onClick={handleRetryFailed}>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Retry Failed
                  </Button>
                )}
                <Button variant="outline" onClick={handleExport}>
                  <Download className="mr-2 h-4 w-4" />
                  Export CSV
                </Button>
                <Button variant="outline" onClick={handleReset}>
                  New Send
                </Button>
              </>
            )}
          </CardFooter>
        </Card>
      </div>
    );
  }

  // Configure phase
  return (
    <div className="space-y-6">
      {/* Memo + key */}
      <Card>
        <CardHeader>
          <CardTitle>Message &amp; Signing</CardTitle>
          <CardDescription>
            The memo is attached to every transaction and visible on explorers.
            The secret key never leaves your browser.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="memo">Memo</Label>
              <span
                className={`text-xs ${
                  memoBytes > MEMO_MAX_BYTES
                    ? "text-destructive"
                    : "text-muted-foreground"
                }`}
              >
                {memoBytes}/{MEMO_MAX_BYTES} bytes
              </span>
            </div>
            <Input
              id="memo"
              placeholder="Your message here…"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="amount">Amount per Recipient</Label>
              <Input
                id="amount"
                type="number"
                min="0.0000001"
                step="0.0000001"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="font-mono"
                placeholder="0.0000001"
              />
            </div>
            <div className="space-y-2">
              <Label>Asset</Label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setAssetType("xlm")}
                  className={`flex-1 rounded-md border px-3 py-1.5 text-sm transition-colors ${assetType === "xlm" ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted/50"}`}
                >
                  XLM
                </button>
                <button
                  type="button"
                  onClick={() => setAssetType("custom")}
                  className={`flex-1 rounded-md border px-3 py-1.5 text-sm transition-colors ${assetType === "custom" ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted/50"}`}
                >
                  Custom
                </button>
              </div>
              {assetType === "custom" && (
                <div className="flex gap-2 pt-1">
                  <Input
                    placeholder="CODE"
                    value={customAssetCode}
                    onChange={(e) => setCustomAssetCode(e.target.value)}
                    className="w-24 font-mono text-xs"
                  />
                  <Input
                    placeholder="ISSUER (G…)"
                    value={customAssetIssuer}
                    onChange={(e) => setCustomAssetIssuer(e.target.value.trim())}
                    className="font-mono text-xs"
                  />
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto_auto]">
            <div className="space-y-2">
              {activeWallet ? (
                <>
                  <Label htmlFor="secret-key">Signing Secret Key</Label>
                  <div className="flex items-center gap-2 rounded-md border border-green-500/40 bg-green-500/5 px-3 py-2 text-sm">
                    <Wallet className="h-4 w-4 shrink-0 text-green-500" />
                    <span className="flex-1 truncate font-medium">{activeWallet.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {shortAddr(activeWallet.publicKey)}
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="secret-key">Signing Secret Key</Label>
                    <WalletSelect
                      currentValue={secretKey}
                      onPick={(w) => setSecretKey(w.secretKey)}
                    />
                  </div>
                  <div className="relative">
                    <Input
                      id="secret-key"
                      type={showSecret ? "text" : "password"}
                      placeholder="S…"
                      value={secretKey}
                      onChange={(e) => setSecretKey(e.target.value)}
                      className="font-mono text-xs pr-10"
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowSecret((v) => !v)}
                      aria-label="Toggle secret key visibility"
                    >
                      {showSecret ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="batch-size">Ops / Tx</Label>
              <Input
                id="batch-size"
                type="number"
                min={1}
                max={100}
                value={batchSize}
                onChange={(e) => {
                  const v = Math.min(100, Math.max(1, parseInt(e.target.value) || 1));
                  setBatchSize(v);
                }}
                className="w-20"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fee-mult" title="Multiply the base fee (100 stroops) for priority">Fee ×</Label>
              <Input
                id="fee-mult"
                type="number"
                min={1}
                max={100}
                value={feeMultiplier}
                onChange={(e) => {
                  const v = Math.min(100, Math.max(1, parseInt(e.target.value) || 1));
                  setFeeMultiplier(v);
                }}
                className="w-20"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Recipients */}
      <Card>
        <CardHeader>
          <CardTitle>Recipients</CardTitle>
          <CardDescription>
            Paste addresses manually or fetch holders of one or more assets.
            Both sources are deduplicated and merged. Your own address is always
            excluded.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs
            value={sourceTab}
            onValueChange={(v) => setSourceTab(v as "manual" | "assets" | "group")}
          >
            <TabsList className="mb-4">
              <TabsTrigger value="manual">Manual List</TabsTrigger>
              <TabsTrigger value="assets">Asset Holders</TabsTrigger>
              <TabsTrigger value="group">From Group</TabsTrigger>
            </TabsList>

            <TabsContent value="manual" className="space-y-2">
              <Label htmlFor="manual-addresses">
                Addresses (one per line)
              </Label>
              <textarea
                id="manual-addresses"
                className="w-full min-h-40 rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono"
                placeholder={"G...\nG..."}
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {parseValidAddresses(manualText).length.toLocaleString()} unique addresses
              </p>
            </TabsContent>

            <TabsContent value="assets" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="assets-input">
                  Assets (CODE:ISSUER, one per line)
                </Label>
                <textarea
                  id="assets-input"
                  className="w-full min-h-32 rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono"
                  placeholder={"USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN\nYOURC:GISSUER…"}
                  value={assetsText}
                  onChange={(e) => setAssetsText(e.target.value)}
                />
              </div>

              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <Label htmlFor="min-balance" className="text-xs whitespace-nowrap">Min balance</Label>
                  <Input
                    id="min-balance"
                    type="number"
                    min="0"
                    step="1"
                    value={minBalance}
                    onChange={(e) => setMinBalance(parseFloat(e.target.value) || 0)}
                    className="w-24 h-8 text-sm font-mono"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleFetchHolders}
                  disabled={fetchingHolders}
                >
                  {fetchingHolders ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Users className="mr-2 h-4 w-4" />
                  )}
                  Fetch Holders
                </Button>
                {fetchingHolders && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => abortRef.current?.abort()}
                  >
                    <X className="mr-1 h-3.5 w-3.5" />
                    Cancel
                  </Button>
                )}
              </div>

              {fetchProgress && (
                <p className="text-xs text-muted-foreground">{fetchProgress}</p>
              )}

              {assetSources.length > 0 && (
                <div className="overflow-x-auto border rounded-md">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40">
                        <th className="text-left px-3 py-2">Asset</th>
                        <th className="text-left px-3 py-2">Issuer</th>
                        <th className="text-right px-3 py-2">Holders</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assetSources.map((src) => (
                        <tr
                          key={`${src.assetCode}:${src.issuer}`}
                          className="border-b last:border-0"
                        >
                          <td className="px-3 py-2 font-mono font-semibold text-xs">
                            {src.assetCode}
                          </td>
                          <td className="px-3 py-2 text-xs">
                            <ShortAddress
                              address={src.issuer}
                              network={network}
                            />
                          </td>
                          <td className="px-3 py-2 text-right text-xs">
                            {src.error ? (
                              <span className="text-destructive">
                                {src.error}
                              </span>
                            ) : src.holderCount !== undefined ? (
                              src.holderCount.toLocaleString()
                            ) : (
                              <Loader2 className="h-3 w-3 animate-spin inline-block" />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {recipients.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  <strong>{recipients.length.toLocaleString()}</strong> unique
                  recipients ready.
                </p>
              )}
            </TabsContent>

            <TabsContent value="group" className="space-y-4">
              {groups.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No asset groups saved yet. Create groups in the Asset Lookup or Asset Sales modules.
                </p>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="group-select">Select Group</Label>
                    <Select value={selectedGroupId} onValueChange={setSelectedGroupId}>
                      <SelectTrigger id="group-select">
                        <SelectValue placeholder="— choose a group —" />
                      </SelectTrigger>
                      <SelectContent>
                        {groups.map((g) => (
                          <SelectItem key={g.id} value={g.id}>
                            {g.name} ({g.members.length} members)
                            {g.assetCode ? ` · ${g.assetCode}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {selectedGroupId && (() => {
                    const grp = groups.find((g) => g.id === selectedGroupId);
                    if (!grp) return null;
                    return (
                      <div className="rounded-md border border-border p-3 space-y-2">
                        <p className="text-xs text-muted-foreground">Members ({grp.members.length})</p>
                        <div className="flex flex-wrap gap-1.5">
                          {grp.members.slice(0, 10).map((m) => (
                            <ShortAddress key={m.id} address={m.address} network={network} />
                          ))}
                          {grp.members.length > 10 && (
                            <span className="text-xs text-muted-foreground self-center">
                              +{grp.members.length - 10} more
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </>
              )}
            </TabsContent>
          </Tabs>

          {/* Exclude list */}
          <div className="mt-4 pt-3 border-t border-border">
            <button
              type="button"
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setShowExclude((v) => !v)}
            >
              <X className="h-3 w-3" />
              {showExclude ? "Hide" : "Show"} exclude list
              {excludeText.trim() && !showExclude && (
                <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-xs">
                  {parseValidAddresses(excludeText).length}
                </span>
              )}
            </button>
            {showExclude && (
              <div className="mt-2 space-y-1">
                <textarea
                  className="w-full min-h-24 rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono"
                  placeholder={"Addresses to exclude (one per line)\nG..."}
                  value={excludeText}
                  onChange={(e) => setExcludeText(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {parseValidAddresses(excludeText).length.toLocaleString()} addresses excluded
                </p>
              </div>
            )}
          </div>

          {/* Save / load recipient lists */}
          <div className="mt-4 pt-4 border-t border-border space-y-3">
            <div className="flex items-center gap-2">
              <BookMarked className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-sm font-medium">Saved Lists</span>
              <span className="text-xs text-muted-foreground">
                ({network})
              </span>
            </div>

            <div className="flex gap-2">
              <Input
                placeholder="List name…"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                className="h-8 text-sm"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleSaveList}
              >
                <Save className="mr-1.5 h-3.5 w-3.5" />
                Save
              </Button>
            </div>

            {savedLists.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No saved lists for {network} yet.
              </p>
            ) : (
              <div className="space-y-1">
                {savedLists.map((list) => (
                  <div
                    key={list.id}
                    className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-1.5 text-sm"
                  >
                    <button
                      className="flex-1 text-left hover:text-primary transition-colors truncate"
                      onClick={() => handleLoadList(list.id)}
                      title="Load into manual list"
                    >
                      <span className="font-medium">{list.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {list.addresses.length.toLocaleString()} addresses
                      </span>
                    </button>
                    <button
                      className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                      onClick={() => removeList(list.id)}
                      aria-label="Delete list"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {error && (
        <p className="text-sm text-destructive flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <Button onClick={handlePreview} size="lg">
          Preview &amp; Confirm
        </Button>
      </div>
    </div>
  );
}
