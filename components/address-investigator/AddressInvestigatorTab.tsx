"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Horizon, StrKey } from "stellar-sdk";
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
  ArrowDownUp,
  CheckCircle2,
  ChevronDown,
  Clock,
  Download,
  ExternalLink,
  Gift,
  Globe,
  Loader2,
  Search,
  X,
  XCircle,
} from "lucide-react";
import { useActiveWallet } from "@/hooks/use-active-wallet";
import {
  useSettings,
  resolveHorizonUrl,
  type Network,
} from "@/lib/settings";
import {
  formatAsset,
  formatBalance,
  getErrorMessage,
  timeAgo,
} from "@/lib/stellar-helpers";
import { shortAddr, formatXlm } from "@/lib/format";
import { ShortAddress } from "@/components/shared/ShortAddress";
import { useSavedSearches } from "@/hooks/use-saved-searches";
import { useKnownIntermediaries } from "@/hooks/use-known-intermediaries";
import { useAssetGroups } from "@/hooks/use-asset-groups";
import type { GroupMemberRole } from "@/lib/asset-groups/types";
import { ROLE_LABELS } from "@/lib/asset-groups/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  addressHistoryGetSnapshot,
  useAddressHistory,
} from "@/components/address-investigator/useAddressHistory";
import { downloadCSV } from "@/lib/csv-export";
import { fetchAddressInvestigation } from "@/lib/proceeds-investigator/fetchers";
import type { AddressInvestigationResult } from "@/lib/proceeds-investigator/types";
import {
  ChainDisplay,
  ChainState,
  traceChainStep,
} from "@/components/shared/ChainDisplay";
import { ProceedsDestinationsTable } from "@/components/shared/proceeds/ProceedsDestinationsTable";

const DISPLAY_PAGE_SIZE = 10;
const CLAIMABLE_DISPLAY_PAGE_SIZE = 5;
const FETCH_PAGE_SIZE = 200;

type OpCategory = "payments" | "offers" | "trust" | "admin" | "other";

const CATEGORY_MAP: Record<string, OpCategory> = {
  create_account: "payments",
  payment: "payments",
  path_payment_strict_receive: "payments",
  path_payment_strict_send: "payments",
  manage_sell_offer: "offers",
  manage_buy_offer: "offers",
  create_passive_sell_offer: "offers",
  change_trust: "trust",
  allow_trust: "trust",
  set_trust_line_flags: "trust",
  set_options: "admin",
  account_merge: "admin",
  bump_sequence: "admin",
  manage_data: "admin",
  create_claimable_balance: "admin",
  claim_claimable_balance: "admin",
  begin_sponsoring_future_reserves: "admin",
  end_sponsoring_future_reserves: "admin",
  revoke_sponsorship: "admin",
  clawback: "admin",
  clawback_claimable_balance: "admin",
  liquidity_pool_deposit: "offers",
  liquidity_pool_withdraw: "offers",
  invoke_host_function: "other",
  extend_footprint_ttl: "other",
  restore_footprint: "other",
};

const CATEGORY_LABELS: Record<OpCategory | "all", string> = {
  all: "All",
  payments: "Payments",
  offers: "Buy/Sell Offers",
  trust: "Trustlines",
  admin: "Admin",
  other: "Other",
};

interface OpDisplay {
  id: string;
  pagingToken: string;
  type: string;
  typeLabel: string;
  category: OpCategory;
  action: string;
  details: string;
  pair?: string;
  price?: string;
  description: string;
  amount?: string;
  asset?: string;
  from?: string;
  to?: string;
  createdAt: string;
  successful: boolean;
  transactionHash: string;
  paymentAssetKind?: "xlm" | "other";
  paymentAssetType?: string;
  paymentAssetCode?: string;
  paymentAssetIssuer?: string;
}

interface TrustlineAssetOption {
  value: string;
  label: string;
  code: string;
  issuer: string;
}

interface BalanceTrustlineRow {
  id: string;
  asset: string;
  issuer?: string;
  balance: string;
  limit?: string;
  buyingLiabilities?: string;
  sellingLiabilities?: string;
  authorization?: string;
}

interface OperationsFetchSummary {
  operations: OpDisplay[];
  pages: number;
  records: number;
  complete: boolean;
  warning?: string;
}

interface ClaimableBalanceRow {
  id: string;
  amount: string;
  asset: string;
  sponsor: string;
  claimants: string[];
  lastModifiedTime: string;
}

interface ClaimableBalancesFetchSummary {
  rows: ClaimableBalanceRow[];
  complete: boolean;
  warning?: string;
}

function categorize(type: string): OpCategory {
  return CATEGORY_MAP[type] ?? "other";
}

function typeLabel(type: string): string {
  const labels: Record<string, string> = {
    create_account: "Create Account",
    payment: "Payment",
    path_payment_strict_receive: "Path Payment",
    path_payment_strict_send: "Path Payment",
    manage_sell_offer: "Sell Offer",
    manage_buy_offer: "Buy Offer",
    create_passive_sell_offer: "Passive Offer",
    change_trust: "Change Trust",
    allow_trust: "Allow Trust",
    set_trust_line_flags: "Trust Flags",
    set_options: "Set Options",
    account_merge: "Account Merge",
  };
  return (
    labels[type] ??
    type
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}

function resolveAssetName(
  r: Record<string, unknown>,
  prefix = "asset",
): string {
  const assetType = r[`${prefix}_type`] as string | undefined;
  const assetCode = r[`${prefix}_code`] as string | undefined;
  return formatAsset(assetType ?? "native", assetCode);
}

function resolveAssetWithIssuer(
  r: Record<string, unknown>,
  prefix = "asset",
): string {
  const assetType = r[`${prefix}_type`] as string | undefined;
  if (assetType === "native") return "XLM";
  const assetCode = String(r[`${prefix}_code`] ?? "");
  const assetIssuer = String(r[`${prefix}_issuer`] ?? "");
  if (!assetCode) return "unknown";
  if (!assetIssuer) return assetCode;
  return `${assetCode}:${shortAddr(assetIssuer)}`;
}

function describeOperation(r: Record<string, unknown>): {
  description: string;
  amount?: string;
  asset?: string;
  from?: string;
  to?: string;
} {
  const type = String(r.type ?? "");

  switch (type) {
    case "create_account":
      return {
        description: `Create account with ${r.starting_balance} XLM`,
        amount: String(r.starting_balance ?? ""),
        asset: "XLM",
        from: String(r.funder ?? ""),
        to: String(r.account ?? ""),
      };
    case "payment":
      return {
        description: `Send ${formatBalance(String(r.amount ?? "0"))} ${resolveAssetName(r)}`,
        amount: String(r.amount ?? ""),
        asset: resolveAssetName(r),
        from: String(r.from ?? ""),
        to: String(r.to ?? ""),
      };
    case "path_payment_strict_receive":
    case "path_payment_strict_send": {
      const sourceAsset = resolveAssetName(r, "source_asset");
      const destAsset = resolveAssetName(r);
      return {
        description: `Path payment ${formatBalance(String(r.source_amount ?? "0"))} ${sourceAsset} → ${formatBalance(String(r.amount ?? "0"))} ${destAsset}`,
        amount: String(r.amount ?? ""),
        asset: destAsset,
        from: String(r.from ?? ""),
        to: String(r.to ?? ""),
      };
    }
    case "manage_sell_offer":
      if (String(r.amount ?? "") === "0") {
        return {
          description: `Cancel sell offer ${resolveAssetWithIssuer(r, "selling")} / ${resolveAssetWithIssuer(r, "buying")}`,
          from: String(r.source_account ?? ""),
        };
      }
      return {
        description: `Sell ${formatBalance(String(r.amount ?? "0"))} ${resolveAssetWithIssuer(r, "selling")} for ${resolveAssetWithIssuer(r, "buying")} @ ${String(r.price ?? "?")}`,
        amount: String(r.amount ?? ""),
        asset: resolveAssetWithIssuer(r, "selling"),
        from: String(r.source_account ?? ""),
      };
    case "manage_buy_offer":
      if (String(r.amount ?? "") === "0") {
        return {
          description: `Cancel buy offer ${resolveAssetWithIssuer(r, "buying")} / ${resolveAssetWithIssuer(r, "selling")}`,
          from: String(r.source_account ?? ""),
        };
      }
      return {
        description: `Buy ${formatBalance(String(r.amount ?? "0"))} ${resolveAssetWithIssuer(r, "buying")} with ${resolveAssetWithIssuer(r, "selling")} @ ${String(r.price ?? "?")}`,
        amount: String(r.amount ?? ""),
        asset: resolveAssetWithIssuer(r, "buying"),
        from: String(r.source_account ?? ""),
      };
    case "create_passive_sell_offer":
      return {
        description: `Passive sell ${formatBalance(String(r.amount ?? "0"))} ${resolveAssetWithIssuer(r, "selling")} for ${resolveAssetWithIssuer(r, "buying")} @ ${String(r.price ?? "?")}`,
        amount: String(r.amount ?? ""),
        asset: resolveAssetWithIssuer(r, "selling"),
        from: String(r.source_account ?? ""),
      };
    case "change_trust": {
      const asset = resolveAssetWithIssuer(r);
      const limit = String(r.limit ?? "");
      const issuer = String(r.asset_issuer ?? "");
      if (limit === "0") {
        return {
          description: `Remove trustline for ${asset}`,
          asset,
          from: String(r.source_account ?? ""),
          to: issuer,
        };
      }
      return {
        description: `Set trustline for ${asset}${limit ? ` (limit ${formatBalance(limit)})` : ""}`,
        asset,
        from: String(r.source_account ?? ""),
        to: issuer,
      };
    }
    case "allow_trust":
    case "set_trust_line_flags": {
      const assetCode = String(r.asset_code ?? "unknown");
      const trustor = String(r.trustor ?? "");
      return {
        description: `Update trust authorization for ${assetCode}`,
        asset: assetCode,
        from: String(r.source_account ?? ""),
        to: trustor,
      };
    }
    default:
      return {
        description: type
          .split("_")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" "),
      };
  }
}

function mapOperation(raw: Record<string, unknown>): OpDisplay {
  const type = String(raw.type ?? "");
  const desc = describeOperation(raw);
  const sourceAccount = String(raw.source_account ?? "");
  let action = typeLabel(type);
  let pair: string | undefined;
  let price: string | undefined;

  if (
    type === "manage_sell_offer" ||
    type === "manage_buy_offer" ||
    type === "create_passive_sell_offer"
  ) {
    const selling = resolveAssetWithIssuer(raw, "selling");
    const buying = resolveAssetWithIssuer(raw, "buying");
    pair = `${selling} / ${buying}`;
    price = String(raw.price ?? "");
    const isCancel = String(raw.amount ?? "") === "0";
    if (type === "manage_sell_offer") {
      action = isCancel ? "Sell Offer (Cancel)" : "Sell Offer";
    } else if (type === "manage_buy_offer") {
      action = isCancel ? "Buy Offer (Cancel)" : "Buy Offer";
    } else {
      action = "Passive Sell Offer";
    }
  } else if (type === "change_trust") {
    pair = resolveAssetWithIssuer(raw);
    action =
      String(raw.limit ?? "") === "0" ? "Trustline Remove" : "Trustline Set";
  } else if (type === "allow_trust" || type === "set_trust_line_flags") {
    action = "Trustline Authorization";
    pair = String(raw.asset_code ?? "");
  } else if (type === "payment") {
    pair = resolveAssetWithIssuer(raw);
  } else if (
    type === "path_payment_strict_receive" ||
    type === "path_payment_strict_send"
  ) {
    pair = `${resolveAssetWithIssuer(raw, "source_asset")} → ${resolveAssetWithIssuer(raw)}`;
  }

  let paymentAssetKind: "xlm" | "other" | undefined;
  let paymentAssetType: string | undefined;
  let paymentAssetCode: string | undefined;
  let paymentAssetIssuer: string | undefined;
  if (type === "payment") {
    paymentAssetType = (raw.asset_type as string | undefined) ?? undefined;
    paymentAssetCode = (raw.asset_code as string | undefined) ?? undefined;
    paymentAssetIssuer = (raw.asset_issuer as string | undefined) ?? undefined;
    paymentAssetKind = raw.asset_type === "native" ? "xlm" : "other";
  } else if (
    type === "path_payment_strict_receive" ||
    type === "path_payment_strict_send"
  ) {
    paymentAssetType =
      (raw.source_asset_type as string | undefined) ?? undefined;
    paymentAssetCode =
      (raw.source_asset_code as string | undefined) ?? undefined;
    paymentAssetIssuer =
      (raw.source_asset_issuer as string | undefined) ?? undefined;
    paymentAssetKind = raw.source_asset_type === "native" ? "xlm" : "other";
  }

  return {
    id: String(raw.id ?? ""),
    pagingToken: String(raw.paging_token ?? ""),
    type,
    typeLabel: typeLabel(type),
    category: categorize(type),
    action,
    details: desc.description,
    pair,
    price,
    description: desc.description,
    amount: desc.amount,
    asset: desc.asset,
    from: desc.from || sourceAccount || undefined,
    to: desc.to,
    createdAt: String(raw.created_at ?? ""),
    successful: (raw.transaction_successful as boolean) ?? true,
    transactionHash: String(raw.transaction_hash ?? ""),
    paymentAssetKind,
    paymentAssetType,
    paymentAssetCode,
    paymentAssetIssuer,
  };
}

function summarizePredicate(pred: Record<string, unknown> | undefined): string {
  if (!pred) return "Unconditional";
  if (pred.unconditional !== undefined) return "Unconditional";
  if (pred.abs_before) {
    return `Before ${new Date(String(pred.abs_before)).toLocaleString()}`;
  }
  if (pred.rel_before) return `Within ${String(pred.rel_before)}s`;
  return "Conditional";
}

function formatClaimableAsset(asset: string): string {
  if (asset === "native") return "XLM";
  const [code, issuer] = asset.split(":");
  if (!code) return asset;
  if (!issuer) return code;
  return `${code}:${shortAddr(issuer)}`;
}

function exportCounterparties(
  filename: string,
  rows: { address: string; totalXlm: number; count: number }[],
  totalForPercent?: number,
): void {
  downloadCSV(
    filename,
    ["Address", "Total XLM", "Count", "% of Total"],
    rows.map((row) => {
      const pct =
        totalForPercent && totalForPercent > 0
          ? (row.totalXlm / totalForPercent) * 100
          : 0;
      return [
        row.address,
        String(row.totalXlm),
        String(row.count),
        pct.toFixed(2),
      ];
    }),
  );
}

export function AddressInvestigatorTab() {
  const searchParams = useSearchParams();
  const urlAddress = searchParams.get("address");

  const {
    history: searchHistory,
    upsert: upsertHistory,
    remove: removeHistory,
  } = useAddressHistory();

  const { settings } = useSettings();
  const { upsert: upsertSearch } = useSavedSearches();
  const { entries: knownIntermediaries } = useKnownIntermediaries();
  const { groups, upsertMember } = useAssetGroups();
  const { activeWallet } = useActiveWallet();
  const [address, setAddress] = useState(
    () => urlAddress ?? addressHistoryGetSnapshot()[0]?.address ?? "",
  );
  const lastUrlAddressRunRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AddressInvestigationResult | null>(null);
  const [operations, setOperations] = useState<OpDisplay[]>([]);
  const [visibleCount, setVisibleCount] = useState(DISPLAY_PAGE_SIZE);
  const [categoryFilter, setCategoryFilter] = useState<OpCategory | "all">(
    "all",
  );
  const [paymentAssetSelection, setPaymentAssetSelection] = useState("all");
  const [paymentAssetQuery, setPaymentAssetQuery] = useState("");
  const [trustlineAssetOptions, setTrustlineAssetOptions] = useState<
    TrustlineAssetOption[]
  >([]);
  const [balancesTrustlines, setBalancesTrustlines] = useState<
    BalanceTrustlineRow[]
  >([]);
  const [opsFetchWarning, setOpsFetchWarning] = useState<string | null>(null);
  const [opsFetchMeta, setOpsFetchMeta] = useState<{
    pages: number;
    records: number;
    complete: boolean;
  } | null>(null);
  const [claimableBalances, setClaimableBalances] = useState<
    ClaimableBalanceRow[]
  >([]);
  const [claimableVisibleCount, setClaimableVisibleCount] = useState(
    CLAIMABLE_DISPLAY_PAGE_SIZE,
  );
  const [claimableWarning, setClaimableWarning] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [investigationWarning, setInvestigationWarning] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [homeDomain, setHomeDomain] = useState<string | null>(null);
  const [groupDialog, setGroupDialog] = useState<{
    address: string;
    role: GroupMemberRole;
  } | null>(null);
  const [dialogGroupId, setDialogGroupId] = useState<string>("");
  const [dialogRole, setDialogRole] = useState<GroupMemberRole>("bank");
  const [addressChain, setAddressChain] = useState<ChainState>({ status: "idle", chain: [] });
  const realCreatorAbortRef = useRef<AbortController | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      realCreatorAbortRef.current?.abort();
    };
  }, []);

  // During hydration useSyncExternalStore exposes the SERVER snapshot
  // (DEFAULT_SETTINGS, network "public"); the real localStorage settings only
  // arrive on the post-mount re-render. Auto-running before that queries the
  // wrong network. This flag flips in an effect, so any render where it is
  // true is guaranteed to carry hydrated settings.
  const [settingsHydrated, setSettingsHydrated] = useState(false);
  useEffect(() => {
    setSettingsHydrated(true);
  }, []);

  // Deep-link: when the URL ?address= param changes (e.g. "Investigate" from
  // Wallet Balances), set the input, clear any stale result state from the
  // previous address, and auto-run the investigation for the new address.
  // Guarded so each distinct param value fires exactly once.
  useEffect(() => {
    if (!settingsHydrated) return;
    if (!urlAddress) return;
    if (lastUrlAddressRunRef.current === urlAddress) return;
    lastUrlAddressRunRef.current = urlAddress;

    setAddress(urlAddress);
    setError(null);
    setResult(null);
    setOperations([]);
    setVisibleCount(DISPLAY_PAGE_SIZE);
    setCategoryFilter("all");
    setPaymentAssetSelection("all");
    setPaymentAssetQuery("");
    setTrustlineAssetOptions([]);
    setBalancesTrustlines([]);
    setOpsFetchWarning(null);
    setOpsFetchMeta(null);
    setClaimableBalances([]);
    setClaimableVisibleCount(CLAIMABLE_DISPLAY_PAGE_SIZE);
    setClaimableWarning(null);
    setHomeDomain(null);
    setSearched(false);
    setProgressText(null);
    realCreatorAbortRef.current?.abort();
    setAddressChain({ status: "idle", chain: [] });
    setGroupDialog(null);

    handleRun(urlAddress);
    // handleRun is intentionally omitted from deps — it's stable in shape
    // (recreated each render) but re-invoking on its identity change would
    // defeat the "once per param value" guard above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlAddress, settingsHydrated]);

  const isCustomAssetSelection = paymentAssetSelection === "custom";

  const filteredOperations = useMemo(() => {
    const normalizedPaymentAssetQuery = paymentAssetQuery.trim().toUpperCase();
    const selectedTrustlineValue = paymentAssetSelection.startsWith(
      "trustline:",
    )
      ? paymentAssetSelection.slice("trustline:".length)
      : null;
    const selectedTrustline = selectedTrustlineValue
      ? trustlineAssetOptions.find(
          (option) => option.value === selectedTrustlineValue,
        )
      : undefined;

    return operations.filter((op) => {
      if (categoryFilter !== "all" && op.category !== categoryFilter) {
        return false;
      }

      if (paymentAssetSelection === "native" && op.category === "payments") {
        if (op.paymentAssetType !== "native") return false;
      }

      if (
        paymentAssetSelection === "custom" &&
        op.category === "payments" &&
        normalizedPaymentAssetQuery
      ) {
        if (op.paymentAssetType === "native") return false;
        const code = (op.paymentAssetCode ?? "").toUpperCase();
        const issuer = (op.paymentAssetIssuer ?? "").toUpperCase();

        if (normalizedPaymentAssetQuery.includes(":")) {
          const [qCode, qIssuer] = normalizedPaymentAssetQuery.split(":");
          if (code !== qCode.trim()) return false;
          if (!issuer.includes(qIssuer.trim())) return false;
        } else {
          if (!code.includes(normalizedPaymentAssetQuery)) return false;
        }
      }

      if (selectedTrustline && op.category === "payments") {
        if (op.paymentAssetType === "native") return false;
        if (
          (op.paymentAssetCode ?? "").toUpperCase() !== selectedTrustline.code
        ) {
          return false;
        }
        if (op.paymentAssetIssuer !== selectedTrustline.issuer) return false;
      }
      return true;
    });
  }, [
    operations,
    categoryFilter,
    paymentAssetSelection,
    paymentAssetQuery,
    trustlineAssetOptions,
  ]);

  async function fetchAllOperations(
    accountId: string,
    selectedNetwork: Network,
    signal: AbortSignal,
    onProgress?: (pages: number, records: number) => void,
  ): Promise<OperationsFetchSummary> {
    const server = new Horizon.Server(
      resolveHorizonUrl({ ...settings, network: selectedNetwork }),
    );
    const all: OpDisplay[] = [];
    let cursor: string | null = null;
    let pages = 0;

    try {
      while (!signal.aborted) {
        let builder: any = server
          .operations()
          .forAccount(accountId)
          .order("desc")
          .limit(FETCH_PAGE_SIZE);

        if (cursor) builder = builder.cursor(cursor);

        const page = await builder.call();
        if (signal.aborted) break;

        const mapped = (page.records as Record<string, unknown>[]).map(
          mapOperation,
        );
        all.push(...mapped);
        pages += 1;
        onProgress?.(pages, all.length);

        if (page.records.length < FETCH_PAGE_SIZE) {
          return {
            operations: all,
            pages,
            records: all.length,
            complete: true,
          };
        }
        cursor = page.records[page.records.length - 1].paging_token;
      }
    } catch (e) {
      return {
        operations: all,
        pages,
        records: all.length,
        complete: false,
        warning: `Transaction scan incomplete: ${getErrorMessage(e)}`,
      };
    }

    return {
      operations: all,
      pages,
      records: all.length,
      complete: false,
      warning: "Transaction scan canceled before completion.",
    };
  }

  async function fetchClaimableBalancesForAccount(
    accountId: string,
    selectedNetwork: Network,
    signal: AbortSignal,
  ): Promise<ClaimableBalancesFetchSummary> {
    const server = new Horizon.Server(
      resolveHorizonUrl({ ...settings, network: selectedNetwork }),
    );

    const rows: ClaimableBalanceRow[] = [];
    let cursor: string | null = null;

    try {
      while (!signal.aborted) {
        let builder: any = server
          .claimableBalances()
          .claimant(accountId)
          .limit(FETCH_PAGE_SIZE);

        if (cursor) builder = builder.cursor(cursor);

        const page = await builder.call();
        if (signal.aborted) break;
        const records = page.records as Record<string, unknown>[];

        for (const record of records) {
          const claimants = (
            (record.claimants as
              | { destination: string; predicate?: Record<string, unknown> }[]
              | undefined) ?? []
          ).map(
            (claimant) =>
              `${shortAddr(claimant.destination)} (${summarizePredicate(claimant.predicate)})`,
          );

          rows.push({
            id: String(record.id ?? ""),
            amount: String(record.amount ?? "0"),
            asset: formatClaimableAsset(String(record.asset ?? "")),
            sponsor: String(record.sponsor ?? ""),
            claimants,
            lastModifiedTime: String(record.last_modified_time ?? ""),
          });
        }

        if (records.length < FETCH_PAGE_SIZE) {
          return { rows, complete: true };
        }

        cursor = String(records[records.length - 1].paging_token ?? "");
      }
    } catch (e) {
      return {
        rows,
        complete: false,
        warning: `Claimable balances scan incomplete: ${getErrorMessage(e)}`,
      };
    }

    return {
      rows,
      complete: false,
      warning: "Claimable balances scan canceled before completion.",
    };
  }

  const handleRun = async (addressOverride?: string) => {
    const account = (addressOverride ?? address).trim();
    if (!StrKey.isValidEd25519PublicKey(account)) {
      setError("Address is not a valid Stellar public key.");
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    setResult(null);
    setHomeDomain(null);
    setOperations([]);
    setVisibleCount(DISPLAY_PAGE_SIZE);
    setCategoryFilter("all");
    setPaymentAssetSelection("all");
    setTrustlineAssetOptions([]);
    setBalancesTrustlines([]);
    setOpsFetchWarning(null);
    setOpsFetchMeta(null);
    setClaimableBalances([]);
    setClaimableVisibleCount(CLAIMABLE_DISPLAY_PAGE_SIZE);
    setClaimableWarning(null);
    setInvestigationWarning(null);
    setPaymentAssetQuery("");
    setSearched(true);
    setProgressText("Initializing scan...");
    realCreatorAbortRef.current?.abort();
    setAddressChain({ status: "idle", chain: [] });
    setGroupDialog(null);

    try {
      const horizonBase = resolveHorizonUrl(settings);
      const server = new Horizon.Server(resolveHorizonUrl(settings));
      const parsedFromDate = fromDate ? new Date(fromDate) : undefined;
      const parsedToDate = toDate ? new Date(toDate + "T23:59:59") : undefined;

      const [
        investigation,
        operationsSummary,
        accountDetails,
        claimableSummary,
      ] = await Promise.all([
        fetchAddressInvestigation(
          horizonBase,
          account,
          controller.signal,
          (progress) => {
            setProgressText(
              `${progress.phase} (${progress.records.toLocaleString()} records)`,
            );
          },
          parsedFromDate,
          parsedToDate,
        ),
        fetchAllOperations(
          account,
          settings.network,
          controller.signal,
          (pages, records) => {
            setProgressText(
              `Loading all transactions… page ${pages} (${records.toLocaleString()} records)`,
            );
          },
        ),
        server.loadAccount(account),
        fetchClaimableBalancesForAccount(
          account,
          settings.network,
          controller.signal,
        ),
      ]);

      if (controller.signal.aborted) return;
      setResult(investigation);
      setInvestigationWarning(
        investigation.complete === false ? (investigation.warning ?? null) : null,
      );
      setHomeDomain((accountDetails as { home_domain?: string }).home_domain ?? null);
      upsertHistory({ address: account, network: settings.network });
      upsertSearch({ type: "address", value: account, network: settings.network });
      setOperations(operationsSummary.operations);
      setOpsFetchMeta({
        pages: operationsSummary.pages,
        records: operationsSummary.records,
        complete: operationsSummary.complete,
      });
      setOpsFetchWarning(operationsSummary.warning ?? null);
      setClaimableBalances(claimableSummary.rows);
      setClaimableWarning(claimableSummary.warning ?? null);

      const trustlineOptions: TrustlineAssetOption[] = accountDetails.balances
        .filter(
          (b) =>
            b.asset_type === "credit_alphanum4" ||
            b.asset_type === "credit_alphanum12",
        )
        .map((b) => {
          const balance = b as Horizon.HorizonApi.BalanceLine;
          const code =
            "asset_code" in balance ? (balance.asset_code ?? "") : "";
          const issuer =
            "asset_issuer" in balance ? (balance.asset_issuer ?? "") : "";
          return {
            value: `${code}:${issuer}`,
            label: `${code}:${shortAddr(issuer)}`,
            code: code.toUpperCase(),
            issuer,
          };
        })
        .sort((a, b) => a.label.localeCompare(b.label));

      const balanceRows: BalanceTrustlineRow[] = accountDetails.balances.map(
        (balance, index) => {
          const raw = balance as unknown as Record<string, unknown>;
          const assetType = String(raw.asset_type ?? "");
          const assetCode = String(raw.asset_code ?? "");
          const assetIssuer = String(raw.asset_issuer ?? "");
          const isNative = assetType === "native";
          const asset = isNative
            ? "XLM"
            : assetCode || String(raw.liquidity_pool_id ?? "Liquidity Pool");
          const authorization =
            raw.is_authorized === true
              ? "Authorized"
              : raw.is_authorized === false
                ? "Not Authorized"
                : raw.authorized === true
                  ? "Authorized"
                  : raw.authorized === false
                    ? "Not Authorized"
                    : undefined;
          return {
            id: `${assetType}-${asset}-${assetIssuer || "native"}-${index}`,
            asset,
            issuer: !isNative ? assetIssuer : undefined,
            balance: String(raw.balance ?? "0"),
            limit: !isNative ? String(raw.limit ?? "") : undefined,
            buyingLiabilities: String(raw.buying_liabilities ?? "0"),
            sellingLiabilities: String(raw.selling_liabilities ?? "0"),
            authorization,
          };
        },
      );

      setTrustlineAssetOptions(trustlineOptions);
      setBalancesTrustlines(balanceRows);
      setProgressText("Completed.");
    } catch (e) {
      if (controller.signal.aborted) {
        setProgressText("Canceled.");
        return;
      }
      setError(getErrorMessage(e));
      setProgressText(null);
    } finally {
      if (abortRef.current === controller) {
        setLoading(false);
      }
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    setLoading(false);
    setProgressText("Canceled.");
  };

  const visibleOperations = useMemo(
    () => filteredOperations.slice(0, visibleCount),
    [filteredOperations, visibleCount],
  );
  const visibleClaimableBalances = useMemo(
    () => claimableBalances.slice(0, claimableVisibleCount),
    [claimableBalances, claimableVisibleCount],
  );
  const hasMoreVisible = filteredOperations.length > visibleCount;
  const hasMoreClaimable = claimableBalances.length > claimableVisibleCount;

  const handleShowMoreOps = () => {
    setVisibleCount((count) => count + DISPLAY_PAGE_SIZE);
  };

  const handleShowAllOps = () => {
    setVisibleCount(filteredOperations.length);
  };

  const handleShowMoreClaimable = () => {
    setClaimableVisibleCount((count) => count + CLAIMABLE_DISPLAY_PAGE_SIZE);
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
                <div
                  role="button"
                  tabIndex={0}
                  className="flex items-center gap-1.5 cursor-pointer text-muted-foreground transition-colors"
                  onClick={() => {
                    setAddress(entry.address);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setAddress(entry.address);
                    }
                  }}
                >
                  <ShortAddress address={entry.address} network={entry.network} />
                  <span className="opacity-50">{entry.network}</span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-1 h-5 w-5 p-0.5 text-muted-foreground hover:text-destructive"
                  onClick={() => removeHistory(entry.timestamp)}
                  aria-label="Remove"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Search</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-[1fr_auto]">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="investigator-address">Address</Label>
                {activeWallet && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setAddress(activeWallet.publicKey)}
                    className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground hover:bg-transparent"
                  >
                    Use my wallet
                  </Button>
                )}
              </div>
              <Input
                id="investigator-address"
                placeholder="G..."
                value={address}
                onChange={(e) => setAddress(e.target.value.trim())}
                className="font-mono text-xs"
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="investigator-from-date">From (optional)</Label>
              <Input
                id="investigator-from-date"
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="investigator-to-date">To (optional)</Label>
              <Input
                id="investigator-to-date"
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                disabled={loading}
              />
            </div>
          </div>
          {(fromDate || toDate) && (
            <p className="text-xs text-muted-foreground">
              Scanning only within the selected date range — much faster for recent data.
            </p>
          )}

          {progressText && (
            <p className="text-xs text-muted-foreground">{progressText}</p>
          )}

          {investigationWarning && (
            <p className="text-xs text-amber-600 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              {investigationWarning}
            </p>
          )}

          {opsFetchWarning && (
            <p className="text-xs text-amber-600 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              {opsFetchWarning}
            </p>
          )}

          {error && (
            <p className="text-sm text-destructive flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              {error}
            </p>
          )}
        </CardContent>
        <CardFooter className="flex gap-2">
          <Button onClick={() => handleRun()} disabled={loading}>
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Search className="mr-2 h-4 w-4" />
            )}
            Investigate
          </Button>
          <Button variant="outline" onClick={handleCancel} disabled={!loading}>
            <X className="mr-2 h-4 w-4" />
            Cancel
          </Button>
        </CardFooter>
      </Card>

      {result && (
        <>
          {/* Group-add dialog */}
          <Dialog open={!!groupDialog} onOpenChange={(o) => !o && setGroupDialog(null)}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>Add to Group</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 py-1">
                <div>
                  <Label className="text-xs">Group</Label>
                  <Select value={dialogGroupId} onValueChange={setDialogGroupId}>
                    <SelectTrigger className="h-7 mt-1 text-sm">
                      <SelectValue placeholder="Select a group…" />
                    </SelectTrigger>
                    <SelectContent>
                      {groups.map((g) => (
                        <SelectItem key={g.id} value={g.id}>
                          {g.name}
                          {g.assetCode ? ` (${g.assetCode})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Role</Label>
                  <Select value={dialogRole} onValueChange={(v) => setDialogRole(v as GroupMemberRole)}>
                    <SelectTrigger className="h-7 mt-1 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.entries(ROLE_LABELS) as [GroupMemberRole, string][]).map(([role, label]) => (
                        <SelectItem key={role} value={role}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button size="sm" variant="outline" onClick={() => setGroupDialog(null)}>Cancel</Button>
                <Button
                  size="sm"
                  disabled={!dialogGroupId}
                  onClick={() => {
                    if (!groupDialog || !dialogGroupId) return;
                    upsertMember(dialogGroupId, { address: groupDialog.address, role: dialogRole });
                    setGroupDialog(null);
                  }}
                >
                  Save to Group
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Address profile banner */}
          <div className="flex flex-wrap items-center gap-3 px-1 text-sm">
            <ShortAddress address={result.account} network={settings.network} />
            {homeDomain && (
              <a
                href={`https://${homeDomain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <Globe className="h-3.5 w-3.5" />
                {homeDomain}
                <ExternalLink className="h-3 w-3 opacity-50" />
              </a>
            )}
            <a
              href={`https://stellar.expert/explorer/${settings.network}/account/${result.account}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground/60 hover:text-primary"
            >
              Stellar.Expert ↗
            </a>
            {addressChain.status === "idle" && (
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-xs"
                onClick={() => {
                  realCreatorAbortRef.current?.abort();
                  realCreatorAbortRef.current = new AbortController();
                  traceChainStep(result.account, realCreatorAbortRef.current.signal, setAddressChain, resolveHorizonUrl(settings), knownIntermediaries);
                }}
              >
                Who created?
              </Button>
            )}
          </div>

          {addressChain.chain.length > 0 || addressChain.status === "loading" || addressChain.status === "error" ? (
            <ChainDisplay
              chain={addressChain}
              network={settings.network}
              assetCode=""
              issuer=""
              horizonUrl={resolveHorizonUrl(settings)}
              knownIntermediaryAddrs={new Set(knownIntermediaries.map((e) => e.address))}
              onContinue={(addr) => {
                realCreatorAbortRef.current?.abort();
                realCreatorAbortRef.current = new AbortController();
                traceChainStep(addr, realCreatorAbortRef.current.signal, setAddressChain, resolveHorizonUrl(settings), knownIntermediaries);
              }}
              onAddToGroup={(addr, role) => {
                setDialogGroupId(groups[0]?.id ?? "");
                setDialogRole(role);
                setGroupDialog({ address: addr, role });
              }}
            />
          ) : null}

          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardDescription>Total Incoming</CardDescription>
                <CardTitle>{formatXlm(result.totalIncomingXlm)} XLM</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Total Outgoing</CardDescription>
                <CardTitle>{formatXlm(result.totalOutgoingXlm)} XLM</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Net Flow</CardDescription>
                <CardTitle>{formatXlm(result.netXlm)} XLM</CardTitle>
              </CardHeader>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Balances & Trustlines</CardTitle>
              <CardDescription>
                Current account balances, trustline limits, liabilities, and
                authorization state.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto border rounded-md">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="text-left px-3 py-2">Asset</th>
                      <th className="text-left px-3 py-2">Issuer</th>
                      <th className="text-right px-3 py-2">Balance</th>
                      <th className="text-right px-3 py-2">Limit</th>
                      <th className="text-right px-3 py-2">Buying Liab.</th>
                      <th className="text-right px-3 py-2">Selling Liab.</th>
                      <th className="text-left px-3 py-2">Authorization</th>
                    </tr>
                  </thead>
                  <tbody>
                    {balancesTrustlines.map((row) => (
                      <tr key={row.id} className="border-b last:border-0">
                        <td className="px-3 py-2 whitespace-nowrap">
                          {row.asset}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                          {row.issuer ? (
                            <ShortAddress address={row.issuer} network={settings.network} />
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                          {formatBalance(row.balance)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                          {row.limit ? formatBalance(row.limit) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                          {row.buyingLiabilities
                            ? formatBalance(row.buyingLiabilities)
                            : "0"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                          {row.sellingLiabilities
                            ? formatBalance(row.sellingLiabilities)
                            : "0"}
                        </td>
                        <td className="px-3 py-2 text-xs whitespace-nowrap">
                          {row.authorization ?? "—"}
                        </td>
                      </tr>
                    ))}
                    {balancesTrustlines.length === 0 && (
                      <tr>
                        <td
                          colSpan={7}
                          className="px-3 py-4 text-sm text-muted-foreground text-center"
                        >
                          No balances available.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {claimableBalances.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Gift className="h-5 w-5" />
                  Claimable Balances
                </CardTitle>
                <CardDescription>
                  Open claimable balances where this account is a claimant.
                </CardDescription>
                {claimableWarning && (
                  <p className="text-xs text-amber-600 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" />
                    {claimableWarning}
                  </p>
                )}
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto border rounded-md">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40">
                        <th className="text-right px-3 py-2">Amount</th>
                        <th className="text-left px-3 py-2">Asset</th>
                        <th className="text-left px-3 py-2">Sponsor</th>
                        <th className="text-left px-3 py-2">Claimants</th>
                        <th className="text-left px-3 py-2">Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleClaimableBalances.map((row) => (
                        <tr key={row.id} className="border-b last:border-0">
                          <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                            {formatBalance(row.amount)}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {row.asset}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                            {row.sponsor ? (
                              <ShortAddress address={row.sponsor} network={settings.network} />
                            ) : (
                              "—"
                            )}
                          </td>
                          <td
                            className="px-3 py-2 text-xs"
                            title={row.claimants.join(", ")}
                          >
                            {row.claimants.length > 0
                              ? row.claimants.join(", ")
                              : "—"}
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                            {row.lastModifiedTime
                              ? timeAgo(row.lastModifiedTime)
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
              {hasMoreClaimable && (
                <CardFooter>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={handleShowMoreClaimable}
                  >
                    <ChevronDown className="mr-2 h-4 w-4" />
                    Show More Claimable Balances
                  </Button>
                </CardFooter>
              )}
            </Card>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Top Senders</CardTitle>
                <CardDescription>
                  Largest native XLM sources to this address.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    exportCounterparties(
                      "top-senders.csv",
                      result.topSenders,
                      result.totalIncomingFromSendersXlm,
                    )
                  }
                >
                  <Download className="mr-2 h-3.5 w-3.5" />
                  Export CSV
                </Button>
                <ProceedsDestinationsTable
                  destinations={result.topSenders}
                  totalXlmProceeds={result.totalIncomingFromSendersXlm}
                  network={settings.network}
                  showPercentColumn
                  percentColumnLabel="% of Total"
                  addressColumnLabel="Sender"
                  emptyMessage="No incoming payments found."
                  onAddToGroup={
                    groups.length > 0
                      ? (addr) => {
                          setDialogGroupId(groups[0].id);
                          setDialogRole("bank");
                          setGroupDialog({ address: addr, role: "bank" });
                        }
                      : undefined
                  }
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Top Recipients</CardTitle>
                <CardDescription>
                  Largest native XLM destinations from this address.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    exportCounterparties(
                      "top-recipients.csv",
                      result.topRecipients,
                      result.totalOutgoingToRecipientsXlm,
                    )
                  }
                >
                  <Download className="mr-2 h-3.5 w-3.5" />
                  Export CSV
                </Button>
                <ProceedsDestinationsTable
                  destinations={result.topRecipients}
                  totalXlmProceeds={result.totalOutgoingToRecipientsXlm}
                  network={settings.network}
                  showPercentColumn
                  percentColumnLabel="% of Total"
                  addressColumnLabel="Recipient"
                  emptyMessage="No outgoing payments found."
                  onAddToGroup={
                    groups.length > 0
                      ? (addr) => {
                          setDialogGroupId(groups[0].id);
                          setDialogRole("bank");
                          setGroupDialog({ address: addr, role: "bank" });
                        }
                      : undefined
                  }
                />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2">
                  <ArrowDownUp className="h-5 w-5" />
                  All Transactions
                </CardTitle>
                {filteredOperations.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      downloadCSV(
                        `address-ops-${result.account.slice(0, 8)}.csv`,
                        [
                          "Action",
                          "Category",
                          "Asset/Pair",
                          "Price",
                          "Details",
                          "Amount",
                          "From",
                          "To",
                          "Time",
                          "Status",
                          "Transaction Hash",
                        ],
                        filteredOperations.map((op) => [
                          op.action,
                          op.category,
                          op.pair ?? op.asset ?? "",
                          op.price ?? "",
                          op.details,
                          op.amount ?? "",
                          op.from ?? "",
                          op.to ?? "",
                          op.createdAt,
                          op.successful ? "Success" : "Failed",
                          op.transactionHash,
                        ]),
                      )
                    }
                  >
                    <Download className="mr-2 h-3.5 w-3.5" />
                    Export CSV
                  </Button>
                )}
              </div>
              <CardDescription>
                Browse and filter account operations (payments, buy/sell offers,
                trustlines, admin, and more).
                {opsFetchMeta && !opsFetchMeta.complete
                  ? ` Showing partial data (${opsFetchMeta.records.toLocaleString()} records loaded).`
                  : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-2">
                  <Label>Operation Type</Label>
                  <Select
                    value={categoryFilter}
                    onValueChange={(v) =>
                      setCategoryFilter(v as OpCategory | "all")
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(
                        Object.keys(CATEGORY_LABELS) as (OpCategory | "all")[]
                      ).map((key) => (
                        <SelectItem key={key} value={key}>
                          {CATEGORY_LABELS[key]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Payment Asset</Label>
                  <Select
                    value={paymentAssetSelection}
                    onValueChange={setPaymentAssetSelection}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Payment Assets</SelectItem>
                      <SelectItem value="native">Native XLM</SelectItem>
                      {trustlineAssetOptions.map((option) => (
                        <SelectItem
                          key={option.value}
                          value={`trustline:${option.value}`}
                        >
                          {option.label}
                        </SelectItem>
                      ))}
                      <SelectItem value="custom">Custom Asset</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {isCustomAssetSelection && (
                  <div className="space-y-2">
                    <Label>Custom Payment Asset</Label>
                    <Input
                      placeholder="e.g. USDC or USDC:G..."
                      value={paymentAssetQuery}
                      onChange={(e) =>
                        setPaymentAssetQuery(e.target.value)
                      }
                    />
                  </div>
                )}
              </div>

              <div className="overflow-x-auto border rounded-md">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="text-left px-3 py-2">Action</th>
                      <th className="text-left px-3 py-2">Asset / Pair</th>
                      <th className="text-right px-3 py-2">Price</th>
                      <th className="text-left px-3 py-2">Details</th>
                      <th className="text-right px-3 py-2">Amount</th>
                      <th className="text-left px-3 py-2">Counterparties</th>
                      <th className="text-left px-3 py-2">Time</th>
                      <th className="text-center px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleOperations.map((op) => (
                      <tr key={op.id} className="border-b last:border-0">
                        <td className="px-3 py-2 whitespace-nowrap">
                          {op.action}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-xs">
                          {op.pair ?? op.asset ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                          {op.price ? formatBalance(op.price) : "—"}
                        </td>
                        <td className="px-3 py-2 text-xs max-w-[340px]">
                          {op.details}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                          {op.amount ? (
                            <>
                              {formatBalance(op.amount)}
                              {op.asset ? ` ${op.asset}` : ""}
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <div className="flex items-center gap-1">
                            <span className="text-muted-foreground">From:</span>
                            {op.from ? (
                              <ShortAddress
                                address={op.from}
                                network={settings.network}
                              />
                            ) : (
                              "—"
                            )}
                          </div>
                          <div className="flex items-center gap-1 opacity-60 mt-0.5">
                            <span className="text-muted-foreground">To:</span>
                            {op.to ? (
                              <ShortAddress address={op.to} network={settings.network} />
                            ) : (
                              "—"
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                          {timeAgo(op.createdAt)}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {op.successful ? (
                            <CheckCircle2 className="h-4 w-4 text-green-500 mx-auto" />
                          ) : (
                            <XCircle className="h-4 w-4 text-destructive mx-auto" />
                          )}
                        </td>
                      </tr>
                    ))}
                    {filteredOperations.length === 0 && (
                      <tr>
                        <td
                          colSpan={8}
                          className="px-3 py-4 text-sm text-muted-foreground text-center"
                        >
                          No operations match current filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
            {hasMoreVisible && searched && (
              <CardFooter>
                <div className="flex w-full gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={handleShowMoreOps}
                  >
                    <ChevronDown className="mr-2 h-4 w-4" />
                    Show More Transactions
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={handleShowAllOps}
                  >
                    Show All
                  </Button>
                </div>
              </CardFooter>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
