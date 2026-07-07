"use client";

import { useState, useRef, useMemo } from "react";
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
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Search,
  Loader2,
  AlertTriangle,
  ArrowDownUp,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  Download,
} from "lucide-react";
import { useSettings, resolveHorizonUrl } from "@/lib/settings";
import { useSavedSearches } from "@/hooks/use-saved-searches";

import { WalletSelect } from "@/components/ui/wallet-select";
import { ShortAddress } from "@/components/shared/ShortAddress";
import type { Network } from "@/lib/settings";
import {
  getErrorMessage,
  timeAgo,
  formatAsset,
  formatBalance,
} from "@/lib/stellar-helpers";
import { shortAddr } from "@/lib/format";
import { downloadCSV } from "@/lib/csv-export";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// Operation types & categories
// ---------------------------------------------------------------------------

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
  all: "All Operations",
  payments: "Payments",
  offers: "DEX / Liquidity",
  trust: "Trustlines",
  admin: "Account Admin",
  other: "Other",
};

const BADGE_STYLES: Record<OpCategory, string> = {
  payments:
    "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20",
  offers: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  trust:
    "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
  admin:
    "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20",
  other: "bg-muted text-muted-foreground border-border",
};

// ---------------------------------------------------------------------------
// Operation display type
// ---------------------------------------------------------------------------

interface OpDisplay {
  id: string;
  pagingToken: string;
  type: string;
  category: OpCategory;
  typeLabel: string;
  description: string;
  amount?: string;
  asset?: string;
  from?: string;
  to?: string;
  createdAt: string;
  successful: boolean;
  transactionHash: string;
  sourceAccount: string;
  raw: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    bump_sequence: "Bump Sequence",
    manage_data: "Manage Data",
    create_claimable_balance: "Create Claimable",
    claim_claimable_balance: "Claim Balance",
    begin_sponsoring_future_reserves: "Begin Sponsor",
    end_sponsoring_future_reserves: "End Sponsor",
    revoke_sponsorship: "Revoke Sponsor",
    clawback: "Clawback",
    clawback_claimable_balance: "Clawback CB",
    liquidity_pool_deposit: "LP Deposit",
    liquidity_pool_withdraw: "LP Withdraw",
    invoke_host_function: "Contract Call",
    extend_footprint_ttl: "Extend TTL",
    restore_footprint: "Restore Footprint",
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

// create_claimable_balance records carry a single combined `asset` string
// (either the literal "native" or "CODE:ISSUER") instead of separate
// asset_type/asset_code fields, so resolveAssetName cannot be reused as-is.
function resolveClaimableBalanceAsset(r: Record<string, unknown>): string {
  const asset = r.asset as string | undefined;
  if (!asset || asset === "native") return "XLM";
  const [code] = asset.split(":");
  return code || "unknown";
}

function describeOperation(r: Record<string, unknown>): {
  description: string;
  amount?: string;
  asset?: string;
  from?: string;
  to?: string;
} {
  const type = r.type as string;

  switch (type) {
    case "create_account":
      return {
        description: `Create account with ${r.starting_balance} XLM`,
        amount: r.starting_balance as string,
        asset: "XLM",
        from: r.funder as string,
        to: r.account as string,
      };

    case "payment":
      return {
        description: `Send ${formatBalance(r.amount as string)} ${resolveAssetName(r)}`,
        amount: r.amount as string,
        asset: resolveAssetName(r),
        from: r.from as string,
        to: r.to as string,
      };

    case "path_payment_strict_receive":
    case "path_payment_strict_send": {
      const srcAsset = resolveAssetName(r, "source_asset");
      const destAsset = resolveAssetName(r);
      return {
        description: `Path payment: ${formatBalance(r.source_amount as string)} ${srcAsset} → ${formatBalance(r.amount as string)} ${destAsset}`,
        amount: r.amount as string,
        asset: destAsset,
        from: r.from as string,
        to: r.to as string,
      };
    }

    case "manage_sell_offer": {
      const amt = r.amount as string;
      const asset = resolveAssetName(r, "selling_asset");
      const buying = resolveAssetName(r, "buying_asset");
      if (amt === "0")
        return {
          description: `Cancel sell offer for ${asset}/${buying}`,
          asset,
        };
      return {
        description: `Sell ${formatBalance(amt)} ${asset} for ${buying} at ${r.price}`,
        amount: amt,
        asset,
      };
    }

    case "manage_buy_offer": {
      const amt = r.amount as string;
      const asset = resolveAssetName(r, "buying_asset");
      const selling = resolveAssetName(r, "selling_asset");
      if (amt === "0")
        return {
          description: `Cancel buy offer for ${asset}/${selling}`,
          asset,
        };
      return {
        description: `Buy ${formatBalance(amt)} ${asset} with ${selling} at ${r.price}`,
        amount: amt,
        asset,
      };
    }

    case "create_passive_sell_offer": {
      const asset = resolveAssetName(r, "selling_asset");
      const buying = resolveAssetName(r, "buying_asset");
      return {
        description: `Passive sell ${formatBalance(r.amount as string)} ${asset} for ${buying}`,
        amount: r.amount as string,
        asset,
      };
    }

    case "change_trust": {
      const asset = resolveAssetName(r);
      const limit = r.limit as string | undefined;
      if (limit === "0")
        return { description: `Remove trustline for ${asset}`, asset };
      return {
        description: `${limit ? `Set trustline for ${asset} (limit: ${formatBalance(limit)})` : `Add trustline for ${asset}`}`,
        asset,
      };
    }

    case "allow_trust":
    case "set_trust_line_flags": {
      const asset = (r.asset_code as string) ?? "unknown";
      const trustor = r.trustor as string;
      return {
        description: `Update trust authorization for ${asset}`,
        asset,
        to: trustor,
      };
    }

    case "set_options": {
      const parts: string[] = [];
      if (r.home_domain) parts.push(`home domain → ${r.home_domain}`);
      if (r.inflation_dest) parts.push("inflation dest");
      if (r.signer_key) parts.push("signer");
      if (r.set_flags_s)
        parts.push(`set flags: ${(r.set_flags_s as string[]).join(", ")}`);
      if (r.clear_flags_s)
        parts.push(`clear flags: ${(r.clear_flags_s as string[]).join(", ")}`);
      return {
        description:
          parts.length > 0
            ? `Set options: ${parts.join(", ")}`
            : "Update account options",
      };
    }

    case "account_merge":
      return {
        description: "Merge account into destination",
        from: r.source_account as string,
        to: r.into as string,
      };

    case "bump_sequence":
      return { description: `Bump sequence to ${r.bump_to}` };

    case "manage_data": {
      const name = r.name as string;
      const value = r.value as string | undefined;
      return {
        description: value
          ? `Set data entry: ${name}`
          : `Delete data entry: ${name}`,
      };
    }

    case "create_claimable_balance": {
      const asset = resolveClaimableBalanceAsset(r);
      return {
        description: `Create claimable balance of ${formatBalance(r.amount as string)} ${asset}`,
        amount: r.amount as string,
        asset,
      };
    }

    case "claim_claimable_balance":
      return {
        description: `Claim claimable balance`,
      };

    case "begin_sponsoring_future_reserves":
      return {
        description: `Begin sponsoring reserves for ${shortAddr((r.sponsored_id as string) ?? "")}`,
        to: r.sponsored_id as string,
      };

    case "end_sponsoring_future_reserves":
      return { description: "End sponsoring future reserves" };

    case "revoke_sponsorship":
      return { description: "Revoke sponsorship" };

    case "clawback":
      return {
        description: `Clawback ${formatBalance(r.amount as string)} ${resolveAssetName(r)}`,
        amount: r.amount as string,
        asset: resolveAssetName(r),
        from: r.from as string,
      };

    case "liquidity_pool_deposit":
      return {
        description: `Deposit to liquidity pool`,
        amount: r.shares_received as string,
      };

    case "liquidity_pool_withdraw":
      return {
        description: `Withdraw from liquidity pool`,
        amount: r.shares as string,
      };

    case "invoke_host_function":
      return {
        description: `Invoke smart contract function`,
      };

    case "extend_footprint_ttl":
      return { description: "Extend footprint TTL" };

    case "restore_footprint":
      return { description: "Restore footprint" };

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
  const type = raw.type as string;
  const desc = describeOperation(raw);
  return {
    id: raw.id as string,
    pagingToken: raw.paging_token as string,
    type,
    category: categorize(type),
    typeLabel: typeLabel(type),
    description: desc.description,
    amount: desc.amount,
    asset: desc.asset,
    from: desc.from,
    to: desc.to,
    createdAt: raw.created_at as string,
    successful: (raw.transaction_successful as boolean) ?? true,
    transactionHash: raw.transaction_hash as string,
    sourceAccount: raw.source_account as string,
    raw,
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function TransactionsPage() {
  const [accountId, setAccountId] = useState("");
  const [accountIdError, setAccountIdError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const { settings } = useSettings();
  const network = settings.network;
  const { upsert: upsertSearch } = useSavedSearches();


  const [operations, setOperations] = useState<OpDisplay[]>([]);
  const [lastPagingToken, setLastPagingToken] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const [categoryFilter, setCategoryFilter] = useState<OpCategory | "all">(
    "all",
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  const filteredOps = useMemo(() => {
    if (categoryFilter === "all") return operations;
    return operations.filter((op) => op.category === categoryFilter);
  }, [operations, categoryFilter]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: operations.length };
    for (const op of operations) {
      counts[op.category] = (counts[op.category] ?? 0) + 1;
    }
    return counts;
  }, [operations]);

  // ---------------------------------------------------------------------------
  // Validation & fetch
  // ---------------------------------------------------------------------------

  function validate(id: string): string | null {
    if (!id.trim()) return "Account ID is required.";
    if (!StrKey.isValidEd25519PublicKey(id.trim()))
      return "Invalid Stellar public key.";
    return null;
  }

  async function fetchPage(cursor: string | null): Promise<OpDisplay[]> {
    const server = new Horizon.Server(resolveHorizonUrl(settings));

    let builder: any = server
      .operations()
      .forAccount(accountId.trim())
      .order("desc")
      .limit(PAGE_SIZE)
      .includeFailed(true);

    if (cursor) builder = builder.cursor(cursor);

    const page = await builder.call();
    return (page.records as Record<string, unknown>[]).map(mapOperation);
  }

  const handleSearch = async () => {
    const err = validate(accountId);
    setAccountIdError(err);
    setTouched(true);
    if (err) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsSearching(true);
    setError(null);
    setOperations([]);
    setLastPagingToken(null);
    setHasMore(false);
    setSearched(true);
    setCategoryFilter("all");
    setExpandedId(null);

    try {
      const records = await fetchPage(null);
      if (controller.signal.aborted) return;
      setOperations(records);
      upsertSearch({
        type: "address",
        value: accountId.trim(),
        network: settings.network,
      });
      setHasMore(records.length === PAGE_SIZE);
      setLastPagingToken(
        records.length > 0 ? records[records.length - 1].pagingToken : null,
      );
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(getErrorMessage(e));
    } finally {
      setIsSearching(false);
    }
  };

  const handleLoadMore = async () => {
    if (!lastPagingToken) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoadingMore(true);
    setError(null);

    try {
      const records = await fetchPage(lastPagingToken);
      if (controller.signal.aborted) return;
      setOperations((prev) => [...prev, ...records]);
      setHasMore(records.length === PAGE_SIZE);
      setLastPagingToken(
        records.length > 0 ? records[records.length - 1].pagingToken : null,
      );
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(getErrorMessage(e));
    } finally {
      setIsLoadingMore(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch();
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Transaction Explorer
        </h1>
        <p className="text-muted-foreground mt-2">
          Browse every operation on any Stellar account — payments, offers, trustlines, account admin, and more. Filter by category and export to CSV.
        </p>
      </div>

      {/* Query form */}
      <Card>
        <CardHeader>
          <CardTitle>Lookup</CardTitle>
          <CardDescription>
            Enter a Stellar public key to view its operations.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-[1fr_auto]">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="account-id">Account ID</Label>
                <WalletSelect
                  currentValue={accountId}
                  onPick={(w) => {
                    setAccountId(w.publicKey);
                    setAccountIdError(validate(w.publicKey));
                  }}
                />
              </div>
              <Input
                id="account-id"
                placeholder="G…"
                value={accountId}
                onChange={(e) => {
                  setAccountId(e.target.value);
                  if (touched) setAccountIdError(validate(e.target.value));
                }}
                onBlur={() => {
                  setTouched(true);
                  setAccountIdError(validate(accountId));
                }}
                onKeyDown={handleKeyDown}
                className="font-mono text-sm"
                aria-invalid={touched && !!accountIdError}
                aria-describedby={
                  touched && accountIdError ? "account-id-error" : undefined
                }
              />
              {touched && accountIdError && (
                <p
                  id="account-id-error"
                  className="text-xs text-destructive flex items-center gap-1"
                >
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  {accountIdError}
                </p>
              )}
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button
            onClick={handleSearch}
            disabled={isSearching || isLoadingMore}
            className="w-full sm:w-auto"
          >
            {isSearching ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Search className="mr-2 h-4 w-4" />
            )}
            Search
          </Button>
        </CardFooter>
      </Card>

      {/* Error */}
      {error && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="pt-6 flex items-start gap-3 text-destructive">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <p className="text-sm">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {searched && !isSearching && !error && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <ArrowDownUp className="h-5 w-5" />
                Operations
              </CardTitle>
              {operations.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    downloadCSV(
                      `operations-${accountId.trim().slice(0, 8)}.csv`,
                      [
                        "Type",
                        "Description",
                        "Amount",
                        "Asset",
                        "From",
                        "To",
                        "Time",
                        "Status",
                      ],
                      filteredOps.map((op) => [
                        op.typeLabel,
                        op.description,
                        op.amount ?? "",
                        op.asset ?? "",
                        op.from ?? "",
                        op.to ?? "",
                        op.createdAt
                          ? new Date(op.createdAt).toISOString()
                          : "",
                        op.successful ? "Success" : "Failed",
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
              {operations.length === 0
                ? "No operations found for this account."
                : `${operations.length} operation${operations.length !== 1 ? "s" : ""} loaded${hasMore ? " — more available" : ""}.`}
            </CardDescription>
          </CardHeader>

          {operations.length > 0 && (
            <>
              {/* Category filter */}
              <CardContent className="pb-0">
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(CATEGORY_LABELS) as (OpCategory | "all")[]).map(
                    (cat) => {
                      const count = categoryCounts[cat] ?? 0;
                      if (cat !== "all" && count === 0) return null;
                      const isActive = categoryFilter === cat;
                      return (
                        <Button
                          key={cat}
                          size="sm"
                          variant={isActive ? "default" : "outline"}
                          onClick={() => setCategoryFilter(cat)}
                          className={`h-auto px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                            isActive
                              ? cat === "all"
                                ? "bg-primary text-primary-foreground border-primary"
                                : BADGE_STYLES[cat as OpCategory]
                              : "bg-muted/50 text-muted-foreground border-transparent hover:bg-muted"
                          }`}
                        >
                          {CATEGORY_LABELS[cat]}
                          <span className="ml-1.5 opacity-60">
                            {cat === "all" ? operations.length : count}
                          </span>
                        </Button>
                      );
                    },
                  )}
                </div>
              </CardContent>

              {/* Operations table */}
              <CardContent className="px-0 pb-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        <th className="w-8 px-2 py-3" />
                        <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">
                          Type
                        </th>
                        <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">
                          Description
                        </th>
                        <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">
                          Amount
                        </th>
                        <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">
                          From / To
                        </th>
                        <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">
                          Time
                        </th>
                        <th className="text-center px-4 py-3 text-xs font-medium text-muted-foreground">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredOps.map((op) => {
                        const isExpanded = expandedId === op.id;
                        return (
                          <OpRow
                            key={op.id}
                            op={op}
                            network={network}
                            isExpanded={isExpanded}
                            onToggle={() =>
                              setExpandedId(isExpanded ? null : op.id)
                            }
                          />
                        );
                      })}
                      {filteredOps.length === 0 && (
                        <tr>
                          <td
                            colSpan={7}
                            className="text-center text-muted-foreground text-sm py-8"
                          >
                            No operations match the selected category.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>

              {hasMore && (
                <CardFooter className="border-t border-border pt-4">
                  <Button
                    variant="outline"
                    onClick={handleLoadMore}
                    disabled={isLoadingMore || isSearching}
                    className="w-full"
                  >
                    {isLoadingMore ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <ChevronDown className="mr-2 h-4 w-4" />
                    )}
                    Load next {PAGE_SIZE}
                  </Button>
                </CardFooter>
              )}
            </>
          )}
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Operation row component (with expandable detail)
// ---------------------------------------------------------------------------

function OpRow({
  op,
  network,
  isExpanded,
  onToggle,
}: {
  op: OpDisplay;
  network: Network;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors cursor-pointer"
        onClick={onToggle}
      >
        <td className="px-2 py-3 text-muted-foreground">
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 mx-auto" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 mx-auto" />
          )}
        </td>
        <td className="px-4 py-3">
          <span
            className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium border ${BADGE_STYLES[op.category]}`}
          >
            {op.typeLabel}
          </span>
        </td>
        <td className="px-4 py-3 text-xs max-w-[260px]">
          <span className="line-clamp-2">{op.description}</span>
        </td>
        <td className="px-4 py-3 text-right text-xs tabular-nums whitespace-nowrap">
          {op.amount ? (
            <>
              <span className="font-semibold">{formatBalance(op.amount)}</span>
              {op.asset && (
                <span className="ml-1 text-muted-foreground">{op.asset}</span>
              )}
            </>
          ) : (
            <span className="text-muted-foreground/40">—</span>
          )}
        </td>
        <td className="px-4 py-3 text-xs">
          {op.from || op.to ? (
            <div className="space-y-0.5">
              {op.from && (
                <div className="text-muted-foreground">
                  <ShortAddress address={op.from} network={network} />
                </div>
              )}
              {op.from && op.to && (
                <div className="text-muted-foreground/40 text-[10px]">↓</div>
              )}
              {op.to && (
                <div>
                  <ShortAddress address={op.to} network={network} />
                </div>
              )}
            </div>
          ) : (
            <span className="text-muted-foreground/40">—</span>
          )}
        </td>
        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
          {timeAgo(op.createdAt)}
        </td>
        <td className="px-4 py-3 text-center">
          {op.successful ? (
            <CheckCircle2 className="h-4 w-4 text-green-500 mx-auto" />
          ) : (
            <XCircle className="h-4 w-4 text-destructive mx-auto" />
          )}
        </td>
      </tr>

      {/* Expanded detail row */}
      {isExpanded && (
        <tr className="bg-muted/20">
          <td colSpan={7} className="px-6 py-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="space-y-2">
                <DetailField label="Operation ID" value={op.id} mono />
                <DetailField
                  label="Transaction Hash"
                  value={op.transactionHash}
                  mono
                />
                <DetailField
                  label="Source Account"
                  value={op.sourceAccount}
                  mono
                />
              </div>
              <div className="space-y-2">
                {op.from && (
                  <div>
                    <span className="text-muted-foreground">From:</span>{" "}
                    <ShortAddress address={op.from} network={network} />
                  </div>
                )}
                {op.to && (
                  <div>
                    <span className="text-muted-foreground">To:</span>{" "}
                    <ShortAddress address={op.to} network={network} />
                  </div>
                )}
                <DetailField label="Operation Type" value={op.type} />
                <DetailField
                  label="Time"
                  value={
                    op.createdAt ? new Date(op.createdAt).toLocaleString() : "—"
                  }
                />
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function DetailField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <span className="text-muted-foreground">{label}:</span>{" "}
      <span className={`break-all ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}
