"use client";

/**
 * AssetLookupPanel — reusable asset lookup UI.
 *
 * Drop this component anywhere an asset lookup is needed.
 * Pass initialAssetCode / initialIssuer to pre-fill the form.
 */

import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Search,
  Loader2,
  AlertCircle,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Download,
  Trophy,
  X,
  Info,
  Globe,
  Clock,
  ShieldOff,
  Lock,
  FileText,
  ChevronDown,
  ChevronUp,
  BarChart2,
  Coins,
  ArrowRightLeft,
  Megaphone,
  ExternalLink,
  Layers,
} from "lucide-react";
import { Horizon, Asset, StrKey } from "stellar-sdk";
import { useSettings, resolveHorizonUrl } from "@/lib/settings";
import { getErrorMessage } from "@/lib/stellar-helpers";
import { downloadCSV } from "@/lib/csv-export";
import {
  fetchAllHolders,
  fetchIssuerInfo,
  fetchAccountCreator,
  fetchPaymentTotals,
  fetchClaimableBalances,
  fetchAssetXlmTrades,
  inferDistributionAddresses,
  type Holder,
  type DistribCandidate,
  type IssuerInfo,
  type PaymentTotals,
  type ClaimableBalanceSummary,
  type AssetXlmTradeSummary,
  type PriceBucket,
} from "@/lib/asset-lookup";
import { fetchAssetXlmProceeds } from "@/lib/proceeds-investigator/fetchers";
import type { AssetProceedsResult } from "@/lib/proceeds-investigator/types";
import { useAssetHistory, assetHistoryGetSnapshot } from "./useAssetHistory";
import { useSavedSearches } from "@/hooks/use-saved-searches";
import { useKnownIntermediaries } from "@/hooks/use-known-intermediaries";
import { useAssetGroups } from "@/hooks/use-asset-groups";
import { ShortAddress } from "./ShortAddress";
import { AuthFlag } from "./AuthFlag";
import {
  ChainDisplay,
  ChainState,
  traceChainStep,
} from "@/components/shared/ChainDisplay";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const ASSET_CODE_RE = /^[A-Z0-9]{1,12}$/;

interface ValidationErrors {
  assetCode?: string;
  issuer?: string;
}

function validate(assetCode: string, issuer: string): ValidationErrors {
  const errors: ValidationErrors = {};
  if (!assetCode) {
    errors.assetCode = "Asset code is required.";
  } else if (!ASSET_CODE_RE.test(assetCode)) {
    errors.assetCode = "Must be 1–12 uppercase letters or digits (A–Z, 0–9).";
  }
  if (!issuer) {
    errors.issuer = "Issuer address is required.";
  } else if (!StrKey.isValidEd25519PublicKey(issuer)) {
    errors.issuer =
      "Invalid Stellar public key. Must start with G and be 56 characters.";
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SortField = "rank" | "balance" | "account";
type SortDirection = "asc" | "desc";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AssetLookupPanelProps {
  initialAssetCode?: string;
  initialIssuer?: string;
}

// ---------------------------------------------------------------------------
// PriceHistogram — inline bar chart of trade price distribution
// ---------------------------------------------------------------------------

function PriceHistogram({
  buckets,
  xlmUsdPrice,
  label,
}: {
  buckets: PriceBucket[];
  xlmUsdPrice: number | null;
  label?: string;
}) {
  const maxAsset = Math.max(...buckets.map((b) => b.assetSold));
  return (
    <div className="space-y-1.5">
      {label && (
        <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide">
          {label}
        </p>
      )}
      {buckets.map((b, i) => {
        const pct = maxAsset > 0 ? (b.assetSold / maxAsset) * 100 : 0;
        const priceLabel =
          b.priceFrom === b.priceTo
            ? b.priceFrom.toLocaleString(undefined, {
                maximumFractionDigits: 6,
              })
            : `${b.priceFrom.toLocaleString(undefined, { maximumFractionDigits: 6 })} – ${b.priceTo.toLocaleString(undefined, { maximumFractionDigits: 6 })}`;
        return (
          <div key={i} className="flex items-center gap-2 text-[11px]">
            <span
              className="w-36 shrink-0 text-right font-mono text-muted-foreground truncate"
              title={priceLabel}
            >
              {priceLabel} XLM
            </span>
            <div className="flex-1 h-4 bg-muted rounded overflow-hidden">
              <div
                className="h-full bg-violet-500/70 rounded"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="w-24 shrink-0 font-mono tabular-nums text-right text-muted-foreground">
              {b.assetSold.toLocaleString(undefined, {
                maximumFractionDigits: 2,
              })}
              {" · "}
              <span className="text-foreground">{b.count}×</span>
            </span>
            {xlmUsdPrice !== null && (
              <span className="w-20 shrink-0 font-mono tabular-nums text-right text-muted-foreground/70 text-[10px]">
                ≈$
                {(b.xlmReceived * xlmUsdPrice).toLocaleString(undefined, {
                  maximumFractionDigits: 0,
                })}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}


// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AssetLookupPanel({
  initialAssetCode,
  initialIssuer,
}: AssetLookupPanelProps) {
  const { settings } = useSettings();
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlCode = searchParams.get("code");
  const urlIssuer = searchParams.get("issuer");
  const {
    history: searchHistory,
    upsert: upsertHistory,
    remove: removeHistory,
  } = useAssetHistory();
  const { upsert: upsertSearch } = useSavedSearches();
  const { entries: knownIntermediaries } = useKnownIntermediaries();
  const { groups } = useAssetGroups();
  const knownIntermediarySet = useMemo(
    () => new Set(knownIntermediaries.map((e) => e.address)),
    [knownIntermediaries],
  );

  const [assetCode, setAssetCode] = useState(() => {
    if (urlCode) return urlCode; // preserve original case — Stellar asset codes are case-sensitive on-chain
    if (initialAssetCode) return initialAssetCode;
    return assetHistoryGetSnapshot()[0]?.assetCode ?? "";
  });
  const [issuer, setIssuer] = useState(() => {
    if (urlIssuer) return urlIssuer;
    if (initialIssuer) return initialIssuer;
    return assetHistoryGetSnapshot()[0]?.issuer ?? "";
  });

  // Crawl state
  const [isCrawling, setIsCrawling] = useState(false);
  const [crawlHolderCount, setCrawlHolderCount] = useState(0);
  const [crawlPageCount, setCrawlPageCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [holders, setHolders] = useState<Holder[]>([]);

  // Issuer info
  const [issuerInfo, setIssuerInfo] = useState<IssuerInfo | null>(null);
  const [issuerInfoError, setIssuerInfoError] = useState<string | null>(null);

  // SAC deployment status (async, non-blocking)
  const [sacDeployed, setSacDeployed] = useState<boolean | null>(null);

  // Distribution inference state
  const [isInferring, setIsInferring] = useState(false);
  const [distribCandidates, setDistribCandidates] = useState<
    DistribCandidate[]
  >([]);
  const [distribError, setDistribError] = useState<string | null>(null);

  const [validationErrors, setValidationErrors] = useState<ValidationErrors>(
    {},
  );
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  // Sorting & filtering
  const [sortField, setSortField] = useState<SortField>("rank");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [filterText, setFilterText] = useState("");
  const [showAllHolders, setShowAllHolders] = useState(false);
  const [domainStatus, setDomainStatus] = useState<
    Record<string, "checking" | "up" | "down">
  >({});
  const [tomlContent, setTomlContent] = useState<string | null>(null);
  const [tomlError, setTomlError] = useState<string | null>(null);
  const [tomlLoading, setTomlLoading] = useState(false);
  const [showToml, setShowToml] = useState(false);

  // On-demand: payment totals
  const [paymentTotals, setPaymentTotals] = useState<PaymentTotals | null>(
    null,
  );
  const [paymentTotalsLoading, setPaymentTotalsLoading] = useState(false);
  const [paymentTotalsError, setPaymentTotalsError] = useState<string | null>(
    null,
  );
  const [showPaymentTotals, setShowPaymentTotals] = useState(false);

  // On-demand: claimable balances
  const [claimable, setClaimable] = useState<ClaimableBalanceSummary | null>(
    null,
  );
  const [claimableLoading, setClaimableLoading] = useState(false);
  const [claimableError, setClaimableError] = useState<string | null>(null);
  const [showClaimable, setShowClaimable] = useState(false);

  // On-demand: distribution chart
  const [showDistChart, setShowDistChart] = useState(false);

  // On-demand: DEX trades
  const [assetTrades, setAssetTrades] = useState<AssetXlmTradeSummary | null>(
    null,
  );
  const [assetTradesLoading, setAssetTradesLoading] = useState(false);
  const [assetTradesError, setAssetTradesError] = useState<string | null>(null);
  const [showAssetTrades, setShowAssetTrades] = useState(false);
  const [assetTradesProgress, setAssetTradesProgress] = useState<string | null>(
    null,
  );
  const [xlmUsdPrice, setXlmUsdPrice] = useState<number | null>(null);

  // On-demand: Distribution XLM Sales (proceeds for distrib addresses)
  const [distribSales, setDistribSales] = useState<AssetProceedsResult | null>(
    null,
  );
  const [distribSalesLoading, setDistribSalesLoading] = useState(false);
  const [distribSalesError, setDistribSalesError] = useState<string | null>(
    null,
  );
  const [showDistribSales, setShowDistribSales] = useState(false);
  const [distribSalesProgress, setDistribSalesProgress] = useState<
    string | null
  >(null);

  // Distrib candidate creators: address -> creator address
  const [distribCreators, setDistribCreators] = useState<
    Record<string, string>
  >({});
  // Distrib candidate XLM balances: address -> xlm balance string
  const [distribXlm, setDistribXlm] = useState<Record<string, string>>({});

  // Creation ancestry chain (recursive intermediary lookup)
  const [issuerChain, setIssuerChain] = useState<ChainState>({
    status: "idle",
    chain: [],
  });
  const [distribChain, setDistribChain] = useState<ChainState>({
    status: "idle",
    chain: [],
  });
  const realCreatorAbortRef = useRef<AbortController | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------------

  const distribAddressSet = useMemo(
    () => new Set(distribCandidates.map((c) => c.address)),
    [distribCandidates],
  );

  const distribAddressMap = useMemo(
    () => new Map(distribCandidates.map((c) => [c.address, c])),
    [distribCandidates],
  );

  const anyHasDomain = useMemo(
    () => holders.some((h) => h.homeDomain),
    [holders],
  );

  // Rank map: publicKey -> rank by balance (1-based, desc)
  const rankMap = useMemo(() => {
    const sorted = [...holders].sort(
      (a, b) => parseFloat(b.balance) - parseFloat(a.balance),
    );
    return new Map(sorted.map((h, i) => [h.id, i + 1]));
  }, [holders]);

  const stats = useMemo(() => {
    if (holders.length === 0) return null;
    const balances = holders.map((h) => parseFloat(h.balance));
    const total = balances.reduce((sum, b) => sum + b, 0);
    const sorted = [...balances].sort((a, b) => b - a);
    const top10Total = sorted.slice(0, 10).reduce((s, b) => s + b, 0);
    const top10Pct = total > 0 ? (top10Total / total) * 100 : 0;
    return {
      total,
      highest: sorted[0] ?? 0,
      lowest: sorted[sorted.length - 1] ?? 0,
      average: total / balances.length,
      count: holders.length,
      top10Pct,
    };
  }, [holders]);

  const displayedHolders = useMemo(() => {
    let result = [...holders];

    if (filterText.trim()) {
      const needle = filterText.trim().toUpperCase();
      result = result.filter(
        (h) =>
          h.id.toUpperCase().includes(needle) ||
          (h.homeDomain && h.homeDomain.toUpperCase().includes(needle)),
      );
    }

    result.sort((a, b) => {
      let cmp: number;
      if (sortField === "rank" || sortField === "balance") {
        cmp = parseFloat(a.balance) - parseFloat(b.balance);
      } else {
        cmp = a.id.localeCompare(b.id);
      }
      // Default rank/balance: desc (highest first); account: asc
      const defaultDesc = sortField !== "account";
      const effectiveDir = defaultDesc
        ? sortDirection === "desc"
          ? -cmp
          : cmp
        : sortDirection === "asc"
          ? cmp
          : -cmp;
      return effectiveDir;
    });

    return result;
  }, [holders, sortField, sortDirection, filterText]);

  // ---------------------------------------------------------------------------
  // Sorting
  // ---------------------------------------------------------------------------

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection(field === "account" ? "asc" : "desc");
    }
  };

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field)
      return <ArrowUpDown className="ml-1 h-3 w-3 text-muted-foreground/50" />;
    return sortDirection === "asc" ? (
      <ArrowUp className="ml-1 h-3 w-3" />
    ) : (
      <ArrowDown className="ml-1 h-3 w-3" />
    );
  }

  // ---------------------------------------------------------------------------
  // Field handlers
  // ---------------------------------------------------------------------------

  // Tries to parse "CODE:ISSUER" or a URL containing that pattern.
  // Returns true if it successfully split and populated both fields.
  const tryParseAssetPair = (raw: string): boolean => {
    // Extract the CODE:ISSUER segment from anywhere in the string
    const match = raw.match(/([A-Za-z0-9]{1,12}):([A-Z2-7]{56})/);
    if (!match) return false;
    const code = match[1];
    const addr = match[2];
    if (!StrKey.isValidEd25519PublicKey(addr)) return false;
    setAssetCode(code);
    setIssuer(addr);
    setTouched({ assetCode: true, issuer: true });
    setValidationErrors(validate(code, addr));
    return true;
  };

  const handleAssetCodeChange = (value: string) => {
    const normalized = value;
    setAssetCode(normalized);
    if (touched.assetCode) {
      setValidationErrors((prev) => ({
        ...prev,
        ...validate(normalized, issuer),
      }));
    }
  };

  const handleAssetCodePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData("text");
    if (tryParseAssetPair(pasted)) {
      e.preventDefault();
    }
  };

  const handleIssuerChange = (value: string) => {
    setIssuer(value);
    if (touched.issuer) {
      setValidationErrors((prev) => ({
        ...prev,
        ...validate(assetCode, value),
      }));
    }
  };

  const handleBlur = (field: "assetCode" | "issuer") => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    setValidationErrors(validate(assetCode, issuer));
  };

  // ---------------------------------------------------------------------------
  // Cancel
  // ---------------------------------------------------------------------------

  const handleCancel = () => {
    abortRef.current?.abort();
    setIsCrawling(false);
    setIsInferring(false);
  };

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------

  const handleClear = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setAssetCode("");
    setIssuer("");
    setValidationErrors({});
    setTouched({});
    setError(null);
    setHolders([]);
    setDistribCandidates([]);
    setDistribError(null);
    setIssuerInfo(null);
    setIssuerInfoError(null);
    setFilterText("");
    setSortField("rank");
    setSortDirection("desc");
    setShowAllHolders(false);
    setDomainStatus({});
    setTomlContent(null);
    setTomlError(null);
    setShowToml(false);
    setPaymentTotals(null);
    setPaymentTotalsError(null);
    setShowPaymentTotals(false);
    setClaimable(null);
    setClaimableError(null);
    setShowClaimable(false);
    setShowDistChart(false);
    setAssetTrades(null);
    setAssetTradesError(null);
    setShowAssetTrades(false);
    setAssetTradesProgress(null);
    setXlmUsdPrice(null);
    setDistribSales(null);
    setDistribSalesError(null);
    setShowDistribSales(false);
    setDistribSalesProgress(null);
    setDistribCreators({});
    setDistribXlm({});
    setCrawlHolderCount(0);
    setCrawlPageCount(0);
    setSacDeployed(null);
  };

  const handleSearch = async () => {
    setTouched({ assetCode: true, issuer: true });
    const errors = validate(assetCode, issuer);
    setValidationErrors(errors);
    if (Object.keys(errors).length > 0) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsCrawling(true);
    setError(null);
    setHolders([]);
    setDistribCandidates([]);
    setDistribError(null);
    setIssuerInfo(null);
    setIssuerInfoError(null);
    setFilterText("");
    setSortField("rank");
    setSortDirection("desc");
    setShowAllHolders(false);
    setTouched({});
    setDomainStatus({});
    setTomlContent(null);
    setTomlError(null);
    setShowToml(false);
    setPaymentTotals(null);
    setPaymentTotalsError(null);
    setShowPaymentTotals(false);
    setClaimable(null);
    setClaimableError(null);
    setShowClaimable(false);
    setShowDistChart(false);
    setAssetTrades(null);
    setAssetTradesError(null);
    setShowAssetTrades(false);
    setAssetTradesProgress(null);
    setXlmUsdPrice(null);
    setDistribSales(null);
    setDistribSalesError(null);
    setShowDistribSales(false);
    setDistribSalesProgress(null);
    setDistribCreators({});
    setDistribXlm({});
    setIssuerChain({ status: "idle", chain: [] });
    setDistribChain({ status: "idle", chain: [] });
    realCreatorAbortRef.current?.abort();
    setCrawlHolderCount(0);
    setCrawlPageCount(0);
    setSacDeployed(null);

    try {
      const serverUrl = resolveHorizonUrl(settings);
      const server = new Horizon.Server(serverUrl);
      const asset = new Asset(assetCode, issuer);

      // Fire SAC check async — non-blocking, updates badge when resolved
      if (settings.network !== "local") {
        import("@/lib/soroban/sac").then(({ computeSacAddress }) => {
          try {
            const contractId = computeSacAddress(assetCode, issuer, settings.network);
            fetch("/api/soroban/check", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ contractId, network: settings.network }),
              signal: controller.signal,
            })
              .then((r) => r.json())
              .then((d) => { if (d.deployed !== undefined) setSacDeployed(d.deployed); })
              .catch(() => {});
          } catch {
            // computeSacAddress can throw for invalid inputs — ignore
          }
        });
      }

      // Fetch issuer info in parallel with the holder crawl start
      fetchIssuerInfo(server, issuer, controller.signal)
        .then((info) => {
          if (controller.signal.aborted) return;
          setIssuerInfo(info);
          if (info.homeDomain) {
            setDomainStatus((prev) => ({
              ...prev,
              [info.homeDomain!]: "checking",
            }));
            fetch(`/api/toml?domain=${encodeURIComponent(info.homeDomain)}`, {
              signal: controller.signal,
            })
              .then((res) => {
                if (!controller.signal.aborted)
                  setDomainStatus((prev) => ({
                    ...prev,
                    [info.homeDomain!]: res.ok ? "up" : "down",
                  }));
              })
              .catch(() => {
                if (!controller.signal.aborted)
                  setDomainStatus((prev) => ({
                    ...prev,
                    [info.homeDomain!]: "down",
                  }));
              });
          }
        })
        .catch((err) => {
          if (!controller.signal.aborted)
            setIssuerInfoError(getErrorMessage(err));
        });

      const allHolders = await fetchAllHolders(
        server,
        asset,
        assetCode,
        issuer,
        controller.signal,
        (count, page) => {
          setCrawlHolderCount(count);
          setCrawlPageCount(page);
        },
      );

      if (controller.signal.aborted) return;

      if (allHolders.length === 0) {
        setError("No holders found for this asset.");
        setIsCrawling(false);
        return;
      }

      setHolders(allHolders);
      setIsCrawling(false);
      upsertHistory({ assetCode, issuer, network: settings.network });
      upsertSearch({
        type: "asset",
        value: `${assetCode}:${issuer}`,
        network: settings.network,
      });

      // Check domain availability for each unique domain found in holders
      const uniqueDomains = [
        ...new Set(
          allHolders.map((h) => h.homeDomain).filter(Boolean) as string[],
        ),
      ];
      if (uniqueDomains.length > 0) {
        setDomainStatus(
          Object.fromEntries(uniqueDomains.map((d) => [d, "checking"])),
        );
        uniqueDomains.forEach(async (domain) => {
          try {
            const res = await fetch(
              `/api/toml?domain=${encodeURIComponent(domain)}`,
              { signal: controller.signal },
            );
            if (!controller.signal.aborted)
              setDomainStatus((prev) => ({
                ...prev,
                [domain]: res.ok ? "up" : "down",
              }));
          } catch {
            if (!controller.signal.aborted)
              setDomainStatus((prev) => ({ ...prev, [domain]: "down" }));
          }
        });
      }

      setIsInferring(true);
      try {
        const candidates = await inferDistributionAddresses(
          server,
          assetCode,
          issuer,
          allHolders,
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setDistribCandidates(candidates);
          // Fetch creator + XLM balance for each distrib candidate (lightweight)
          candidates.forEach(async (c) => {
            const [creator, account] = await Promise.allSettled([
              fetchAccountCreator(server, c.address, controller.signal),
              server.loadAccount(c.address),
            ]);
            if (controller.signal.aborted) return;
            if (creator.status === "fulfilled" && creator.value) {
              setDistribCreators((prev) => ({
                ...prev,
                [c.address]: creator.value!,
              }));
            }
            if (account.status === "fulfilled") {
              const nativeBal = account.value.balances.find(
                (b) => b.asset_type === "native",
              );
              if (nativeBal) {
                setDistribXlm((prev) => ({
                  ...prev,
                  [c.address]: nativeBal.balance,
                }));
              }
            }
          });
        }
      } catch (err) {
        if (!controller.signal.aborted) setDistribError(getErrorMessage(err));
      } finally {
        if (!controller.signal.aborted) setIsInferring(false);
      }
    } catch (err: unknown) {
      if (controller.signal.aborted) return;
      setError(getErrorMessage(err));
      setIsCrawling(false);
    }
  };

  const handleFetchToml = async () => {
    if (!issuerInfo?.homeDomain) return;
    setTomlLoading(true);
    setTomlError(null);
    setTomlContent(null);
    setShowToml(true);
    try {
      const res = await fetch(
        `/api/toml?domain=${encodeURIComponent(issuerInfo.homeDomain)}`,
      );
      const text = await res.text();
      if (!res.ok) {
        const parsed = JSON.parse(text);
        setTomlError(parsed.error ?? "Failed to fetch TOML");
      } else {
        setTomlContent(text);
      }
    } catch {
      setTomlError("Network error fetching TOML");
    } finally {
      setTomlLoading(false);
    }
  };

  const handleFetchPaymentTotals = async () => {
    if (paymentTotalsLoading) return;
    if (showPaymentTotals) {
      setShowPaymentTotals(false);
      return;
    }
    setShowPaymentTotals(true);
    if (paymentTotals) return; // already loaded
    setPaymentTotalsLoading(true);
    setPaymentTotalsError(null);
    try {
      const serverUrl = resolveHorizonUrl(settings);
      const server = new Horizon.Server(serverUrl);
      const tracked = distribCandidates.map((c) => c.address);
      const result = await fetchPaymentTotals(
        server,
        issuer,
        assetCode,
        tracked,
        abortRef.current?.signal ?? new AbortController().signal,
      );
      setPaymentTotals(result);
    } catch (err) {
      setPaymentTotalsError(getErrorMessage(err));
    } finally {
      setPaymentTotalsLoading(false);
    }
  };

  const handleFetchClaimable = async () => {
    if (claimableLoading) return;
    if (showClaimable) {
      setShowClaimable(false);
      return;
    }
    setShowClaimable(true);
    if (claimable) return; // already loaded
    setClaimableLoading(true);
    setClaimableError(null);
    try {
      const result = await fetchClaimableBalances(
        new Horizon.Server(resolveHorizonUrl(settings)),
        assetCode,
        issuer,
        abortRef.current?.signal ?? new AbortController().signal,
      );
      setClaimable(result);
    } catch (err) {
      setClaimableError(getErrorMessage(err));
    } finally {
      setClaimableLoading(false);
    }
  };

  const handleFetchAssetTrades = async () => {
    if (assetTradesLoading) return;
    if (showAssetTrades) {
      setShowAssetTrades(false);
      return;
    }
    setShowAssetTrades(true);
    if (assetTrades) return; // already loaded
    setAssetTradesLoading(true);
    setAssetTradesError(null);
    setAssetTradesProgress("Starting scan…");
    try {
      const trackedAddresses = distribCandidates
        .filter((c) => c.confidence === "high")
        .map((c) => c.address);
      const signal = abortRef.current?.signal ?? new AbortController().signal;
      const [result] = await Promise.all([
        fetchAssetXlmTrades(
          resolveHorizonUrl(settings),
          assetCode,
          issuer,
          trackedAddresses,
          signal,
          (count) =>
            setAssetTradesProgress(
              `Scanning trades… ${count.toLocaleString()} found`,
            ),
        ),
        fetch(
          "https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd",
        )
          .then((r) => r.json())
          .then((data) => setXlmUsdPrice(data?.stellar?.usd ?? null))
          .catch(() => {}),
      ]);
      setAssetTrades(result);
    } catch (err) {
      setAssetTradesError(getErrorMessage(err));
    } finally {
      setAssetTradesLoading(false);
      setAssetTradesProgress(null);
    }
  };

  const handleFetchDistribSales = async () => {
    setShowDistribSales(true);
    if (distribSales) return; // already loaded
    if (distribCandidates.length === 0) return;
    setDistribSalesLoading(true);
    setDistribSalesError(null);
    setDistribSalesProgress("Starting scan…");
    try {
      const primaryDistrib = distribCandidates[0].address;
      const signal = abortRef.current?.signal ?? new AbortController().signal;
      const result = await fetchAssetXlmProceeds(
        resolveHorizonUrl(settings),
        assetCode,
        issuer,
        [primaryDistrib],
        signal,
        (progress) =>
          setDistribSalesProgress(
            `${progress.phase} (${progress.records.toLocaleString()} records)`,
          ),
      );
      setDistribSales(result);
    } catch (err) {
      setDistribSalesError(getErrorMessage(err));
    } finally {
      setDistribSalesLoading(false);
      setDistribSalesProgress(null);
    }
  };

  const hasErrors = Object.keys(validationErrors).length > 0;
  const isLoading = isCrawling || isInferring;

  return (
    <div className="space-y-6">
      {/* Recent searches */}
      {searchHistory.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            Recent searches
          </div>
          <div className="flex flex-wrap gap-2">
            {searchHistory.map((entry) => (
              <div
                key={`${entry.assetCode}-${entry.issuer}-${entry.network}`}
                className="flex items-center gap-1 rounded-md border border-border bg-muted/40 pl-2 pr-1 py-1 text-xs"
              >
                <button
                  className="flex items-center gap-1.5 hover:text-foreground text-muted-foreground transition-colors"
                  onClick={() => {
                    setAssetCode(entry.assetCode);
                    setIssuer(entry.issuer);
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

      {/* Query form */}
      <Card>
        <CardHeader>
          <CardTitle>Query Parameters</CardTitle>
          <CardDescription>
            Enter the asset details to find holders.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="md:col-span-1 space-y-2">
              <Label htmlFor="asset-code">Asset Code</Label>
              <Input
                id="asset-code"
                value={assetCode}
                onChange={(e) => handleAssetCodeChange(e.target.value)}
                onBlur={() => handleBlur("assetCode")}
                onPaste={handleAssetCodePaste}
                placeholder="USDC / paste CODE:ISSUER / URL"
                className="font-mono"
                aria-invalid={!!validationErrors.assetCode}
              />
              {validationErrors.assetCode && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3 shrink-0" />
                  {validationErrors.assetCode}
                </p>
              )}
            </div>

            <div className="md:col-span-2 space-y-2">
              <Label htmlFor="issuer">Issuer Address</Label>
              <Input
                id="issuer"
                value={issuer}
                onChange={(e) => handleIssuerChange(e.target.value)}
                onBlur={() => handleBlur("issuer")}
                placeholder="G..."
                className="font-mono text-xs"
                aria-invalid={!!validationErrors.issuer}
              />
              {validationErrors.issuer && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3 shrink-0" />
                  {validationErrors.issuer}
                </p>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-3">
            {holders.length > 0 && !isLoading && (
              <Button variant="ghost" size="sm" onClick={handleClear}>
                <X className="mr-2 h-4 w-4" /> Clear
              </Button>
            )}
            {isLoading && (
              <Button variant="outline" onClick={handleCancel}>
                <X className="mr-2 h-4 w-4" /> Cancel
              </Button>
            )}
            <Button onClick={handleSearch} disabled={isLoading || hasErrors}>
              {isCrawling ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Search className="mr-2 h-4 w-4" />
              )}
              {isCrawling ? "Fetching asset data…" : "Fetch Asset"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Crawl progress */}
      {isCrawling && (
        <div className="flex items-center gap-3 rounded-md border border-border bg-muted/40 p-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground shrink-0" />
          <div className="text-sm">
            <span className="font-medium">
              Fetching asset data — holders page {crawlPageCount}
            </span>
            <span className="text-muted-foreground ml-2">
              ({crawlHolderCount.toLocaleString()} found so far, please wait…)
            </span>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-4 rounded-md bg-destructive/10 text-destructive flex items-center gap-2">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      {/* Asset Overview */}
      {(issuerInfo || issuerInfoError) && !isCrawling && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 flex-wrap">
              <Globe className="h-5 w-5 text-muted-foreground" />
              Asset Overview — <span className="font-mono">{assetCode}</span>
              <a
                href={`https://lobstr.co/trade/${assetCode}:${issuer}`}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto inline-flex items-center gap-1 text-xs font-normal text-muted-foreground border border-border rounded px-2 py-0.5 hover:text-foreground hover:border-foreground/30 transition-colors"
                title="View on Lobstr"
              >
                <ExternalLink className="h-3 w-3" />
                Lobstr
              </a>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {issuerInfoError && (
              <p className="text-sm text-destructive">{issuerInfoError}</p>
            )}
            {issuerInfo && (
              <>
                {/* Hero row: Issuer + Distributor */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Issuer */}
                  <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
                    <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
                      Issuer
                    </p>
                    <ShortAddress
                      address={issuer}
                      role="issuer"
                      suggestedLabel={`Issuer ${assetCode}`}
                      suggestedNotes={issuerInfo.homeDomain ?? undefined}
                    />
                    {issuerInfo.createdBy &&
                      (() => {
                        return (
                          <div className="space-y-1">
                            <div className="flex items-center gap-1 text-[10px] text-muted-foreground/70 flex-wrap">
                              <span>created by</span>
                              <ShortAddress
                                address={issuerInfo.createdBy}
                                network={settings.network}
                              />
                              {issuerChain.status === "idle" && (
                                <button
                                  className="ml-1 text-[9px] uppercase tracking-wide font-semibold text-primary hover:underline"
                                  onClick={() => {
                                    const ctrl = new AbortController();
                                    realCreatorAbortRef.current = ctrl;
                                    setIssuerChain({ status: "idle", chain: [] });
                                    traceChainStep(issuer, ctrl.signal, setIssuerChain, resolveHorizonUrl(settings), knownIntermediaries);
                                  }}
                                >
                                  Trace ancestry →
                                </button>
                              )}
                            </div>
                            <ChainDisplay
                              chain={issuerChain}
                              network={settings.network}
                              assetCode={assetCode}
                              issuer={issuer}
                              horizonUrl={resolveHorizonUrl(settings)}
                              knownIntermediaryAddrs={knownIntermediarySet}
                              onContinue={(addr) => {
                                const ctrl = new AbortController();
                                realCreatorAbortRef.current = ctrl;
                                traceChainStep(addr, ctrl.signal, setIssuerChain, resolveHorizonUrl(settings), knownIntermediaries);
                              }}
                            />
                          </div>
                        );
                      })()}
                    <div className="pt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="font-mono font-semibold text-foreground">
                        {Number(issuerInfo.xlmBalance).toLocaleString(
                          undefined,
                          { maximumFractionDigits: 2 },
                        )}{" "}
                        XLM
                      </span>
                      {issuerInfo.homeDomain && (
                        <>
                          <span>·</span>
                          {domainStatus[issuerInfo.homeDomain] ===
                            "checking" && (
                            <span
                              className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-pulse shrink-0"
                              title="Checking TOML…"
                            />
                          )}
                          {domainStatus[issuerInfo.homeDomain] === "up" && (
                            <span
                              className="h-2 w-2 rounded-full bg-green-500 shrink-0"
                              title="TOML reachable"
                            />
                          )}
                          {domainStatus[issuerInfo.homeDomain] === "down" && (
                            <span
                              className="h-2 w-2 rounded-full bg-red-500 shrink-0"
                              title="TOML unreachable"
                            />
                          )}
                          <a
                            href={`https://${issuerInfo.homeDomain}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                          >
                            {issuerInfo.homeDomain}
                          </a>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Distributor (high confidence only) */}
                  {(() => {
                    const highDistrib = distribCandidates.find(
                      (c) => c.confidence === "high",
                    );
                    const distribHolder = highDistrib
                      ? holders.find((h) => h.id === highDistrib.address)
                      : null;
                    return (
                      <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4 space-y-2">
                        <p className="text-[10px] uppercase font-semibold text-yellow-500/80 tracking-wider">
                          Distributor
                          {isInferring && (
                            <Loader2 className="inline ml-2 h-3 w-3 animate-spin" />
                          )}
                        </p>
                        {!isInferring && !highDistrib && (
                          <p className="text-xs text-muted-foreground">
                            {distribCandidates.length > 0
                              ? "No high-confidence candidate"
                              : "Not yet determined"}
                          </p>
                        )}
                        {highDistrib && (
                          <>
                            <ShortAddress
                              address={highDistrib.address}
                              role="distrib"
                              suggestedLabel={`Distrib ${assetCode}`}
                              suggestedNotes={
                                issuerInfo?.homeDomain ?? undefined
                              }
                            />
                            {distribCreators[highDistrib.address] &&
                              (() => {
                                const creatorAddr =
                                  distribCreators[highDistrib.address];
                                return (
                                  <div className="space-y-1">
                                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground/70 flex-wrap">
                                      <span>created by</span>
                                      <ShortAddress
                                        address={creatorAddr}
                                        network={
                                          settings.network as
                                            | "public"
                                            | "testnet"
                                        }
                                      />
                                      {distribChain.status === "idle" && (
                                        <button
                                          className="ml-1 text-[9px] uppercase tracking-wide font-semibold text-primary hover:underline"
                                          onClick={() => {
                                            const ctrl = new AbortController();
                                            realCreatorAbortRef.current = ctrl;
                                            setDistribChain({ status: "idle", chain: [] });
                                            traceChainStep(highDistrib.address, ctrl.signal, setDistribChain, resolveHorizonUrl(settings), knownIntermediaries);
                                          }}
                                        >
                                          Trace ancestry →
                                        </button>
                                      )}
                                    </div>
                                    <ChainDisplay
                                      chain={distribChain}
                                      network={settings.network}
                                      assetCode={assetCode}
                                      issuer={issuer}
                                      horizonUrl={resolveHorizonUrl(settings)}
                                      knownIntermediaryAddrs={knownIntermediarySet}
                                      onContinue={(addr) => {
                                        const ctrl = new AbortController();
                                        realCreatorAbortRef.current = ctrl;
                                        traceChainStep(addr, ctrl.signal, setDistribChain, resolveHorizonUrl(settings), knownIntermediaries);
                                      }}
                                    />
                                  </div>
                                );
                              })()}
                            <div className="pt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs font-mono font-semibold text-foreground">
                              {distribHolder && (
                                <span>
                                  {Number(distribHolder.balance).toLocaleString(
                                    undefined,
                                    { maximumFractionDigits: 2 },
                                  )}{" "}
                                  {assetCode}
                                </span>
                              )}
                              {distribXlm[highDistrib.address] !==
                                undefined && (
                                <span className="text-muted-foreground">
                                  {Number(
                                    distribXlm[highDistrib.address],
                                  ).toLocaleString(undefined, {
                                    maximumFractionDigits: 2,
                                  })}{" "}
                                  XLM
                                </span>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* Secondary details: flags */}
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-1 border-t border-border">
                  <AuthFlag
                    active={issuerInfo.authRequired}
                    label="Auth Required"
                    activeDesc="Trustlines must be approved by the issuer"
                    inactiveDesc="Trustlines can be created freely"
                  />
                  <AuthFlag
                    active={issuerInfo.authRevocable}
                    label="Auth Revocable"
                    activeDesc="Issuer can freeze asset holdings"
                    inactiveDesc="Issuer cannot freeze holdings"
                  />
                  <AuthFlag
                    active={issuerInfo.authClawbackEnabled}
                    label="Clawback"
                    activeDesc="Issuer can claw back assets from holders"
                    inactiveDesc="Clawback disabled"
                  />
                  <div
                    className="flex items-center gap-1.5 text-xs"
                    title={
                      issuerInfo.authImmutable
                        ? "Account flags are locked"
                        : "Account flags can still be modified"
                    }
                  >
                    {issuerInfo.authImmutable ? (
                      <Lock className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                    ) : (
                      <ShieldOff className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                    )}
                    <span
                      className={
                        issuerInfo.authImmutable
                          ? "text-blue-400"
                          : "text-muted-foreground"
                      }
                    >
                      {issuerInfo.authImmutable ? "Immutable" : "Mutable"}
                    </span>
                  </div>

                  {/* SAC badge */}
                  {sacDeployed !== null && (
                    <a
                      href={`/soroban?assetCode=${encodeURIComponent(assetCode)}&issuer=${encodeURIComponent(issuer)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-xs"
                      title={sacDeployed ? "Stellar Asset Contract deployed — click to view" : "SAC not yet deployed — click to deploy"}
                    >
                      <Layers className={`h-3.5 w-3.5 shrink-0 ${sacDeployed ? "text-green-400" : "text-muted-foreground/60"}`} />
                      <span className={sacDeployed ? "text-green-400" : "text-muted-foreground"}>
                        {sacDeployed ? "SAC deployed" : "No SAC"}
                      </span>
                    </a>
                  )}
                </div>

                {/* Save to Group / Open Group button */}
                {(() => {
                  const existingGroup = groups.find(
                    (g) =>
                      g.assetCode?.toUpperCase() === assetCode.toUpperCase() &&
                      g.issuer === issuer &&
                      g.network === settings.network,
                  );
                  if (existingGroup) {
                    return (
                      <a href={`/groups?open=${existingGroup.id}`} target="_blank" rel="noopener noreferrer">
                        <Button variant="outline" size="sm" className="text-xs border-green-400/40 bg-green-400/10 text-green-400 hover:bg-green-400/20">
                          <Layers className="mr-2 h-3.5 w-3.5" />
                          Open Group
                        </Button>
                      </a>
                    );
                  }
                  const highDistrib = distribCandidates.find(
                    (c) => c.confidence === "high",
                  );
                  const distribHolder = highDistrib
                    ? holders.find((h) => h.id === highDistrib.address)
                    : null;
                  const params = new URLSearchParams({
                    autoCreate: "1",
                    name: `${assetCode} Investigation`,
                    assetCode,
                    issuer,
                    network: settings.network,
                  });
                  if (issuerInfo.homeDomain)
                    params.set("issuerHomeDomain", issuerInfo.homeDomain);
                  if (highDistrib) params.set("distrib", highDistrib.address);
                  if (distribHolder?.homeDomain)
                    params.set("distribHomeDomain", distribHolder.homeDomain);
                  return (
                    <a
                      href={`/groups?${params}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button variant="outline" size="sm" className="text-xs">
                        <Layers className="mr-2 h-3.5 w-3.5" />
                        Save to Group
                      </Button>
                    </a>
                  );
                })()}

                {/* TOML button */}
                {issuerInfo.homeDomain && (
                  <div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        showToml ? setShowToml(false) : handleFetchToml()
                      }
                      disabled={tomlLoading}
                      className="text-xs"
                    >
                      {tomlLoading ? (
                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <FileText className="mr-2 h-3.5 w-3.5" />
                      )}
                      {showToml ? "Hide" : "View"} stellar.toml
                      {showToml ? (
                        <ChevronUp className="ml-2 h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="ml-2 h-3.5 w-3.5" />
                      )}
                    </Button>
                    {showToml && (
                      <div className="mt-3">
                        {tomlError && (
                          <p className="text-xs text-destructive flex items-center gap-1">
                            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                            {tomlError}
                          </p>
                        )}
                        {tomlContent && (
                          <pre className="mt-2 max-h-96 overflow-auto rounded-md border border-border bg-muted p-3 text-xs font-mono leading-relaxed whitespace-pre-wrap break-all">
                            {tomlContent}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Summary statistics */}
      {stats && !isCrawling && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Total Holders</p>
              <p className="text-lg font-bold font-mono">
                {stats.count.toLocaleString()}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Total Supply Held</p>
              <p className="text-lg font-bold font-mono">
                {stats.total.toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Highest Balance</p>
              <p className="text-lg font-bold font-mono">
                {stats.highest.toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Average Balance</p>
              <p className="text-lg font-bold font-mono">
                {stats.average.toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">
                Top 10 Concentration
              </p>
              <p className="text-lg font-bold font-mono">
                {stats.top10Pct.toFixed(1)}%
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* On-demand sections — only shown/fetched when requested */}
      {holders.length > 0 && !isCrawling && (
        <div className="space-y-3">
          {/* Buttons row */}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={handleFetchPaymentTotals}
              disabled={paymentTotalsLoading}
            >
              {paymentTotalsLoading ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <ArrowRightLeft className="mr-2 h-3.5 w-3.5" />
              )}
              Payment Totals
              {showPaymentTotals ? (
                <ChevronUp className="ml-2 h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="ml-2 h-3.5 w-3.5" />
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={handleFetchClaimable}
              disabled={claimableLoading}
            >
              {claimableLoading ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Coins className="mr-2 h-3.5 w-3.5" />
              )}
              Claimable Balances
              {showClaimable ? (
                <ChevronUp className="ml-2 h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="ml-2 h-3.5 w-3.5" />
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => setShowDistChart((v) => !v)}
            >
              <BarChart2 className="mr-2 h-3.5 w-3.5" />
              Distribution Chart
              {showDistChart ? (
                <ChevronUp className="ml-2 h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="ml-2 h-3.5 w-3.5" />
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={handleFetchAssetTrades}
              disabled={assetTradesLoading}
            >
              {assetTradesLoading ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <ArrowRightLeft className="mr-2 h-3.5 w-3.5" />
              )}
              DEX Sales
              {showAssetTrades ? (
                <ChevronUp className="ml-2 h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="ml-2 h-3.5 w-3.5" />
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={handleFetchDistribSales}
              disabled={distribSalesLoading || distribCandidates.length === 0}
              title={
                distribCandidates.length === 0
                  ? "Run the lookup first to infer the distribution address"
                  : undefined
              }
            >
              {distribSalesLoading ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Coins className="mr-2 h-3.5 w-3.5" />
              )}
              Distribution Sales
              {showDistribSales ? (
                <ChevronUp className="ml-2 h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="ml-2 h-3.5 w-3.5" />
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() =>
                router.push(
                  `/bulk-payments?assets=${encodeURIComponent(`${assetCode}:${issuer}`)}`,
                )
              }
            >
              <Megaphone className="mr-2 h-3.5 w-3.5" />
              Send to Holders
            </Button>
          </div>

          {/* Payment totals */}
          {showPaymentTotals && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
                  Payment Totals (from Issuer)
                </CardTitle>
                <CardDescription>
                  Total {assetCode} sent from the issuer account, broken down by
                  recipient.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {paymentTotalsError && (
                  <p className="text-xs text-destructive">
                    {paymentTotalsError}
                  </p>
                )}
                {paymentTotalsLoading && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Scanning all issuer payments…
                  </div>
                )}
                {paymentTotals && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                      <div>
                        <p className="text-xs text-muted-foreground">
                          Total Ever Sent
                        </p>
                        <p className="text-lg font-bold font-mono">
                          {paymentTotals.totalSentByIssuer.toLocaleString(
                            undefined,
                            { maximumFractionDigits: 2 },
                          )}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">
                          Via Tracked Addresses
                        </p>
                        <p className="text-lg font-bold font-mono">
                          {paymentTotals.byAddress
                            .reduce((s, a) => s + a.total, 0)
                            .toLocaleString(undefined, {
                              maximumFractionDigits: 2,
                            })}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">
                          Via Other Addresses
                        </p>
                        <p className="text-lg font-bold font-mono">
                          {paymentTotals.otherTotal.toLocaleString(undefined, {
                            maximumFractionDigits: 2,
                          })}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {paymentTotals.otherCount} payments
                        </p>
                      </div>
                    </div>
                    {paymentTotals.byAddress.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground uppercase">
                          Tracked (distrib candidates)
                        </p>
                        {paymentTotals.byAddress.map((a) => (
                          <div
                            key={a.address}
                            className="flex items-center justify-between gap-2 text-xs border border-border rounded p-2"
                          >
                            <ShortAddress address={a.address} role="distrib" />
                            <div className="text-right">
                              <span className="font-mono font-semibold">
                                {a.total.toLocaleString(undefined, {
                                  maximumFractionDigits: 2,
                                })}{" "}
                                {assetCode}
                              </span>
                              <span className="text-muted-foreground ml-2">
                                ({a.count} payments)
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Claimable balances */}
          {showClaimable && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Coins className="h-4 w-4 text-muted-foreground" />
                  Claimable Balances
                </CardTitle>
              </CardHeader>
              <CardContent>
                {claimableError && (
                  <p className="text-xs text-destructive">{claimableError}</p>
                )}
                {claimableLoading && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Fetching…
                  </div>
                )}
                {claimable && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground">Count</p>
                      <p className="text-lg font-bold font-mono">
                        {claimable.count.toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Total Amount
                      </p>
                      <p className="text-lg font-bold font-mono">
                        {claimable.totalAmount.toLocaleString(undefined, {
                          maximumFractionDigits: 2,
                        })}{" "}
                        {assetCode}
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Distribution chart */}
          {showDistChart && stats && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart2 className="h-4 w-4 text-muted-foreground" />
                  Holder Concentration
                </CardTitle>
                <CardDescription>Supply share by holder group.</CardDescription>
              </CardHeader>
              <CardContent>
                {(() => {
                  const sorted = [...holders].sort(
                    (a, b) => parseFloat(b.balance) - parseFloat(a.balance),
                  );
                  const total = stats.total;
                  const groups = [
                    { label: "#1", bal: parseFloat(sorted[0]?.balance ?? "0") },
                    {
                      label: "#2–5",
                      bal: sorted
                        .slice(1, 5)
                        .reduce((s, h) => s + parseFloat(h.balance), 0),
                    },
                    {
                      label: "#6–10",
                      bal: sorted
                        .slice(5, 10)
                        .reduce((s, h) => s + parseFloat(h.balance), 0),
                    },
                    {
                      label: "#11–50",
                      bal: sorted
                        .slice(10, 50)
                        .reduce((s, h) => s + parseFloat(h.balance), 0),
                    },
                    {
                      label: "Rest",
                      bal: sorted
                        .slice(50)
                        .reduce((s, h) => s + parseFloat(h.balance), 0),
                    },
                  ];
                  const colors = [
                    "bg-blue-500",
                    "bg-violet-500",
                    "bg-yellow-500",
                    "bg-orange-400",
                    "bg-muted-foreground/40",
                  ];
                  return (
                    <div className="space-y-2">
                      {groups.map((g, i) => {
                        const pct = total > 0 ? (g.bal / total) * 100 : 0;
                        return (
                          <div
                            key={g.label}
                            className="flex items-center gap-3 text-xs"
                          >
                            <span className="w-14 text-right text-muted-foreground shrink-0">
                              {g.label}
                            </span>
                            <div className="flex-1 h-5 bg-muted rounded overflow-hidden">
                              <div
                                className={`h-full ${colors[i]} rounded`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="w-12 text-right font-mono tabular-nums">
                              {pct.toFixed(1)}%
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          )}

          {/* DEX Sales */}
          {showAssetTrades && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
                  DEX Sales — {assetCode} sold for XLM
                </CardTitle>
                <CardDescription>
                  Every trade where {assetCode} was exchanged for XLM on the
                  Stellar DEX — across all sellers, not just distributors.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {assetTradesLoading && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                    <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                    {assetTradesProgress ?? "Scanning trades…"}
                  </div>
                )}
                {assetTradesError && (
                  <p className="text-xs text-destructive">{assetTradesError}</p>
                )}
                {assetTrades &&
                  !assetTradesLoading &&
                  (() => {
                    const distribTotal = assetTrades.byAccount.reduce(
                      (s, a) => s + a.assetSold,
                      0,
                    );
                    const othersTotal = Math.max(
                      0,
                      assetTrades.totalAssetSold - distribTotal,
                    );
                    const distribXlm = assetTrades.byAccount.reduce(
                      (s, a) => s + a.xlmReceived,
                      0,
                    );
                    const othersXlm = Math.max(
                      0,
                      assetTrades.totalXlmReceived - distribXlm,
                    );
                    const distribPct =
                      assetTrades.totalAssetSold > 0
                        ? (distribTotal / assetTrades.totalAssetSold) * 100
                        : 0;
                    const othersPct = 100 - distribPct;

                    return (
                      <div className="space-y-5">
                        {/* ── Global total ── */}
                        <div className="space-y-1">
                          <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide">
                            Total sold (all addresses)
                          </p>
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                            <span className="font-mono font-bold text-lg tabular-nums">
                              {assetTrades.totalAssetSold.toLocaleString(
                                undefined,
                                { maximumFractionDigits: 2 },
                              )}{" "}
                              <span className="text-sm font-semibold">
                                {assetCode}
                              </span>
                            </span>
                            <span className="text-muted-foreground text-sm">
                              →
                            </span>
                            <span className="font-mono font-bold text-lg tabular-nums">
                              {assetTrades.totalXlmReceived.toLocaleString(
                                undefined,
                                { maximumFractionDigits: 2 },
                              )}{" "}
                              <span className="text-sm font-semibold">XLM</span>
                            </span>
                            {xlmUsdPrice !== null && (
                              <span className="text-muted-foreground text-xs">
                                ≈{" "}
                                <span className="font-semibold text-foreground">
                                  $
                                  {(
                                    assetTrades.totalXlmReceived * xlmUsdPrice
                                  ).toLocaleString(undefined, {
                                    maximumFractionDigits: 2,
                                  })}
                                </span>{" "}
                                USD
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {assetTrades.tradeCount.toLocaleString()} trades ·{" "}
                            avg{" "}
                            <span className="font-mono text-foreground">
                              {assetTrades.avgPrice.toLocaleString(undefined, {
                                maximumFractionDigits: 7,
                              })}{" "}
                              XLM
                            </span>
                            {xlmUsdPrice !== null && (
                              <span>
                                {" "}
                                (≈ $
                                {(
                                  assetTrades.avgPrice * xlmUsdPrice
                                ).toLocaleString(undefined, {
                                  maximumFractionDigits: 6,
                                })}
                                )
                              </span>
                            )}{" "}
                            per {assetCode}
                          </p>
                        </div>

                        {/* ── Who sold it? distrib vs others ── */}
                        <div className="space-y-2">
                          <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide">
                            Who sold it?
                          </p>
                          {/* Stacked bar */}
                          <div className="flex h-5 w-full rounded overflow-hidden text-[10px] font-semibold">
                            {distribPct > 0 && (
                              <div
                                className="flex items-center justify-center bg-blue-500/80 text-white overflow-hidden"
                                style={{ width: `${distribPct}%` }}
                                title={`Distrib: ${distribPct.toFixed(1)}%`}
                              >
                                {distribPct > 8
                                  ? `${distribPct.toFixed(1)}%`
                                  : ""}
                              </div>
                            )}
                            {othersPct > 0 && (
                              <div
                                className="flex items-center justify-center bg-muted-foreground/30 text-muted-foreground overflow-hidden"
                                style={{ width: `${othersPct}%` }}
                                title={`Others: ${othersPct.toFixed(1)}%`}
                              >
                                {othersPct > 8
                                  ? `${othersPct.toFixed(1)}%`
                                  : ""}
                              </div>
                            )}
                          </div>
                          {/* Legend rows */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                            <div className="flex items-center gap-2 rounded-md border border-blue-500/30 bg-blue-500/5 p-2">
                              <span className="h-2.5 w-2.5 rounded-sm bg-blue-500/80 shrink-0" />
                              <div className="min-w-0">
                                <p className="font-semibold">
                                  Distrib addresses
                                </p>
                                <p className="font-mono tabular-nums text-muted-foreground">
                                  {distribTotal.toLocaleString(undefined, {
                                    maximumFractionDigits: 2,
                                  })}{" "}
                                  {assetCode}
                                  {" · "}
                                  {distribXlm.toLocaleString(undefined, {
                                    maximumFractionDigits: 2,
                                  })}{" "}
                                  XLM
                                  {xlmUsdPrice !== null &&
                                    ` · ≈$${(distribXlm * xlmUsdPrice).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-2">
                              <span className="h-2.5 w-2.5 rounded-sm bg-muted-foreground/40 shrink-0" />
                              <div className="min-w-0">
                                <p className="font-semibold">Other holders</p>
                                <p className="font-mono tabular-nums text-muted-foreground">
                                  {othersTotal.toLocaleString(undefined, {
                                    maximumFractionDigits: 2,
                                  })}{" "}
                                  {assetCode}
                                  {" · "}
                                  {othersXlm.toLocaleString(undefined, {
                                    maximumFractionDigits: 2,
                                  })}{" "}
                                  XLM
                                  {xlmUsdPrice !== null &&
                                    ` · ≈$${(othersXlm * xlmUsdPrice).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                                </p>
                              </div>
                            </div>
                          </div>
                          {assetTrades.byAccount.length === 0 && (
                            <p className="text-xs text-muted-foreground italic">
                              No tracked distributor addresses — run distributor
                              detection first to see the split.
                            </p>
                          )}

                          {/* Other sellers ranked list */}
                          {assetTrades.otherSellers.length > 0 && (
                            <div className="space-y-1.5 pt-1">
                              <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide">
                                Other sellers — ranked by amount sold
                              </p>
                              <div className="space-y-1">
                                {assetTrades.otherSellers
                                  .slice(0, 10)
                                  .map((s, i) => {
                                    const share =
                                      assetTrades.totalAssetSold > 0
                                        ? (s.assetSold /
                                            assetTrades.totalAssetSold) *
                                          100
                                        : 0;
                                    return (
                                      <div
                                        key={s.address}
                                        className="flex items-center gap-2 text-xs"
                                      >
                                        <span className="w-5 shrink-0 text-right text-muted-foreground/50 font-mono">
                                          {i + 1}.
                                        </span>
                                        <ShortAddress address={s.address} />
                                        <div className="flex-1 h-3 bg-muted rounded overflow-hidden">
                                          <div
                                            className="h-full bg-muted-foreground/40 rounded"
                                            style={{ width: `${share}%` }}
                                          />
                                        </div>
                                        <span className="shrink-0 font-mono tabular-nums text-right w-28">
                                          {s.assetSold.toLocaleString(
                                            undefined,
                                            { maximumFractionDigits: 2 },
                                          )}{" "}
                                          {assetCode}
                                        </span>
                                        <span className="shrink-0 text-muted-foreground w-12 text-right tabular-nums">
                                          {share.toFixed(1)}%
                                        </span>
                                        <span className="shrink-0 font-mono text-muted-foreground tabular-nums text-right w-24">
                                          avg{" "}
                                          {s.avgPrice.toLocaleString(
                                            undefined,
                                            { maximumFractionDigits: 6 },
                                          )}{" "}
                                          XLM
                                        </span>
                                      </div>
                                    );
                                  })}
                                {assetTrades.otherSellers.length > 10 && (
                                  <p className="text-xs text-muted-foreground pl-7">
                                    …and{" "}
                                    {(
                                      assetTrades.otherSellers.length - 10
                                    ).toLocaleString()}{" "}
                                    more addresses
                                  </p>
                                )}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* ── Global price histogram ── */}
                        {assetTrades.priceBuckets.length > 0 && (
                          <div className="space-y-1.5">
                            <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide">
                              At what prices was it sold?
                            </p>
                            <PriceHistogram
                              buckets={assetTrades.priceBuckets}
                              xlmUsdPrice={xlmUsdPrice}
                            />
                          </div>
                        )}

                        {/* ── Per-distrib breakdown ── */}
                        {assetTrades.byAccount.length > 0 && (
                          <div className="space-y-3">
                            <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide">
                              Per-distributor detail
                            </p>
                            {assetTrades.byAccount.map((acc) => {
                              const share =
                                assetTrades.totalAssetSold > 0
                                  ? (acc.assetSold /
                                      assetTrades.totalAssetSold) *
                                    100
                                  : 0;
                              return (
                                <div
                                  key={acc.address}
                                  className="rounded-md border border-border p-3 space-y-2"
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <ShortAddress
                                      address={acc.address}
                                      role="distrib"
                                    />
                                    <span className="text-xs text-muted-foreground">
                                      {acc.tradeCount.toLocaleString()} trades ·{" "}
                                      <span className="font-semibold text-foreground">
                                        {share.toFixed(1)}% of total sales
                                      </span>
                                    </span>
                                  </div>
                                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
                                    <span>
                                      <span className="text-muted-foreground">
                                        Sold{" "}
                                      </span>
                                      <span className="text-muted-foreground/50 text-[10px]">
                                        (filled trades only){" "}
                                      </span>
                                      <span className="font-mono font-semibold tabular-nums">
                                        {acc.assetSold.toLocaleString(
                                          undefined,
                                          { maximumFractionDigits: 2 },
                                        )}{" "}
                                        {assetCode}
                                      </span>
                                    </span>
                                    {(acc.openOfferAmount ?? 0) > 0 && (
                                      <span>
                                        <span className="text-muted-foreground">
                                          Still in open offers:{" "}
                                        </span>
                                        <span className="font-mono font-semibold tabular-nums text-yellow-500">
                                          {acc.openOfferAmount!.toLocaleString(
                                            undefined,
                                            { maximumFractionDigits: 2 },
                                          )}{" "}
                                          {assetCode}
                                        </span>
                                      </span>
                                    )}
                                    <span>
                                      <span className="text-muted-foreground">
                                        XLM received{" "}
                                      </span>
                                      <span className="text-muted-foreground/50 text-[10px]">
                                        (filled trades only){" "}
                                      </span>
                                      <span className="font-mono font-semibold tabular-nums">
                                        {acc.xlmReceived.toLocaleString(
                                          undefined,
                                          { maximumFractionDigits: 4 },
                                        )}{" "}
                                        XLM
                                      </span>
                                      {xlmUsdPrice !== null && (
                                        <span className="text-muted-foreground ml-1">
                                          (≈ $
                                          {(
                                            acc.xlmReceived * xlmUsdPrice
                                          ).toLocaleString(undefined, {
                                            maximumFractionDigits: 0,
                                          })}
                                          )
                                        </span>
                                      )}
                                    </span>
                                    <span>
                                      <span className="text-muted-foreground">
                                        Avg price:{" "}
                                      </span>
                                      <span className="font-mono font-semibold tabular-nums">
                                        {acc.avgPrice.toLocaleString(
                                          undefined,
                                          { maximumFractionDigits: 7 },
                                        )}{" "}
                                        XLM
                                      </span>
                                    </span>
                                  </div>
                                  {acc.priceBuckets.length > 1 && (
                                    <PriceHistogram
                                      buckets={acc.priceBuckets}
                                      xlmUsdPrice={xlmUsdPrice}
                                    />
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })()}
              </CardContent>
            </Card>
          )}

          {/* Distribution Sales */}
          {showDistribSales && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Coins className="h-4 w-4 text-muted-foreground" />
                  Distribution Sales — XLM Proceeds
                </CardTitle>
                <CardDescription>
                  All-time {assetCode}→XLM sales from the primary distribution
                  address ({distribCandidates[0]?.address}), and where the XLM
                  was sent.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {distribSalesLoading && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                    <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                    {distribSalesProgress ?? "Scanning…"}
                  </div>
                )}
                {distribSalesError && (
                  <p className="text-xs text-destructive">
                    {distribSalesError}
                  </p>
                )}
                {distribSales && !distribSalesLoading && (
                  <div className="space-y-5">
                    {/* Summary stats */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="rounded-md border bg-muted/30 p-3">
                        <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide">
                          Total XLM Proceeds
                        </p>
                        <p className="text-lg font-bold font-mono tabular-nums mt-0.5">
                          {distribSales.totalXlmProceeds.toLocaleString(
                            undefined,
                            { maximumFractionDigits: 2 },
                          )}
                        </p>
                        {xlmUsdPrice !== null && (
                          <p className="text-[11px] text-muted-foreground">
                            ≈ $
                            {(
                              distribSales.totalXlmProceeds * xlmUsdPrice
                            ).toLocaleString(undefined, {
                              maximumFractionDigits: 0,
                            })}
                          </p>
                        )}
                      </div>
                      <div className="rounded-md border bg-muted/30 p-3">
                        <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide">
                          {assetCode} Sold
                        </p>
                        <p className="text-lg font-bold font-mono tabular-nums mt-0.5">
                          {distribSales.totalAssetSold.toLocaleString(
                            undefined,
                            { maximumFractionDigits: 2 },
                          )}
                        </p>
                      </div>
                      <div className="rounded-md border bg-muted/30 p-3">
                        <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide">
                          Total Outgoing XLM
                        </p>
                        <p className="text-lg font-bold font-mono tabular-nums mt-0.5">
                          {distribSales.totalOutgoingXlm.toLocaleString(
                            undefined,
                            { maximumFractionDigits: 2 },
                          )}
                        </p>
                      </div>
                      <div className="rounded-md border bg-muted/30 p-3">
                        <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide">
                          Est. On-Hand
                        </p>
                        <p className="text-lg font-bold font-mono tabular-nums mt-0.5">
                          {distribSales.estimatedOnHandXlm.toLocaleString(
                            undefined,
                            { maximumFractionDigits: 2 },
                          )}
                        </p>
                        {xlmUsdPrice !== null && (
                          <p className="text-[11px] text-muted-foreground">
                            ≈ $
                            {(
                              distribSales.estimatedOnHandXlm * xlmUsdPrice
                            ).toLocaleString(undefined, {
                              maximumFractionDigits: 0,
                            })}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Top destinations */}
                    {distribSales.topDestinations.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide">
                          Where the XLM was sent
                        </p>
                        <div className="overflow-x-auto border rounded-md">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b bg-muted/40">
                                <th className="text-left px-3 py-2">
                                  Destination
                                </th>
                                <th className="text-right px-3 py-2">XLM</th>
                                <th className="text-right px-3 py-2">
                                  % of Proceeds
                                </th>
                                <th className="text-right px-3 py-2">Txns</th>
                              </tr>
                            </thead>
                            <tbody>
                              {distribSales.topDestinations.map((row) => (
                                <tr
                                  key={row.address}
                                  className="border-b last:border-0"
                                >
                                  <td className="px-3 py-2 text-xs">
                                    <ShortAddress
                                      address={row.address}
                                      network={settings.network}
                                    />
                                  </td>
                                  <td className="px-3 py-2 text-right tabular-nums">
                                    {row.totalXlm.toLocaleString(undefined, {
                                      maximumFractionDigits: 2,
                                    })}
                                  </td>
                                  <td className="px-3 py-2 text-right tabular-nums">
                                    {distribSales.totalXlmProceeds > 0
                                      ? (
                                          (row.totalXlm /
                                            distribSales.totalXlmProceeds) *
                                          100
                                        ).toFixed(2)
                                      : "0.00"}
                                    %
                                  </td>
                                  <td className="px-3 py-2 text-right tabular-nums">
                                    {row.count}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {distribCandidates.length > 0 && (
                  <div className="pt-3 border-t flex justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs gap-1.5"
                      onClick={() => {
                        const primary = distribCandidates[0].address;
                        const params = new URLSearchParams({
                          asset: assetCode,
                          issuer,
                          account: primary,
                          autorun: "1",
                        });
                        router.push(`/asset-sales?${params.toString()}`);
                      }}
                    >
                      <ExternalLink className="h-3 w-3" />
                      View full data in Asset Sales
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Distribution address inference */}
      {(isInferring || distribCandidates.length > 0 || distribError) &&
        !isCrawling && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trophy className="h-5 w-5 text-yellow-500" />
                Distribution Address Candidates
              </CardTitle>
              <CardDescription className="flex items-start gap-1.5">
                <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                Ranked by two on-chain heuristics: top holder by balance share
                and largest recipient of issuer outbound payments. Verify before
                trusting.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isInferring && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Scanning issuer payment history (full depth)…
                </div>
              )}
              {distribError && (
                <div className="flex items-center gap-2 text-sm text-destructive py-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {distribError}
                </div>
              )}
              {!isInferring &&
                distribCandidates.length === 0 &&
                !distribError && (
                  <p className="text-sm text-muted-foreground py-4">
                    No strong candidates found.
                  </p>
                )}
              {distribCandidates.length > 0 && (
                <div className="space-y-3">
                  {distribCandidates.map((c, i) => (
                    <div
                      key={c.address}
                      className="rounded-md border border-border p-3 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-start gap-2 flex-col min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-muted-foreground w-5">
                              #{i + 1}
                            </span>
                            <ShortAddress
                              address={c.address}
                              role={
                                c.confidence === "high" ? "distrib" : undefined
                              }
                            />
                          </div>
                          {distribCreators[c.address] && (
                            <div className="flex items-center gap-1 pl-7 text-[10px] text-muted-foreground/70">
                              <span>created by</span>
                              <ShortAddress
                                address={distribCreators[c.address]}
                              />
                            </div>
                          )}
                        </div>
                        <span
                          className={`text-xs font-semibold uppercase ${
                            c.confidence === "high"
                              ? "text-green-500"
                              : c.confidence === "medium"
                                ? "text-yellow-500"
                                : "text-muted-foreground"
                          }`}
                        >
                          {c.confidence} confidence
                        </span>
                      </div>
                      <ul className="space-y-1 pl-7">
                        {c.reasons.map((r) => (
                          <li
                            key={r}
                            className="text-xs text-muted-foreground flex items-start gap-1.5"
                          >
                            <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-muted-foreground/50 shrink-0" />
                            {r}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

      {/* Results table */}
      {holders.length > 0 && !isCrawling && (
        <Card>
          <CardHeader>
            <CardTitle>All Holders</CardTitle>
            <CardDescription>
              {holders.length.toLocaleString()} total holder
              {holders.length !== 1 ? "s" : ""}. Distributor candidates are
              highlighted.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Filter + Export */}
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground shrink-0" />
              <Input
                placeholder="Filter by account ID or domain..."
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                className="max-w-sm font-mono text-xs"
              />
              {filterText && (
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {displayedHolders.length} of {holders.length} shown
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                className="ml-auto shrink-0"
                onClick={() =>
                  downloadCSV(
                    `asset-holders-${assetCode}.csv`,
                    [
                      "Rank",
                      "Account",
                      "Balance",
                      "% of Total",
                      "Limit",
                      "Domain",
                      "Is Distributor",
                    ],
                    displayedHolders.map((h) => {
                      const rank = String(rankMap.get(h.id) ?? "");
                      const pct =
                        stats && stats.total > 0
                          ? (
                              (parseFloat(h.balance) / stats.total) *
                              100
                            ).toFixed(2) + "%"
                          : "";
                      return [
                        rank,
                        h.id,
                        h.balance,
                        pct,
                        h.limit ?? "Unlimited",
                        h.homeDomain ?? "",
                        distribAddressSet.has(h.id) ? "Yes" : "No",
                      ];
                    }),
                  )
                }
              >
                <Download className="mr-2 h-3.5 w-3.5" />
                Export CSV
              </Button>
            </div>

            {/* Table */}
            {(() => {
              const PAGE = 5;
              const visibleHolders = showAllHolders
                ? displayedHolders
                : displayedHolders.slice(0, PAGE);
              const hidden = displayedHolders.length - visibleHolders.length;
              return (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">
                          <button
                            className="flex items-center text-xs font-medium hover:text-foreground transition-colors"
                            onClick={() => toggleSort("rank")}
                          >
                            #<SortIcon field="rank" />
                          </button>
                        </TableHead>
                        <TableHead>
                          <button
                            className="flex items-center text-xs font-medium hover:text-foreground transition-colors"
                            onClick={() => toggleSort("account")}
                          >
                            Account
                            <SortIcon field="account" />
                          </button>
                        </TableHead>
                        {anyHasDomain && (
                          <TableHead className="text-left">
                            <span className="text-xs font-medium">Domain</span>
                          </TableHead>
                        )}
                        <TableHead className="text-right">
                          <button
                            className="ml-auto flex items-center text-xs font-medium hover:text-foreground transition-colors"
                            onClick={() => toggleSort("balance")}
                          >
                            Balance
                            <SortIcon field="balance" />
                          </button>
                        </TableHead>
                        <TableHead className="text-right">
                          <span className="text-xs font-medium">
                            % of Total
                          </span>
                        </TableHead>
                        <TableHead className="text-right">
                          <span className="text-xs font-medium">Limit</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleHolders.map((holder) => {
                        const rank = rankMap.get(holder.id);
                        const pct =
                          stats && stats.total > 0
                            ? (
                                (parseFloat(holder.balance) / stats.total) *
                                100
                              ).toFixed(2)
                            : null;
                        const candidate = distribAddressMap.get(holder.id);
                        const isDistrib = !!candidate;

                        return (
                          <TableRow
                            key={holder.id}
                            className={
                              isDistrib
                                ? "bg-yellow-500/5 border-l-2 border-l-yellow-500/60"
                                : undefined
                            }
                          >
                            <TableCell className="text-xs text-muted-foreground font-mono tabular-nums">
                              {rank}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              <ShortAddress
                                address={holder.id}
                                role={
                                  holder.id === issuer
                                    ? "issuer"
                                    : candidate?.confidence === "high"
                                      ? "distrib"
                                      : undefined
                                }
                              />
                            </TableCell>
                            {anyHasDomain && (
                              <TableCell className="text-xs text-muted-foreground">
                                {holder.homeDomain ? (
                                  <span className="flex items-center gap-1.5">
                                    {domainStatus[holder.homeDomain] ===
                                      "checking" && (
                                      <span
                                        className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 animate-pulse shrink-0"
                                        title="Checking…"
                                      />
                                    )}
                                    {domainStatus[holder.homeDomain] ===
                                      "up" && (
                                      <span
                                        className="h-1.5 w-1.5 rounded-full bg-green-500 shrink-0"
                                        title="Domain reachable"
                                      />
                                    )}
                                    {domainStatus[holder.homeDomain] ===
                                      "down" && (
                                      <span
                                        className="h-1.5 w-1.5 rounded-full bg-red-500 shrink-0"
                                        title="Domain unreachable"
                                      />
                                    )}
                                    {holder.homeDomain}
                                  </span>
                                ) : (
                                  "—"
                                )}
                              </TableCell>
                            )}
                            <TableCell className="text-right font-mono text-xs tabular-nums">
                              {Number(holder.balance).toLocaleString(
                                undefined,
                                {
                                  maximumFractionDigits: 7,
                                },
                              )}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                              {pct !== null ? `${pct}%` : "—"}
                            </TableCell>
                            <TableCell className="text-right text-muted-foreground text-xs">
                              {holder.limit ?? "Unlimited"}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {displayedHolders.length === 0 && filterText && (
                        <TableRow>
                          <TableCell
                            colSpan={anyHasDomain ? 6 : 5}
                            className="text-center text-muted-foreground text-sm py-8"
                          >
                            No holders match the filter.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                  {hidden > 0 && (
                    <button
                      onClick={() => setShowAllHolders(true)}
                      className="w-full py-2 text-xs text-muted-foreground hover:text-foreground transition-colors border border-dashed border-border rounded-md"
                    >
                      Show {hidden.toLocaleString()} more holders
                    </button>
                  )}
                  {showAllHolders && displayedHolders.length > PAGE && (
                    <button
                      onClick={() => setShowAllHolders(false)}
                      className="w-full py-2 text-xs text-muted-foreground hover:text-foreground transition-colors border border-dashed border-border rounded-md"
                    >
                      Collapse
                    </button>
                  )}
                </>
              );
            })()}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
