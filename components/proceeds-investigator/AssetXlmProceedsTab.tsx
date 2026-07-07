"use client";

import { useRef, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import { StrKey } from "stellar-sdk";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  BookmarkCheck,
  Clock,
  Download,
  ExternalLink,
  Loader2,
  Save,
  Search,
  X,
} from "lucide-react";
import {
  useSettings,
  resolveHorizonUrl,
  type Network,
} from "@/lib/settings";
import { getErrorMessage } from "@/lib/stellar-helpers";
import { downloadCSV } from "@/lib/csv-export";
import { fetchAssetXlmProceeds } from "@/lib/proceeds-investigator/fetchers";
import type {
  AssetProceedsResult,
  ProceedsLedgerEntry,
} from "@/lib/proceeds-investigator/types";
import {
  proceedsHistoryGetSnapshot,
  useProceedsHistory,
} from "./useProceedsHistory";
import { useProceedsPresets } from "./useProceedsPresets";
import { formatXlm, parseAddresses } from "@/lib/format";
import { inferDistribLite } from "@/lib/asset-lookup/fetchers";
import { useSavedSearches } from "@/hooks/use-saved-searches";
import { useSavedAnalyses } from "@/hooks/use-saved-analyses";
import { notifyIfHidden, requestNotificationPermission } from "@/lib/notifications";
import { ProceedsStatsCards } from "@/components/shared/proceeds/ProceedsStatsCards";
import { ProceedsDestinationsTable } from "@/components/shared/proceeds/ProceedsDestinationsTable";
import { SaveToGroupButton } from "@/components/shared/proceeds/SaveToGroupButton";
import { parseAssetPair } from "@/lib/asset-pair";
import { useXlmUsdPrice } from "@/hooks/use-xlm-usd-price";

function exportOutgoingCsv(
  filename: string,
  rows: ProceedsLedgerEntry[],
): void {
  downloadCSV(
    filename,
    [
      "Account",
      "Category",
      "Amount XLM",
      "From",
      "To",
      "Transaction Hash",
      "Created At",
      "Successful",
    ],
    rows.map((row) => [
      row.account,
      row.category,
      String(row.amountXlm),
      row.from ?? "",
      row.to ?? "",
      row.txHash,
      row.createdAt,
      row.successful ? "true" : "false",
    ]),
  );
}

export function AssetXlmProceedsTab() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlAsset = searchParams.get("asset");
  const urlIssuer = searchParams.get("issuer");
  const urlAccount = searchParams.get("account");
  const urlAutorun = searchParams.get("autorun") === "1";

  const {
    history: searchHistory,
    upsert: upsertHistory,
    remove: removeHistory,
  } = useProceedsHistory();
  const { presets, savePreset, removePreset } = useProceedsPresets();
  const { settings, updateSettings } = useSettings();
  const { upsert: upsertSearch } = useSavedSearches();
  const { saveAnalysis } = useSavedAnalyses();
  const [savedId, setSavedId] = useState<string | null>(null);
  const [assetCode, setAssetCode] = useState(
    () => urlAsset ?? proceedsHistoryGetSnapshot()[0]?.assetCode ?? "",
  );
  const [issuer, setIssuer] = useState(
    () => urlIssuer ?? proceedsHistoryGetSnapshot()[0]?.issuer ?? "",
  );
  const [accountsText, setAccountsText] = useState(
    () => urlAccount ?? proceedsHistoryGetSnapshot()[0]?.accountsText ?? "",
  );

  const [loading, setLoading] = useState(false);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AssetProceedsResult | null>(null);
  const { price: xlmUsdPrice, ensure: ensureXlmUsdPrice } = useXlmUsdPrice();
  const [selectedPresetId, setSelectedPresetId] = useState<string>("none");
  const [inferring, setInferring] = useState(false);
  const [inferError, setInferError] = useState<string | null>(null);
  const [inferReason, setInferReason] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const abortRef = useRef<AbortController | null>(null);
  const inferAbortRef = useRef<AbortController | null>(null);

  useEffect(() => { requestNotificationPermission(); }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      inferAbortRef.current?.abort();
    };
  }, []);

  const tryParseAssetPair = (raw: string): boolean => {
    const pair = parseAssetPair(raw);
    if (!pair) return false;
    setAssetCode(pair.assetCode);
    setIssuer(pair.issuer);
    return true;
  };

  const handleAssetCodePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData("text");
    if (tryParseAssetPair(pasted)) {
      e.preventDefault();
    }
  };

  function validate(): string | null {
    if (!assetCode.trim()) return "Asset code is required.";
    if (!/^[A-Za-z0-9]{1,12}$/.test(assetCode.trim())) {
      return "Asset code must be 1-12 letters or digits.";
    }
    if (!StrKey.isValidEd25519PublicKey(issuer.trim())) {
      return "Issuer is not a valid Stellar public key.";
    }
    const accounts = parseAddresses(accountsText);
    if (accounts.length === 0) {
      return "Add at least one account address.";
    }
    const invalid = accounts.find(
      (address) => !StrKey.isValidEd25519PublicKey(address),
    );
    if (invalid) {
      return `Invalid account address: ${invalid}`;
    }
    return null;
  }

  const handleInfer = async () => {
    if (!assetCode.trim() || !StrKey.isValidEd25519PublicKey(issuer.trim())) {
      setInferError("Enter a valid asset code and issuer first.");
      return;
    }
    inferAbortRef.current?.abort();
    inferAbortRef.current = new AbortController();
    setInferring(true);
    setInferError(null);
    setInferReason(null);
    try {
      const candidates = await inferDistribLite(
        resolveHorizonUrl(settings),
        assetCode.trim(),
        issuer.trim(),
        inferAbortRef.current.signal,
      );
      if (inferAbortRef.current.signal.aborted) return;
      if (candidates.length === 0) {
        setInferError(
          "No distribution address found — the issuer has made no direct payments of this asset. " +
          "Distribution may use DEX sell orders only. Enter the distribution address manually below.",
        );
        return;
      }
      const best = candidates[0];
      setAccountsText(best.address);
      setInferReason(best.reason);
    } catch (e) {
      if (!inferAbortRef.current?.signal.aborted) {
        setInferError(getErrorMessage(e));
      }
    } finally {
      setInferring(false);
    }
  };

  const handleRun = async () => {
    if (!assetCode.trim() || !StrKey.isValidEd25519PublicKey(issuer.trim())) {
      setError("Enter a valid asset code and issuer first.");
      return;
    }

    // Resolve accounts — auto-infer distrib if the field is empty
    let resolvedAccounts = parseAddresses(accountsText);
    if (resolvedAccounts.length === 0) {
      inferAbortRef.current?.abort();
      inferAbortRef.current = new AbortController();
      setInferring(true);
      setInferError(null);
      setInferReason(null);
      try {
        const candidates = await inferDistribLite(
          resolveHorizonUrl(settings),
          assetCode.trim(),
          issuer.trim(),
          inferAbortRef.current.signal,
        );
        if (inferAbortRef.current.signal.aborted) return;
        if (candidates.length === 0) {
          setInferError(
            "No distribution address found — the issuer has made no direct payments of this asset. " +
            "Distribution may use DEX sell orders only. Enter the distribution address manually below.",
          );
          setInferring(false);
          return;
        }
        const best = candidates[0];
        setAccountsText(best.address);
        setInferReason(best.reason);
        resolvedAccounts = [best.address];
      } catch (e) {
        if (!inferAbortRef.current?.signal.aborted) {
          setInferError(getErrorMessage(e));
        }
        setInferring(false);
        return;
      } finally {
        setInferring(false);
      }
    }

    const invalid = resolvedAccounts.find(
      (a) => !StrKey.isValidEd25519PublicKey(a),
    );
    if (invalid) {
      setError(`Invalid account address: ${invalid}`);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    setResult(null);
    setSavedId(null);
    setProgressText("Initializing scan...");

    try {
      const horizonBase = resolveHorizonUrl(settings);

      const parsedFrom = fromDate ? new Date(fromDate) : undefined;
      const parsedTo = toDate ? new Date(toDate + "T23:59:59") : undefined;

      const summary = await fetchAssetXlmProceeds(
        horizonBase,
        assetCode.trim(),
        issuer.trim(),
        resolvedAccounts,
        controller.signal,
        (progress) => {
          const hitsPart = progress.hits !== undefined ? ` · ${progress.hits.toLocaleString()} hits` : "";
          setProgressText(
            `${progress.phase} (${progress.records.toLocaleString()} scanned${hitsPart})`,
          );
        },
        parsedFrom,
        parsedTo,
      );

      if (controller.signal.aborted) return;
      setResult(summary);
      const trimCode = assetCode.trim();
      const trimIssuer = issuer.trim();
      upsertHistory({ assetCode: trimCode, issuer: trimIssuer, network: settings.network, accountsText: resolvedAccounts.join("\n") });
      upsertSearch({
        type: "asset",
        value: `${trimCode}:${trimIssuer}`,
        network: settings.network,
        distribAddress: summary.accounts[0],
        totalXlmProceeds: summary.totalXlmProceeds,
        totalAssetSold: summary.totalAssetSold,
      });

      ensureXlmUsdPrice();

      setProgressText("Completed.");
      notifyIfHidden(
        `Scan complete — ${assetCode.trim()}`,
        `${formatXlm(summary.totalXlmProceeds)} XLM proceeds · ${formatXlm(summary.totalAssetSold)} sold`,
      );
    } catch (e) {
      if (controller.signal.aborted) {
        setProgressText("Canceled.");
        return;
      }
      setError(getErrorMessage(e));
      setProgressText(null);
    } finally {
      setLoading(false);
    }
  };

  // Auto-run when navigated from another module with URL params
  const autoranRef = useRef(false);
  useEffect(() => {
    if (
      urlAutorun &&
      !autoranRef.current &&
      urlAsset &&
      urlIssuer &&
      urlAccount
    ) {
      autoranRef.current = true;
      handleRun();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCancel = () => {
    abortRef.current?.abort();
    setLoading(false);
    setProgressText("Canceled.");
  };

  const handleSavePreset = () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    const addresses = parseAddresses(accountsText);
    const distributionAddress = addresses[0];
    savePreset({
      assetCode: assetCode.trim(),
      issuer: issuer.trim(),
      distributionAddress,
      network: settings.network,
      accountsText,
    });
    setSelectedPresetId(
      `${assetCode.trim()}:${issuer.trim()}:${distributionAddress}`,
    );
    setError(null);
  };

  const handleApplySelectedPreset = () => {
    if (selectedPresetId === "none") return;
    const preset = presets.find((row) => row.id === selectedPresetId);
    if (!preset) return;
    setAssetCode(preset.assetCode);
    setIssuer(preset.issuer);
    updateSettings({ network: preset.network as Network });
    setAccountsText(preset.accountsText);
  };

  const handleDeleteSelectedPreset = () => {
    if (selectedPresetId === "none") return;
    removePreset(selectedPresetId);
    setSelectedPresetId("none");
  };

  return (
    <div className="space-y-6">
      {searchHistory.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            Recent searches
          </div>
          <div className="flex flex-wrap gap-2">
            {searchHistory.map((entry) => (
              <div
                key={entry.timestamp}
                className="flex items-center gap-1 rounded-md border border-border bg-muted/40 pl-2 pr-1 py-1 text-xs"
              >
                <button
                  className="flex items-center gap-1.5 hover:text-foreground text-muted-foreground transition-colors"
                  onClick={() => {
                    setAssetCode(entry.assetCode);
                    setIssuer(entry.issuer);
                    updateSettings({ network: entry.network as Network });
                    setAccountsText(entry.accountsText);
                  }}
                >
                  <span className="font-mono font-semibold text-foreground">
                    {entry.assetCode}
                  </span>
                  <span className="font-mono opacity-60 max-w-[120px] truncate">
                    {entry.issuer.slice(0, 8)}…
                  </span>
                  <span className="opacity-50">{entry.network}</span>
                </button>
                <button
                  className="ml-1 text-muted-foreground hover:text-destructive transition-colors p-0.5 rounded"
                  onClick={() => removeHistory(entry.timestamp)}
                  aria-label="Remove"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 flex-wrap">
            Asset → XLM Proceeds
            {assetCode.trim() &&
              StrKey.isValidEd25519PublicKey(issuer.trim()) && (
                <a
                  href={`https://lobstr.co/trade/${assetCode.trim()}:${issuer.trim()}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto inline-flex items-center gap-1 text-xs font-normal text-muted-foreground border border-border rounded px-2 py-0.5 hover:text-foreground hover:border-foreground/30 transition-colors"
                  title="View on Lobstr"
                >
                  <ExternalLink className="h-3 w-3" />
                  Lobstr
                </a>
              )}
          </CardTitle>
          <CardDescription>
            All-time asset sales report for one asset and your distribution
            seller accounts, including proceeds and redistribution.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 p-2">
            <span className="text-xs text-muted-foreground">Presets</span>
            <Select
              value={selectedPresetId}
              onValueChange={setSelectedPresetId}
            >
              <SelectTrigger className="h-8 w-[360px] max-w-full">
                <SelectValue placeholder="Select preset" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Select preset</SelectItem>
                {presets.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleApplySelectedPreset}
              disabled={selectedPresetId === "none"}
            >
              Apply
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleDeleteSelectedPreset}
              disabled={selectedPresetId === "none"}
            >
              Delete
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleSavePreset}
            >
              <Save className="mr-2 h-4 w-4" />
              Save Current
            </Button>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="asset-code">Asset Code</Label>
              <Input
                id="asset-code"
                placeholder="USDC / paste CODE:ISSUER / URL"
                value={assetCode}
                onChange={(e) => setAssetCode(e.target.value)}
                onPaste={handleAssetCodePaste}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="asset-issuer">Asset Issuer</Label>
              <Input
                id="asset-issuer"
                placeholder="G..."
                value={issuer}
                onChange={(e) => setIssuer(e.target.value.trim())}
                className="font-mono text-xs"
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-[1fr_auto]">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="manual-accounts">
                  Seller Accounts (one per line)
                </Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleInfer}
                  disabled={inferring || loading}
                  title="Infer distribution address from asset code and issuer"
                >
                  {inferring ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Search className="mr-2 h-3.5 w-3.5" />
                  )}
                  Infer from asset
                </Button>
              </div>
              <textarea
                id="manual-accounts"
                className="w-full min-h-44 rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono"
                placeholder="G...\nor click 'Infer from asset'"
                value={accountsText}
                onChange={(e) => { setAccountsText(e.target.value); setInferReason(null); }}
              />
              {inferReason && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">Inferred: </span>
                  {inferReason}
                </p>
              )}
              {inferError && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  {inferError}
                </p>
              )}
            </div>
          </div>

          {/* Date range */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="from-date">From (optional)</Label>
              <Input
                id="from-date"
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="to-date">To (optional)</Label>
              <Input
                id="to-date"
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                disabled={loading}
              />
            </div>
          </div>
          {(fromDate || toDate) && (
            <p className="text-xs text-muted-foreground -mt-2">
              Scanning only within the selected date range — much faster for recent data.
            </p>
          )}

          {progressText && (
            <p className="text-xs text-muted-foreground">{progressText}</p>
          )}

          {error && (
            <p className="text-sm text-destructive flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              {error}
            </p>
          )}
        </CardContent>
        <CardFooter className="flex gap-2">
          <Button onClick={handleRun} disabled={loading}>
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Search className="mr-2 h-4 w-4" />
            )}
            Analyze
          </Button>
          <Button variant="outline" onClick={handleCancel} disabled={!loading}>
            <X className="mr-2 h-4 w-4" />
            Cancel
          </Button>
        </CardFooter>
      </Card>

      {result && (
        <>
          <ProceedsStatsCards
            result={result}
            assetCode={result.assetCode}
            xlmUsdPrice={xlmUsdPrice}
          />

          <Card>
            <CardHeader>
              <CardTitle>Top Destinations</CardTitle>
              <CardDescription>
                Outgoing native XLM redistribution destinations from the
                selected accounts.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    exportOutgoingCsv(
                      `outgoing-${result.assetCode}.csv`,
                      result.outgoingLedger,
                    )
                  }
                >
                  <Download className="mr-2 h-3.5 w-3.5" />
                  Export All Outgoing
                </Button>
                {savedId ? (
                  <Button variant="outline" size="sm" disabled>
                    <BookmarkCheck className="mr-2 h-3.5 w-3.5 text-green-500" />
                    Saved
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const id = saveAnalysis({
                        name: `${result.assetCode} — ${new Date().toLocaleDateString()}`,
                        assetCode: result.assetCode,
                        issuer: result.issuer,
                        distribAddresses: result.accounts,
                        network: settings.network,
                        result,
                      });
                      setSavedId(id);
                    }}
                  >
                    <Save className="mr-2 h-3.5 w-3.5" />
                    Save Analysis
                  </Button>
                )}
                {result.accounts[0] && (
                  <SaveToGroupButton
                    assetCode={result.assetCode}
                    issuer={result.issuer}
                    network={settings.network}
                    distribAddress={result.accounts[0]}
                  />
                )}
              </div>

              <ProceedsDestinationsTable
                destinations={result.topDestinations}
                totalXlmProceeds={result.totalXlmProceeds}
                network={settings.network}
                assetCode={result.assetCode}
                issuer={result.issuer}
                showProgressBar
                onDownloadCsv={(address) =>
                  exportOutgoingCsv(
                    `outgoing-${address.slice(0, 8)}.csv`,
                    result.outgoingLedger.filter((entry) => entry.to === address),
                  )
                }
                onInvestigate={(address) =>
                  router.push(`/address-investigator?address=${address}`)
                }
                showGroupAction
              />
            </CardContent>
          </Card>

        </>
      )}
    </div>
  );
}
