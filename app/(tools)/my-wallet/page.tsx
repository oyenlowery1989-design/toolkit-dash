"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Horizon, Keypair } from "stellar-sdk";
import {
  Wallet,
  Globe,
  ExternalLink,
  RefreshCw,
  Copy,
  Check,
  ArrowRight,
  AlertCircle,
  Coins,
  TrendingDown,
  X,
  Hash,
  Info,
  ChevronDown,
  ChevronRight,
  Shield,
  ArrowDownLeft,
  ArrowUpRight,
  Trash2,
  Pencil,
} from "lucide-react";
import { useActiveWallet } from "@/hooks/use-active-wallet";
import { useSettings, resolveHorizonUrl } from "@/lib/settings";
import { timeAgo } from "@/lib/stellar-helpers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ShortAddress } from "@/components/shared/ShortAddress";
import { RevokeSponsorshipPanel } from "@/components/shared/sponsorship/RevokeSponsorshipPanel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AssetBalance {
  assetType: string;
  assetCode: string;
  assetIssuer: string;
  balance: string;
  limit: string;
  buyingLiabilities: string;
  sellingLiabilities: string;
}

interface OpenOffer {
  id: string;
  selling: { type: string; code: string; issuer: string };
  buying: { type: string; code: string; issuer: string };
  amount: string;
  price: string;
}

interface ClaimableBalance {
  id: string;
  asset: string;
  amount: string;
  sponsor?: string;
  claimants: { destination: string; predicate: unknown }[];
  /** Horizon `last_modified_time` — best available proxy for the entry's creation time (used as the reference point for `rel_before` predicates). */
  createdAt?: string;
}

interface Payment {
  id: string;
  type: string;
  createdAt: string;
  direction: "in" | "out";
  assetCode: string;
  amount: string;
  counterparty: string;
  successful: boolean;
  txHash: string;
}

interface RecentTx {
  id: string;
  hash: string;
  createdAt: string;
  operationCount: number;
  successful: boolean;
  memo?: string;
  feeCharged: string;
}

interface AccountFlags {
  authRequired: boolean;
  authRevocable: boolean;
  authImmutable: boolean;
  authClawbackEnabled: boolean;
}

interface WalletDetails {
  publicKey: string;
  sequenceNumber: string;
  xlmBalance: string;
  xlmAvailable: string;
  homeDomain: string;
  inflationDest: string;
  flags: AccountFlags;
  numSubentries: number;
  numSponsoring: number;
  numSponsored: number;
  thresholds: { low: number; med: number; high: number };
  signers: { key: string; weight: number; type: string }[];
  assets: AssetBalance[];
  offers: OpenOffer[];
  claimableBalances: ClaimableBalance[];
  payments: Payment[];
  recentTxs: RecentTx[];
  reservedXlm: number;
  reserveBreakdown: { label: string; count: number; xlm: number }[];
  netFlowXlm30d: number;
  xlmIn30d: number;
  xlmOut30d: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_RESERVE = 0.5;

function calcReserved(
  numSubentries: number,
  numSponsoring: number,
  numSponsored: number,
  assets: AssetBalance[],
  offers: OpenOffer[],
): { total: number; breakdown: { label: string; count: number; xlm: number }[] } {
  const base = 2 * BASE_RESERVE;
  const trustlines = assets.length * BASE_RESERVE;
  const offersXlm = offers.length * BASE_RESERVE;
  const sponsoring = numSponsoring * BASE_RESERVE;
  const sponsored = numSponsored * BASE_RESERVE;
  const other = Math.max(0, numSubentries - assets.length - offers.length) * BASE_RESERVE;

  const breakdown: { label: string; count: number; xlm: number }[] = [
    { label: "Base reserve", count: 2, xlm: base },
  ];
  if (assets.length) breakdown.push({ label: "Trustlines", count: assets.length, xlm: trustlines });
  if (offers.length) breakdown.push({ label: "Open offers", count: offers.length, xlm: offersXlm });
  if (numSponsoring) breakdown.push({ label: "Sponsoring", count: numSponsoring, xlm: sponsoring });
  if (numSponsored) breakdown.push({ label: "Sponsored (refund)", count: numSponsored, xlm: -sponsored });
  if (other > 0) breakdown.push({ label: "Data / other", count: Math.round(other / BASE_RESERVE), xlm: other });

  const total = base + trustlines + offersXlm + sponsoring - sponsored + other;
  return { total, breakdown };
}

function fmtXlm(amount: string | number): string {
  return Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 7 });
}

function fmtAsset(amount: string): string {
  const n = Number(amount);
  if (n === 0) return "0";
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 7 });
}

function assetLabel(type: string, code: string): string {
  return type === "native" ? "XLM" : code;
}

/** Loose client-side format check — NOT a substitute for StrKey.isValidEd25519PublicKey, just gates when to render the destination preview. */
function looksLikeStellarAddress(addr: string): boolean {
  return /^G[A-Z2-7]{55}$/.test(addr.trim());
}

/**
 * Recursively evaluates a Horizon claimant predicate against a reference time.
 * Handles the leaf shapes Horizon actually returns (`unconditional`, `abs_before`,
 * `abs_before_epoch`, `rel_before`) plus composite `and` / `or` / `not`.
 * An unrecognized/empty shape (e.g. unconditional) is treated as satisfied.
 */
function isPredicateSatisfied(predicate: unknown, referenceMs: number): boolean {
  if (!predicate || typeof predicate !== "object") return true;
  const p = predicate as Record<string, unknown>;
  const now = Date.now();

  if ("unconditional" in p) return true;

  if (typeof p.abs_before === "string") {
    return now < new Date(p.abs_before).getTime();
  }
  if (typeof p.abs_before_epoch === "string" || typeof p.abs_before_epoch === "number") {
    return now < Number(p.abs_before_epoch) * 1000;
  }
  if (typeof p.rel_before === "string" || typeof p.rel_before === "number") {
    return now < referenceMs + Number(p.rel_before) * 1000;
  }
  if (Array.isArray(p.and)) {
    return p.and.every((sub) => isPredicateSatisfied(sub, referenceMs));
  }
  if (Array.isArray(p.or)) {
    return p.or.some((sub) => isPredicateSatisfied(sub, referenceMs));
  }
  if ("not" in p) {
    return !isPredicateSatisfied(p.not, referenceMs);
  }

  // Unrecognized shape — treat as satisfied.
  return true;
}

/** Best-effort human-readable unlock date for the common "not claimable before X" shape: `{ not: { abs_before: ISO } }`. */
function predicateUnlockLabel(predicate: unknown): string | null {
  if (!predicate || typeof predicate !== "object") return null;
  const p = predicate as Record<string, unknown>;
  if (p.not && typeof p.not === "object") {
    const inner = p.not as Record<string, unknown>;
    if (typeof inner.abs_before === "string") {
      return new Date(inner.abs_before).toLocaleString();
    }
    if (typeof inner.abs_before_epoch === "string" || typeof inner.abs_before_epoch === "number") {
      return new Date(Number(inner.abs_before_epoch) * 1000).toLocaleString();
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Collapsible section
// ---------------------------------------------------------------------------

function Section({
  title,
  badge,
  badgeColor,
  right,
  defaultOpen = true,
  children,
}: {
  title: string;
  badge?: string;
  badgeColor?: string;
  right?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <Button
        type="button"
        variant="ghost"
        onClick={() => setOpen((v) => !v)}
        className={`w-full h-auto justify-between rounded-none px-4 py-3 hover:bg-muted/30 ${open ? "border-b border-border" : ""}`}
      >
        <div className="flex items-center gap-2">
          {open
            ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
          <span className="text-sm font-semibold">{title}</span>
          {badge && (
            <span className={`text-xs rounded-full px-2 py-0.5 ${badgeColor ?? "text-muted-foreground bg-muted"}`}>
              {badge}
            </span>
          )}
        </div>
        {right && <div onClick={(e) => e.stopPropagation()}>{right}</div>}
      </Button>
      {open && children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reserve breakdown tooltip
// ---------------------------------------------------------------------------

function ReserveBreakdown({ breakdown }: { breakdown: { label: string; count: number; xlm: number }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-block">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen((v) => !v)}
        className="ml-1 h-auto w-auto p-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
        title="Reserve breakdown"
      >
        <Info className="h-3 w-3" />
      </Button>
      {open && (
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 rounded-lg border border-border bg-popover shadow-lg p-3 text-xs">
          <p className="font-semibold mb-2 text-foreground">Reserve breakdown</p>
          {breakdown.map((row) => (
            <div key={row.label} className="flex justify-between mb-1">
              <span className="text-muted-foreground">{row.label} ×{row.count}</span>
              <span className={row.xlm < 0 ? "text-green-500" : ""}>{row.xlm < 0 ? "-" : "+"}{fmtXlm(Math.abs(row.xlm))} XLM</span>
            </div>
          ))}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setOpen(false)}
            className="absolute top-2 right-2 h-auto w-auto p-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function MyWalletPage() {
  const { activeWallet } = useActiveWallet();
  const { settings } = useSettings();
  const horizonUrl = resolveHorizonUrl(settings);
  const horizonServer = useMemo(
    () => new Horizon.Server(horizonUrl, { allowHttp: horizonUrl.startsWith("http://") }),
    [horizonUrl],
  );
  const signerKeypair = useMemo(() => {
    if (!activeWallet?.secretKey) return null;
    try {
      return Keypair.fromSecret(activeWallet.secretKey);
    } catch {
      return null;
    }
  }, [activeWallet?.secretKey]);

  const [details, setDetails] = useState<WalletDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Claim state
  const [claiming, setClaiming] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);

  // Merge state
  const [mergeTarget, setMergeTarget] = useState("");
  const [mergeConfirm, setMergeConfirm] = useState(false);
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [mergeSuccess, setMergeSuccess] = useState(false);

  // Set home domain state
  const [editingDomain, setEditingDomain] = useState(false);
  const [domainInput, setDomainInput] = useState("");
  const [savingDomain, setSavingDomain] = useState(false);
  const [domainError, setDomainError] = useState<string | null>(null);

  async function load(pubkey: string) {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    setDetails(null);

    try {
      const server = new Horizon.Server(horizonUrl, { allowHttp: horizonUrl.startsWith("http://") });
      const acct = await server.loadAccount(pubkey);

      const nativeBalance = acct.balances.find((b) => b.asset_type === "native") as
        | { balance: string; selling_liabilities?: string }
        | undefined;
      const xlmBalance = nativeBalance?.balance ?? "0";
      const xlmSellingLiabilities = parseFloat(nativeBalance?.selling_liabilities ?? "0");
      const numSubentries = (acct as any).subentry_count ?? 0;
      const numSponsoring = (acct as any).num_sponsoring ?? 0;
      const numSponsored = (acct as any).num_sponsored ?? 0;
      const sequenceNumber = (acct as any).sequence ?? "";
      const rawFlags = (acct as any).flags ?? {};

      const assets: AssetBalance[] = acct.balances
        .filter((b) => b.asset_type !== "native")
        .map((b: any) => ({
          assetType: b.asset_type,
          assetCode: b.asset_code ?? "",
          assetIssuer: b.asset_issuer ?? "",
          balance: b.balance,
          limit: b.limit,
          buyingLiabilities: b.buying_liabilities,
          sellingLiabilities: b.selling_liabilities,
        }));

      // Fetch open offers
      let offers: OpenOffer[] = [];
      try {
        const offersPage = await server.offers().forAccount(pubkey).limit(50).call();
        offers = offersPage.records.map((o: any) => ({
          id: o.id,
          selling: { type: o.selling.asset_type, code: o.selling.asset_code ?? "", issuer: o.selling.asset_issuer ?? "" },
          buying: { type: o.buying.asset_type, code: o.buying.asset_code ?? "", issuer: o.buying.asset_issuer ?? "" },
          amount: o.amount,
          price: o.price,
        }));
      } catch { /* non-critical */ }

      // Fetch claimable balances
      let claimableBalances: ClaimableBalance[] = [];
      try {
        const cbPage = await (server as any).claimableBalances().claimant(pubkey).limit(20).call();
        claimableBalances = (cbPage.records ?? []).map((cb: any) => ({
          id: cb.id,
          asset: cb.asset,
          amount: cb.amount,
          sponsor: cb.sponsor,
          claimants: cb.claimants ?? [],
          createdAt: cb.last_modified_time,
        }));
      } catch { /* non-critical */ }

      // Fetch payments — paginate until we cover the full 30-day window (records
      // arrive newest-first), so 30d net flow isn't silently truncated at 50 ops.
      let payments: Payment[] = [];
      let xlmIn30d = 0;
      let xlmOut30d = 0;
      try {
        const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
        const deriveInfo = (p: any) => {
          const isIn = p.type === "create_account"
            ? p.account === pubkey
            : p.to === pubkey;
          const assetCode = p.asset_type === "native" ? "XLM" : (p.asset_code ?? "?");
          const amount = p.amount ?? p.starting_balance ?? "0";
          const counterparty = p.type === "create_account"
            ? (isIn ? p.funder : p.account)
            : (isIn ? p.from : p.to);
          return { isIn, assetCode, amount, counterparty };
        };

        let page = await server.payments().forAccount(pubkey).limit(50).order("desc").call();
        const allRecords: any[] = [];
        const MAX_PAGES = 20;
        for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex++) {
          const records = page.records as any[];
          if (records.length === 0) break;
          allRecords.push(...records);
          const last = records[records.length - 1];
          const lastTs = new Date(last.created_at).getTime();
          if (lastTs < cutoff || pageIndex === MAX_PAGES - 1) break;
          page = await page.next();
        }

        payments = allRecords
          .slice(0, 50)
          .filter((p) => p.type === "payment" || p.type === "create_account")
          .map((p) => {
            const { isIn, assetCode, amount, counterparty } = deriveInfo(p);
            return {
              id: p.id,
              type: p.type,
              createdAt: p.created_at,
              direction: isIn ? "in" : "out",
              assetCode,
              amount,
              counterparty: counterparty ?? "",
              successful: true,
              txHash: p.transaction_hash ?? "",
            } as Payment;
          });

        // Accumulate 30d XLM flow across every fetched record (not just the first 50 displayed).
        for (const p of allRecords) {
          if (p.type !== "payment" && p.type !== "create_account") continue;
          const { isIn, assetCode, amount } = deriveInfo(p);
          if (assetCode === "XLM") {
            const ts = new Date(p.created_at).getTime();
            if (ts >= cutoff) {
              if (isIn) xlmIn30d += parseFloat(amount);
              else xlmOut30d += parseFloat(amount);
            }
          }
        }
      } catch { /* non-critical */ }

      // Fetch last 10 transactions
      let recentTxs: RecentTx[] = [];
      try {
        const txPage = await server.transactions().forAccount(pubkey).limit(10).order("desc").call();
        recentTxs = txPage.records.map((tx: any) => ({
          id: tx.id,
          hash: tx.hash,
          createdAt: tx.created_at,
          operationCount: tx.operation_count,
          successful: tx.successful,
          memo: tx.memo,
          feeCharged: tx.fee_charged,
        }));
      } catch { /* non-critical */ }

      if (ctrl.signal.aborted) return;

      const { total: reservedXlm, breakdown: reserveBreakdown } = calcReserved(
        numSubentries, numSponsoring, numSponsored, assets, offers
      );
      const xlmAvailable = Math.max(0, Number(xlmBalance) - reservedXlm - xlmSellingLiabilities - 0.00001).toFixed(7);

      setDetails({
        publicKey: pubkey,
        sequenceNumber,
        xlmBalance,
        xlmAvailable,
        homeDomain: (acct as any).home_domain ?? "",
        inflationDest: (acct as any).inflation_destination ?? "",
        flags: {
          authRequired: !!rawFlags.auth_required,
          authRevocable: !!rawFlags.auth_revocable,
          authImmutable: !!rawFlags.auth_immutable,
          authClawbackEnabled: !!rawFlags.auth_clawback_enabled,
        },
        numSubentries,
        numSponsoring,
        numSponsored,
        thresholds: {
          low: (acct as any).thresholds?.low_threshold ?? 0,
          med: (acct as any).thresholds?.med_threshold ?? 0,
          high: (acct as any).thresholds?.high_threshold ?? 0,
        },
        signers: ((acct as any).signers ?? []).map((s: any) => ({
          key: s.key,
          weight: s.weight,
          type: s.type,
        })),
        assets,
        offers,
        claimableBalances,
        payments,
        recentTxs,
        reservedXlm,
        reserveBreakdown,
        netFlowXlm30d: xlmIn30d - xlmOut30d,
        xlmIn30d,
        xlmOut30d,
      });
    } catch (e: unknown) {
      if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    // Switching the active wallet must clear any in-progress destructive/edit
    // flow from the previous wallet — otherwise a confirmed merge state or
    // stale destination address can silently carry over to the new wallet.
    setMergeTarget("");
    setMergeConfirm(false);
    setMergeSuccess(false);
    setEditingDomain(false);
    setDomainInput("");
    if (activeWallet?.publicKey) load(activeWallet.publicKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWallet?.publicKey, horizonUrl]);

  function copyAddr() {
    if (!details) return;
    navigator.clipboard.writeText(details.publicKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function buildAndSubmit(ops: unknown[]) {
    const { Keypair, TransactionBuilder, BASE_FEE, Networks } = await import("stellar-sdk");
    const server = new Horizon.Server(horizonUrl, { allowHttp: horizonUrl.startsWith("http://") });
    const keypair = Keypair.fromSecret(activeWallet!.secretKey);
    const acct = await server.loadAccount(keypair.publicKey());
    const passphrase = settings.network === "testnet" ? Networks.TESTNET
      : settings.network === "futurenet" ? Networks.FUTURENET
      : Networks.PUBLIC;
    const builder = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: passphrase });
    for (const op of ops) builder.addOperation(op as any);
    const tx = builder.setTimeout(30).build();
    tx.sign(keypair);
    await server.submitTransaction(tx);
  }

  async function claimBalance(balanceId: string) {
    if (!activeWallet?.secretKey) return;
    setClaiming(balanceId);
    setClaimError(null);
    try {
      const { Operation } = await import("stellar-sdk");
      await buildAndSubmit([Operation.claimClaimableBalance({ balanceId })]);
      await load(activeWallet.publicKey);
    } catch (e: unknown) {
      setClaimError(e instanceof Error ? e.message : String(e));
    } finally {
      setClaiming(null);
    }
  }

  async function mergeAccount() {
    if (!activeWallet?.secretKey || !mergeTarget.trim()) return;
    setMerging(true);
    setMergeError(null);
    try {
      const { Operation, StrKey } = await import("stellar-sdk");
      if (!StrKey.isValidEd25519PublicKey(mergeTarget.trim())) throw new Error("Invalid destination address");
      if (details && details.assets.length > 0) throw new Error(`Remove all ${details.assets.length} trustline${details.assets.length !== 1 ? "s" : ""} before merging`);
      if (details && details.offers.length > 0) throw new Error(`Cancel all ${details.offers.length} open offer${details.offers.length !== 1 ? "s" : ""} before merging`);
      await buildAndSubmit([Operation.accountMerge({ destination: mergeTarget.trim() })]);
      setMergeSuccess(true);
    } catch (e: unknown) {
      setMergeError(e instanceof Error ? e.message : String(e));
    } finally {
      setMerging(false);
    }
  }

  async function saveHomeDomain() {
    if (!activeWallet?.secretKey) return;
    const trimmedDomain = domainInput.trim();
    if (trimmedDomain.length > 32) {
      setDomainError("Home domain must be 32 characters or fewer.");
      return;
    }
    setSavingDomain(true);
    setDomainError(null);
    try {
      const { Operation } = await import("stellar-sdk");
      await buildAndSubmit([Operation.setOptions({ homeDomain: trimmedDomain || undefined })]);
      setEditingDomain(false);
      await load(activeWallet.publicKey);
    } catch (e: unknown) {
      setDomainError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingDomain(false);
    }
  }

  // ---------------------------------------------------------------------------
  // No wallet connected
  // ---------------------------------------------------------------------------

  if (!activeWallet) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-muted-foreground">
        <Wallet className="h-12 w-12 opacity-30" />
        <p className="text-lg font-medium">No wallet connected</p>
        <p className="text-sm">Connect a wallet from the header to view your account details.</p>
      </div>
    );
  }

  const explorerBase = settings.network === "testnet"
    ? "https://stellar.expert/explorer/testnet"
    : "https://stellar.expert/explorer/public";

  const isFullWallet = !!activeWallet.secretKey;

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">My Wallet</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{activeWallet.name}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => load(activeWallet.publicKey)}
          disabled={loading}
          className="h-auto gap-1.5 px-3 py-1.5 text-xs"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Address bar */}
      <div className="flex items-center gap-2 bg-muted/40 rounded-lg px-4 py-3 border border-border">
        <span className="font-mono text-sm text-muted-foreground select-all flex-1 break-all">
          {activeWallet.publicKey}
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={copyAddr}
          className="h-auto w-auto shrink-0 p-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
          title="Copy address"
        >
          {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
        </Button>
        <a
          href={`${explorerBase}/account/${activeWallet.publicKey}`}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 hover:text-foreground text-muted-foreground transition-colors"
          title="View on Stellar.Expert"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-destructive/10 text-destructive rounded-lg px-4 py-3 text-sm border border-destructive/20">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}
      {claimError && (
        <div className="flex items-center gap-2 bg-destructive/10 text-destructive rounded-lg px-4 py-3 text-sm border border-destructive/20">
          <AlertCircle className="h-4 w-4 shrink-0" />
          Claim failed: {claimError}
        </div>
      )}

      {loading && !details && (
        <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
          <RefreshCw className="h-4 w-4 animate-spin" />
          Loading account…
        </div>
      )}

      {details && (
        <>
          {/* XLM Balance cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Total XLM</p>
              <p className="text-xl font-bold">{fmtXlm(details.xlmBalance)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">XLM</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Available</p>
              <p className="text-xl font-bold text-green-500">{fmtXlm(details.xlmAvailable)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">spendable</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center mb-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Reserved</p>
                <ReserveBreakdown breakdown={details.reserveBreakdown} />
              </div>
              <p className="text-xl font-bold text-yellow-500">{fmtXlm(details.reservedXlm)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {[
                  details.assets.length ? `${details.assets.length} trustline${details.assets.length !== 1 ? "s" : ""}` : null,
                  details.offers.length ? `${details.offers.length} offer${details.offers.length !== 1 ? "s" : ""}` : null,
                  details.numSubentries - details.assets.length - details.offers.length > 0
                    ? `${details.numSubentries - details.assets.length - details.offers.length} other`
                    : null,
                ].filter(Boolean).join(", ") || "base only"}
              </p>
            </div>
            {/* 30-day net flow */}
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">30d Net Flow</p>
              <p className={`text-xl font-bold ${details.netFlowXlm30d >= 0 ? "text-green-500" : "text-red-400"}`}>
                {details.netFlowXlm30d >= 0 ? "+" : ""}{fmtXlm(details.netFlowXlm30d)}
              </p>
              <div className="flex gap-2 text-xs text-muted-foreground mt-0.5">
                <span className="text-green-500">↑{fmtXlm(details.xlmIn30d)}</span>
                <span className="text-red-400">↓{fmtXlm(details.xlmOut30d)}</span>
              </div>
            </div>
          </div>

          {/* Meta row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Home domain */}
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Home Domain</p>
                {isFullWallet && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => { setEditingDomain((v) => !v); setDomainInput(details.homeDomain); setDomainError(null); }}
                    className="h-auto w-auto p-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
                    title="Edit home domain"
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                )}
              </div>
              {editingDomain ? (
                <div className="space-y-2">
                  <Input
                    value={domainInput}
                    onChange={(e) => setDomainInput(e.target.value)}
                    placeholder="example.com"
                    className="w-full h-auto text-sm px-2 py-1"
                  />
                  {domainError && <p className="text-xs text-destructive">{domainError}</p>}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={saveHomeDomain}
                      disabled={savingDomain}
                      className="h-auto gap-1 px-2 py-1 text-xs"
                    >
                      {savingDomain && <RefreshCw className="h-3 w-3 animate-spin" />}
                      Save
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditingDomain(false)}
                      className="h-auto px-2 py-1 text-xs"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : details.homeDomain ? (
                <a
                  href={`https://${details.homeDomain}/.well-known/stellar.toml`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 text-sm font-medium hover:underline"
                >
                  <Globe className="h-4 w-4 text-muted-foreground" />
                  {details.homeDomain}
                  <ExternalLink className="h-3 w-3 text-muted-foreground" />
                </a>
              ) : (
                <p className="text-sm text-muted-foreground italic">Not set</p>
              )}
            </div>

            {/* Thresholds + Sequence */}
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Thresholds</p>
              <div className="flex gap-4 text-sm">
                <span><span className="text-muted-foreground">Low </span>{details.thresholds.low}</span>
                <span><span className="text-muted-foreground">Med </span>{details.thresholds.med}</span>
                <span><span className="text-muted-foreground">High </span>{details.thresholds.high}</span>
              </div>
              <div className="flex items-center gap-1.5 mt-3">
                <Hash className="h-3 w-3 text-muted-foreground" />
                <span className="font-mono text-xs text-muted-foreground break-all">{details.sequenceNumber}</span>
              </div>
            </div>

            {/* Account flags */}
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Account Flags</p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { label: "AUTH_REQUIRED", active: details.flags.authRequired },
                  { label: "AUTH_REVOCABLE", active: details.flags.authRevocable },
                  { label: "AUTH_IMMUTABLE", active: details.flags.authImmutable },
                  { label: "CLAWBACK", active: details.flags.authClawbackEnabled },
                ].map((f) => (
                  <span
                    key={f.label}
                    className={`text-xs rounded px-1.5 py-0.5 font-mono ${
                      f.active
                        ? "bg-orange-500/20 text-orange-500 dark:text-orange-400"
                        : "bg-muted text-muted-foreground/40"
                    }`}
                  >
                    {f.label}
                  </span>
                ))}
              </div>
              {details.inflationDest && (
                <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                  Inflation → <ShortAddress address={details.inflationDest} network={settings.network} />
                </p>
              )}
            </div>
          </div>

          {/* Signers */}
          {details.signers.length > 1 && (
            <Section title="Signers" badge={String(details.signers.length)} defaultOpen={false}>
              <div className="p-4 space-y-1.5">
                {details.signers.map((s) => (
                  <div key={s.key} className="flex items-center justify-between text-sm">
                    <ShortAddress address={s.key} network={settings.network} />
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{s.type}</span>
                      <span className="text-xs bg-muted rounded px-1.5 py-0.5">w:{s.weight}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Claimable balances */}
          {details.claimableBalances.length > 0 && (
            <Section
              title="Claimable Balances"
              badge={`${details.claimableBalances.length} pending`}
              badgeColor="bg-yellow-500/20 text-yellow-600 dark:text-yellow-400"
            >
              <div className="divide-y divide-border">
                {details.claimableBalances.map((cb) => {
                  const [assetCode] = cb.asset.split(":");
                  const claimant = cb.claimants.find((c) => c.destination === activeWallet.publicKey);
                  const referenceMs = cb.createdAt ? new Date(cb.createdAt).getTime() : Date.now();
                  const predicateOk = !claimant || isPredicateSatisfied(claimant.predicate, referenceMs);
                  const unlockLabel = claimant ? predicateUnlockLabel(claimant.predicate) : null;
                  return (
                    <div key={cb.id} className="flex items-center justify-between px-4 py-3 gap-4">
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm">{assetCode}</span>
                          <span className="font-mono text-sm">{fmtAsset(cb.amount)}</span>
                        </div>
                        {cb.sponsor && (
                          <span className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                            from <ShortAddress address={cb.sponsor} network={settings.network} />
                          </span>
                        )}
                      </div>
                      {isFullWallet && (
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => claimBalance(cb.id)}
                            disabled={claiming === cb.id || !predicateOk}
                            className="h-auto gap-1 px-3 py-1.5 text-xs"
                            title={!predicateOk ? "Not yet claimable — predicate not satisfied" : undefined}
                          >
                            {claiming === cb.id ? <RefreshCw className="h-3 w-3 animate-spin" /> : null}
                            Claim
                          </Button>
                          {!predicateOk && (
                            <span className="text-[10px] text-muted-foreground">
                              {unlockLabel ? `claimable after ${unlockLabel}` : "not yet claimable"}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {/* Asset balances */}
          <Section
            title="Assets & Trustlines"
            badge={`${details.assets.length} trustline${details.assets.length !== 1 ? "s" : ""}`}
          >
            {details.assets.length === 0 ? (
              <p className="text-sm text-muted-foreground px-4 py-6 text-center">No trustlines</p>
            ) : (
              <div className="divide-y divide-border">
                {details.assets.map((a) => (
                  <div key={`${a.assetCode}:${a.assetIssuer}`} className="flex items-start justify-between px-4 py-3 gap-4">
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{a.assetCode}</span>
                        <ShortAddress address={a.assetIssuer} network={settings.network} />
                      </div>
                      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mt-0.5">
                        <span>Limit: {fmtAsset(a.limit)}</span>
                        {Number(a.sellingLiabilities) > 0 && <span>Selling: {fmtAsset(a.sellingLiabilities)}</span>}
                        {Number(a.buyingLiabilities) > 0 && <span>Buying: {fmtAsset(a.buyingLiabilities)}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono text-sm font-medium">{fmtAsset(a.balance)}</span>
                      <a
                        href={`/dex-orderbook?base=${encodeURIComponent(a.assetCode)}&baseIssuer=${encodeURIComponent(a.assetIssuer)}`}
                        className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                        title="View DEX orderbook"
                      >
                        <TrendingDown className="h-3.5 w-3.5" />
                      </a>
                      <a
                        href={`/payments?assetCode=${encodeURIComponent(a.assetCode)}&issuer=${encodeURIComponent(a.assetIssuer)}`}
                        className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                        title="Send this asset"
                      >
                        <Coins className="h-3.5 w-3.5" />
                      </a>
                      <a
                        href={`/trustline-manager?assetCode=${encodeURIComponent(a.assetCode)}&issuer=${encodeURIComponent(a.assetIssuer)}&action=remove`}
                        className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        title="Remove trustline"
                      >
                        <X className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Open offers */}
          {details.offers.length > 0 && (
            <Section
              title="Open DEX Offers"
              badge={`${details.offers.length} offer${details.offers.length !== 1 ? "s" : ""}`}
              defaultOpen={false}
              right={
                <a href="/payments" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
                  Manage <ArrowRight className="h-3 w-3" />
                </a>
              }
            >
              <div className="divide-y divide-border">
                {details.offers.map((o) => (
                  <div key={o.id} className="flex items-center justify-between px-4 py-3 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground text-xs">#{o.id}</span>
                      <span>Sell <span className="font-medium">{fmtAsset(o.amount)} {assetLabel(o.selling.type, o.selling.code)}</span></span>
                      <span className="text-muted-foreground">→</span>
                      <span>Buy <span className="font-medium">{assetLabel(o.buying.type, o.buying.code)}</span></span>
                    </div>
                    <span className="text-xs text-muted-foreground">@ {o.price}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Payment history */}
          <Section
            title="Payment History"
            badge={`${details.payments.length} recent`}
            defaultOpen={false}
            right={
              <a href={`${explorerBase}/account/${details.publicKey}#history`} target="_blank" rel="noreferrer"
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
                View all <ExternalLink className="h-3 w-3" />
              </a>
            }
          >
            {details.payments.length === 0 ? (
              <p className="text-sm text-muted-foreground px-4 py-6 text-center">No payments found</p>
            ) : (
              <div className="divide-y divide-border">
                {details.payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between px-4 py-3 gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      {p.direction === "in"
                        ? <ArrowDownLeft className="h-4 w-4 text-green-500 shrink-0" />
                        : <ArrowUpRight className="h-4 w-4 text-red-400 shrink-0" />}
                      <div className="flex flex-col min-w-0">
                        <span className={`text-sm font-medium ${p.direction === "in" ? "text-green-500" : "text-red-400"}`}>
                          {p.direction === "in" ? "+" : "-"}{fmtAsset(p.amount)} {p.assetCode}
                        </span>
                        <span className="text-xs text-muted-foreground flex items-center gap-1 min-w-0">
                          {p.direction === "in" ? "from" : "to"} <ShortAddress address={p.counterparty} network={settings.network} /> · {timeAgo(p.createdAt)}
                        </span>
                      </div>
                    </div>
                    {p.txHash && (
                      <a href={`${explorerBase}/tx/${p.txHash}`} target="_blank" rel="noreferrer"
                        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Recent transactions */}
          <Section
            title="Recent Transactions"
            defaultOpen={false}
            right={
              <a href={`${explorerBase}/account/${details.publicKey}#history`} target="_blank" rel="noreferrer"
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
                View all <ExternalLink className="h-3 w-3" />
              </a>
            }
          >
            {details.recentTxs.length === 0 ? (
              <p className="text-sm text-muted-foreground px-4 py-6 text-center">No transactions found</p>
            ) : (
              <div className="divide-y divide-border">
                {details.recentTxs.map((tx) => (
                  <div key={tx.hash} className="flex items-center justify-between px-4 py-3 gap-4">
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full shrink-0 ${tx.successful ? "bg-green-500" : "bg-red-500"}`} />
                        <span className="font-mono text-xs text-muted-foreground truncate">{tx.hash.slice(0, 16)}…</span>
                        {tx.memo && <span className="text-xs bg-muted rounded px-1.5 py-0.5 truncate max-w-[120px]">{tx.memo}</span>}
                      </div>
                      <div className="flex gap-3 text-xs text-muted-foreground mt-0.5 pl-4">
                        <span>{tx.operationCount} op{tx.operationCount !== 1 ? "s" : ""}</span>
                        <span>fee: {tx.feeCharged} stroops</span>
                        <span>{timeAgo(tx.createdAt)}</span>
                      </div>
                    </div>
                    <a href={`${explorerBase}/tx/${tx.hash}`} target="_blank" rel="noreferrer"
                      className="shrink-0 text-muted-foreground hover:text-foreground transition-colors">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Merge account — destructive, full wallet only */}
          {isFullWallet && (
            <Section
              title="Danger Zone"
              badge="destructive"
              badgeColor="bg-destructive/20 text-destructive"
              defaultOpen={false}
            >
              <div className="p-4 space-y-3">
                <p className="text-sm text-muted-foreground">
                  <strong className="text-foreground">Merge account</strong> — sends all remaining XLM to a destination address and permanently closes this account. All trustlines must be removed first.
                </p>
                {!mergeSuccess ? (
                  <>
                    <Input
                      value={mergeTarget}
                      onChange={(e) => { setMergeTarget(e.target.value); setMergeConfirm(false); }}
                      placeholder="Destination address (G…)"
                      className="w-full h-auto font-mono text-sm px-3 py-2"
                    />
                    {looksLikeStellarAddress(mergeTarget) && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>Sending to:</span>
                        <ShortAddress address={mergeTarget.trim()} network={settings.network} />
                      </div>
                    )}
                    {mergeError && (
                      <div className="flex items-center gap-2 text-destructive text-xs">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                        {mergeError}
                      </div>
                    )}
                    {mergeTarget.length > 0 && !mergeConfirm && (
                      <Button
                        variant="outline"
                        onClick={() => setMergeConfirm(true)}
                        className="h-auto gap-2 border-destructive/50 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Shield className="h-4 w-4" />
                        I understand — confirm merge
                      </Button>
                    )}
                    {mergeConfirm && (
                      <Button
                        variant="destructive"
                        onClick={mergeAccount}
                        disabled={merging}
                        className="h-auto gap-2 px-3 py-2 text-sm"
                      >
                        {merging
                          ? <RefreshCw className="h-4 w-4 animate-spin" />
                          : <Trash2 className="h-4 w-4" />}
                        {merging ? "Merging…" : "Merge account now"}
                      </Button>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-green-500 font-medium">Account merged successfully. All XLM sent to destination.</p>
                )}
              </div>
            </Section>
          )}

          {/* Sponsorship revoke — full wallet only, needs a signing key */}
          {isFullWallet && (
            <Section title="Sponsorships" defaultOpen={false}>
              <div className="p-4">
                <RevokeSponsorshipPanel
                  sponsorPublicKey={activeWallet.publicKey}
                  signerKeypair={signerKeypair}
                  horizonServer={horizonServer}
                  horizonUrl={horizonUrl}
                  network={settings.network}
                />
              </div>
            </Section>
          )}

          {/* Quick links */}
          <Section title="Quick Actions" defaultOpen={false}>
            <div className="p-4 flex flex-wrap gap-2">
              {[
                { label: "Investigate account", href: `/address-investigator?address=${details.publicKey}` },
                { label: "Send payment", href: "/payments" },
                { label: "Manage trustlines", href: "/trustline-manager" },
                { label: "DEX Orderbook", href: "/dex-orderbook" },
                { label: "View on Stellar.Expert", href: `${explorerBase}/account/${details.publicKey}`, external: true },
              ].map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  target={link.external ? "_blank" : undefined}
                  rel={link.external ? "noreferrer" : undefined}
                  className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-full border border-border hover:bg-accent transition-colors"
                >
                  {link.label}
                  <ArrowRight className="h-3 w-3" />
                </a>
              ))}
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
