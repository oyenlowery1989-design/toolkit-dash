"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Asset, StrKey, Keypair, TransactionBuilder, Operation, Memo } from "stellar-sdk";
import { Ghost } from "lucide-react";
import { useAssetGroups } from "@/hooks/use-asset-groups";
import { useActiveWallet } from "@/hooks/use-active-wallet";
import { WalletSelect, WalletAppendSelect } from "@/components/ui/wallet-select";
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
  Save,
  Trash2,
  Users,
  Wallet,
  X,
  XCircle,
} from "lucide-react";
import { useSettings, resolveNetworkPassphrase, type Network } from "@/lib/settings";
import { getErrorMessage } from "@/lib/stellar-helpers";
import { ShortAddress } from "@/components/asset-lookup";
import { downloadCSV } from "@/lib/csv-export";
import { fetchAllHolders } from "@/lib/asset-lookup/fetchers";
import { estimateCost } from "@/lib/bulk-payments/builder";
import { runBulkPayments } from "@/lib/bulk-payments/runner";
import type { BatchResult, AssetSource } from "@/lib/bulk-payments/types";
import { useBulkRecipients } from "@/hooks/use-bulk-recipients";
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

function parseAssetPairs(text: string): { assetCode: string; issuer: string }[] {
  const seen = new Set<string>();
  const results: { assetCode: string; issuer: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/([A-Za-z0-9]{1,12}):([A-Z2-7]{56})/);
    if (!match) continue;
    const assetCode = match[1];
    const issuer = match[2];
    if (!StrKey.isValidEd25519PublicKey(issuer)) continue;
    const key = `${assetCode}:${issuer}`;
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
// Ghost mode types
// ---------------------------------------------------------------------------

type GhostMode = "no_trust" | "underfunded" | "trustline_touch";

const MAX_TRUST_LIMIT = "922337203685.4775807";

interface GhostModeInfo {
  id: GhostMode;
  label: string;
  tagline: string;
  description: string;
  errorCode: string;
  worksFor: string;
}

const GHOST_MODES: GhostModeInfo[] = [
  {
    id: "no_trust",
    label: "Ghost Asset",
    tagline: "op_no_trust — custom asset, no trust line",
    description:
      "Sends a custom asset (GHOST:YOUR_ADDRESS) that none of the recipients have a trust line for. " +
      "The transaction fails at the operation level with op_no_trust. It IS included in the ledger " +
      "and permanently visible on Horizon and Stellar.Expert with your memo. Works for any recipient list.",
    errorCode: "op_no_trust",
    worksFor: "Any addresses (existing or not)",
  },
  {
    id: "underfunded",
    label: "Underfunded",
    tagline: "op_underfunded — native XLM, above your balance",
    description:
      "Sends native XLM but sets the amount slightly above your available balance. " +
      "The first payment operation fails with op_underfunded. The transaction IS included in the " +
      "ledger — visible on Horizon with your memo and a real tx hash. No XLM is transferred. " +
      "This is the only way to send a failed native XLM transaction to existing addresses.",
    errorCode: "op_underfunded",
    worksFor: "Existing addresses only (native XLM)",
  },
  {
    id: "trustline_touch",
    label: "Trustline Touch",
    tagline: "change_trust — on-chain proof, transaction succeeds",
    description:
      "Each sender submits a change_trust(asset, MAX_LIMIT) transaction with your memo. " +
      "The transaction SUCCEEDS and is permanently visible on Horizon and Stellar.Expert. " +
      "No balance changes — this is a no-op if the trustline already exists at max limit. " +
      "Proves the sender signed and submitted a transaction at a specific time with your memo.",
    errorCode: "tx_success",
    worksFor: "Sender accounts only (no recipients needed)",
  },
];

// ---------------------------------------------------------------------------
// Ghost banner
// ---------------------------------------------------------------------------

function GhostBanner({ mode }: { mode: GhostMode }) {
  const info = GHOST_MODES.find((m) => m.id === mode)!;
  const isTrustline = mode === "trustline_touch";
  return (
    <div className={`rounded-md p-4 flex items-start gap-3 ${isTrustline ? "bg-blue-500/10 border border-blue-500/40" : "bg-orange-500/10 border border-orange-500/40"}`}>
      <Ghost className={`h-5 w-5 shrink-0 mt-0.5 ${isTrustline ? "text-blue-500" : "text-orange-500"}`} />
      <div className="space-y-1">
        <p className={`text-sm font-semibold ${isTrustline ? "text-blue-500" : "text-orange-500"}`}>
          {isTrustline ? "Trustline Touch Mode" : "Ghost Payment Mode"} —{" "}
          <span className={`font-mono text-xs ${isTrustline ? "text-blue-400" : "text-orange-400"}`}>{info.errorCode}</span>
        </p>
        <p className="text-xs text-muted-foreground">{info.description}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BatchRow sub-component
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
            <CheckCircle2 className="h-3 w-3" /> Recorded
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
type SenderMode = "single" | "round-robin" | "all-to-all" | "rotate";

export function GhostPaymentsPanel() {
  const searchParams = useSearchParams();
  const urlAssets = searchParams.get("assets");

  const { activeWallet } = useActiveWallet();

  const { autoSave: autoSaveSigningKey } = useAutoSaveSigningKey();

  // --- Form state ---
  const [memo, setMemo] = useState("");
  const [secretKey, setSecretKey] = useState("");

  const effectiveSecretKey = activeWallet?.secretKey ?? secretKey;
  const [senderMode, setSenderMode] = useState<SenderMode>("single");
  const [multipleKeysText, setMultipleKeysText] = useState("");
  const [batchSize, setBatchSize] = useState(100);
  const [feeMultiplier, setFeeMultiplier] = useState(1);
  const [showSecret, setShowSecret] = useState(false);
  const [amount, setAmount] = useState("0.0000001");
  const [assetType, setAssetType] = useState<"xlm" | "custom">("xlm");
  const [customAssetCode, setCustomAssetCode] = useState("");
  const [customAssetIssuer, setCustomAssetIssuer] = useState("");
  const [sourceTab, setSourceTab] = useState<"manual" | "assets" | "group">(
    urlAssets ? "assets" : "manual",
  );
  const [manualText, setManualText] = useState("");
  const [assetsText, setAssetsText] = useState(urlAssets ?? "");
  const [assetSources, setAssetSources] = useState<AssetSource[]>([]);
  const [fetchingHolders, setFetchingHolders] = useState(false);
  const [fetchProgress, setFetchProgress] = useState<string | null>(null);
  const [minBalance, setMinBalance] = useState(0);
  const [excludeText, setExcludeText] = useState("");
  const [showExclude, setShowExclude] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("configure");
  const [batchResults, setBatchResults] = useState<BatchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [balanceXlm, setBalanceXlm] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [ghostMode, setGhostMode] = useState<GhostMode>("no_trust");
  // For underfunded mode: computed amount that exceeds balance, set at preview time
  const [underfundedAmount, setUnderfundedAmount] = useState<string | null>(null);
  const [repeatTimes, setRepeatTimes] = useState(1);
  const [currentRound, setCurrentRound] = useState<number>(0);

  // Auto-fill ghost asset (GHOST:SENDER_ADDRESS) when secret key is entered.
  // Only in no_trust mode. Recipients have no trust line → op_no_trust → fails on-chain.
  useEffect(() => {
    if (ghostMode !== "no_trust") return;
    try {
      const pub = Keypair.fromSecret(effectiveSecretKey.trim()).publicKey();
      setAssetType("custom");
      setCustomAssetCode("GHOST");
      setCustomAssetIssuer(pub);
    } catch {
      // Invalid key — leave asset as-is
    }
  }, [effectiveSecretKey, ghostMode]);

  // When switching modes, reset asset to match mode defaults
  useEffect(() => {
    if (ghostMode === "underfunded") {
      setAssetType("xlm");
      setUnderfundedAmount(null);
    } else if (ghostMode === "trustline_touch") {
      // Clear auto-filled GHOST asset; user supplies asset for trustline touch
      setCustomAssetCode("");
      setCustomAssetIssuer("");
      setAssetType("custom");
    } else {
      // Reapply ghost asset auto-fill
      try {
        const pub = Keypair.fromSecret(effectiveSecretKey.trim()).publicKey();
        setCustomAssetCode("GHOST");
        setCustomAssetIssuer(pub);
        setAssetType("custom");
      } catch {
        // key not valid yet
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ghostMode]);

  const abortRef = useRef<AbortController | null>(null);
  const { settings } = useSettings();
  const network = settings.network;
  const { server: horizonServer, url: horizonUrl } = useHorizonServer(network);

  const { groups } = useAssetGroups();

  const { save: saveList, remove: removeList, forNetwork } = useBulkRecipients();
  const savedLists = forNetwork(network);

  // ---------------------------------------------------------------------------
  // Saved lists
  // ---------------------------------------------------------------------------

  const handleSaveList = useCallback(() => {
    const addresses =
      sourceTab === "manual"
        ? parseValidAddresses(manualText)
        : recipients.length > 0
        ? recipients
        : [];
    if (addresses.length === 0) {
      setError("Nothing to save — add addresses first.");
      return;
    }
    const name = saveName.trim() || `List ${new Date().toLocaleDateString()}`;
    const assets =
      sourceTab === "assets" && assetsText.trim() ? assetsText.trim() : undefined;
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

  // ---------------------------------------------------------------------------
  // Asset helpers
  // ---------------------------------------------------------------------------

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
  const costPerRound = estimateCost(
    recipients.length,
    batchSize,
    feeMultiplier,
    isNative ? parsedAmount : 0,
  );
  const cost = {
    ...costPerRound,
    totalXlm: costPerRound.totalXlm * repeatTimes,
    feesXlm: costPerRound.feesXlm * repeatTimes,
    paymentsXlm: costPerRound.paymentsXlm * repeatTimes,
  };

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  function getExcludeSet(): Set<string> {
    return new Set(parseValidAddresses(excludeText));
  }

  function parseMultipleKeys(): string[] {
    return multipleKeysText
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter((s) => s.startsWith("S") && s.length === 56);
  }

  function validateForm(): string | null {
    if (memoBytes > MEMO_MAX_BYTES)
      return `Memo exceeds ${MEMO_MAX_BYTES} bytes (currently ${memoBytes}).`;
    if (senderMode === "single") {
      if (!effectiveSecretKey.trim()) return "Signing secret key is required.";
      if (!effectiveSecretKey.trim().startsWith("S") || effectiveSecretKey.trim().length !== 56)
        return "Secret key must start with S and be 56 characters.";
    } else {
      const keys = parseMultipleKeys();
      if (keys.length < 2) return "Enter at least 2 secret keys for multi-sender mode.";
    }
    if (ghostMode === "trustline_touch") {
      const code = customAssetCode.trim();
      const issuer = customAssetIssuer.trim();
      if (!code) return "Asset code is required for trustline touch.";
      if (!StrKey.isValidEd25519PublicKey(issuer))
        return "Asset issuer is not a valid address.";
      return null;
    }
    if (!amount.trim() || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0)
      return "Payment amount must be a positive number.";
    if (assetType === "custom") {
      const code = customAssetCode.trim();
      const issuer = customAssetIssuer.trim();
      if (!code) return "Custom asset code is required.";
      if (!StrKey.isValidEd25519PublicKey(issuer))
        return "Custom asset issuer is not a valid address.";
    }
    return null;
  }

  function getSenderPublicKey(): string | null {
    if (senderMode !== "single") {
      const keys = parseMultipleKeys();
      if (keys.length === 0) return null;
      try { return Keypair.fromSecret(keys[0]).publicKey(); } catch { return null; }
    }
    try {
      return Keypair.fromSecret(effectiveSecretKey.trim()).publicKey();
    } catch {
      return null;
    }
  }

  function buildManualRecipients(): string | null {
    const addresses = parseValidAddresses(manualText);
    if (addresses.length === 0) return "Add at least one recipient address.";
    const invalid = addresses.find((a) => !StrKey.isValidEd25519PublicKey(a));
    if (invalid) return `Invalid address: ${invalid}`;
    const senderPub = getSenderPublicKey();
    const excludeSet = getExcludeSet();
    if (senderPub) excludeSet.add(senderPub);
    const filtered = addresses.filter((a) => !excludeSet.has(a));
    setRecipients(filtered);
    return null;
  }

  // ---------------------------------------------------------------------------
  // Fetch holders
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
      setFetchProgress(
        `Done — ${allAddresses.size.toLocaleString()} unique recipients.`,
      );
    }

    setFetchingHolders(false);
  }

  // ---------------------------------------------------------------------------
  // Preview
  // ---------------------------------------------------------------------------

  async function handlePreview() {
    const formErr = validateForm();
    if (formErr) {
      setError(formErr);
      return;
    }
    setError(null);

    // trustline_touch doesn't use recipients — skip recipient validation
    if (ghostMode === "trustline_touch") {
      setPhase("preview");
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
      return;
    }

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

    try {
      const senderPub = getSenderPublicKey();
      if (senderPub) {
        setBalanceLoading(true);
        const account = await horizonServer.loadAccount(senderPub);
        const native = account.balances.find((b) => b.asset_type === "native");
        const bal = native ? parseFloat(native.balance) : 0;
        setBalanceXlm(bal);

        // For underfunded mode: auto-set amount slightly above available balance
        // so the first op fails with op_underfunded.
        // Stellar reserves ~1 XLM base reserve; we add 1 on top to be safe.
        if (ghostMode === "underfunded") {
          const overshoot = (bal + 1).toFixed(7);
          setUnderfundedAmount(overshoot);
        }
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

  async function handleTrustlineTouch() {
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setPhase("sending");
    setError(null);
    setCurrentRound(1);

    const senderKeys =
      senderMode === "single"
        ? [effectiveSecretKey.trim()]
        : parseMultipleKeys();

    const asset = new Asset(customAssetCode.trim(), customAssetIssuer.trim());
    const networkPassphrase = resolveNetworkPassphrase(network);
    const memoText = memo.trim();

    // One batch result per sender key
    const initial: BatchResult[] = senderKeys.map((_, i) => ({
      batchIndex: i,
      count: 1,
      status: "pending",
    }));
    setBatchResults(initial);

    for (let i = 0; i < senderKeys.length; i++) {
      if (abortRef.current.signal.aborted) break;
      const key = senderKeys[i];

      setBatchResults((prev) => {
        const next = [...prev];
        next[i] = { ...next[i], status: "sending" };
        return next;
      });

      try {
        const keypair = Keypair.fromSecret(key);
        const account = await horizonServer.loadAccount(keypair.publicKey());
        const txBuilder = new TransactionBuilder(account, {
          fee: String(100 * feeMultiplier),
          networkPassphrase,
        })
          .addOperation(Operation.changeTrust({ asset, limit: MAX_TRUST_LIMIT }))
          .setTimeout(180);
        if (memoText) txBuilder.addMemo(Memo.text(memoText));
        const tx = txBuilder.build();
        tx.sign(keypair);
        const result = await horizonServer.submitTransaction(tx);
        const hash = (result as { hash?: string }).hash ?? "";
        setBatchResults((prev) => {
          const next = [...prev];
          next[i] = { ...next[i], status: "success", txHash: hash };
          return next;
        });
      } catch (err) {
        if (abortRef.current.signal.aborted) break;
        setBatchResults((prev) => {
          const next = [...prev];
          next[i] = { ...next[i], status: "failed", error: getErrorMessage(err) };
          return next;
        });
      }
    }

    setPhase("done");
  }

  async function handleSend() {
    if (ghostMode === "trustline_touch") {
      return handleTrustlineTouch();
    }

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setPhase("sending");
    setError(null);
    setCurrentRound(1);

    // For underfunded mode, override amount + asset
    const sendAmount =
      ghostMode === "underfunded" && underfundedAmount
        ? underfundedAmount
        : amount.trim();
    const sendAsset =
      ghostMode === "underfunded" ? Asset.native() : getPaymentAsset();

    const senderKeys =
      senderMode === "single"
        ? [effectiveSecretKey.trim()]
        : parseMultipleKeys();

    // Build a flat list of { key, recipients } runs to execute sequentially.
    // Each run maps to a separate block of BatchResults displayed to the user.
    type SendRun = { key: string; recips: string[]; label: string };
    const runs: SendRun[] = [];

    if (senderMode === "single") {
      for (let r = 1; r <= repeatTimes; r++) {
        runs.push({ key: senderKeys[0], recips: recipients, label: repeatTimes > 1 ? `Round ${r}` : "Send" });
      }
    } else if (senderMode === "round-robin") {
      // Split recipients evenly across senders
      const chunkSize = Math.ceil(recipients.length / senderKeys.length);
      for (let r = 1; r <= repeatTimes; r++) {
        senderKeys.forEach((key, ki) => {
          const slice = recipients.slice(ki * chunkSize, (ki + 1) * chunkSize);
          if (slice.length > 0)
            runs.push({ key, recips: slice, label: `Round ${r} · Sender ${ki + 1}` });
        });
      }
    } else if (senderMode === "all-to-all") {
      // Every sender sends to ALL recipients
      for (let r = 1; r <= repeatTimes; r++) {
        senderKeys.forEach((key, ki) => {
          runs.push({ key, recips: recipients, label: `Round ${r} · Sender ${ki + 1}` });
        });
      }
    } else if (senderMode === "rotate") {
      // Each repeat round uses the next key in the list (cycles)
      for (let r = 1; r <= repeatTimes; r++) {
        const key = senderKeys[(r - 1) % senderKeys.length];
        runs.push({ key, recips: recipients, label: `Round ${r} (key ${((r - 1) % senderKeys.length) + 1})` });
      }
    }

    // Initialise all batch result rows up front (one block per run)
    const allBatches: BatchResult[] = [];
    let offset = 0;
    const runOffsets: number[] = [];
    for (const run of runs) {
      runOffsets.push(offset);
      for (let i = 0; i < run.recips.length; i += batchSize) {
        allBatches.push({ batchIndex: offset + Math.floor(i / batchSize), count: Math.min(batchSize, run.recips.length - i), status: "pending" });
      }
      offset += Math.ceil(run.recips.length / batchSize);
    }
    setBatchResults(allBatches);

    try {
      for (let ri = 0; ri < runs.length; ri++) {
        if (abortRef.current.signal.aborted) break;
        const run = runs[ri];
        setCurrentRound(ri + 1);
        await runBulkPayments({
          horizonUrl,
          network,
          secretKey: run.key,
          recipients: run.recips,
          memo: memo.trim(),
          batchSize,
          feeMultiplier,
          amount: sendAmount,
          asset: sendAsset,
          ghost: true,
          signal: abortRef.current.signal,
          onBatchUpdate: (result) => {
            setBatchResults((prev) => {
              const next = [...prev];
              next[runOffsets[ri] + result.batchIndex] = {
                ...result,
                batchIndex: runOffsets[ri] + result.batchIndex,
              };
              return next;
            });
          },
        });
      }
    } catch (err) {
      if (!abortRef.current.signal.aborted) {
        setError(getErrorMessage(err));
      }
    }

    // Auto-save manual signing key if not already in a group
    if (!activeWallet && senderMode === "single") {
      try {
        const { Keypair } = await import("stellar-sdk");
        const pub = Keypair.fromSecret(effectiveSecretKey.trim()).publicKey();
        autoSaveSigningKey(pub);
      } catch { /* invalid key — skip */ }
    }

    setPhase("done");

    // Toast + browser notification
    setBatchResults((prev) => {
      const failedCount = prev.filter((r) => r.status === "failed").reduce((s, r) => s + r.count, 0);
      const successCount = prev.filter((r) => r.status === "success").reduce((s, r) => s + r.count, 0);
      if (failedCount > 0) {
        toast.error(`Batch failed \u2014 ${failedCount} payments failed`);
      } else {
        toast.success("Batch sent successfully");
      }
      notifyIfHidden("Ghost Payments Complete", `${successCount} payments sent`);
      return prev;
    });
  }

  function handleAbort() {
    abortRef.current?.abort();
  }

  function handleReset() {
    abortRef.current?.abort();
    setPhase("configure");
    setBatchResults([]);
    setRecipients([]);
    setAssetSources([]);
    setFetchProgress(null);
    setBalanceXlm(null);
    setError(null);
    setCurrentRound(0);
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
    downloadCSV(
      "ghost-payments-proof.csv",
      ["Batch", "Recipients", "Status", "Proof (Tx Hash)", "Error"],
      rows,
    );
  }

  // ---------------------------------------------------------------------------
  // Derived stats
  // ---------------------------------------------------------------------------

  const successCount = batchResults
    .filter((r) => r.status === "success")
    .reduce((sum, r) => sum + r.count, 0);
  const failedCount = batchResults
    .filter((r) => r.status === "failed")
    .reduce((sum, r) => sum + r.count, 0);

  // ---------------------------------------------------------------------------
  // Render — preview phase
  // ---------------------------------------------------------------------------

  if (phase === "preview") {
    return (
      <div className="space-y-6">
        <GhostBanner mode={ghostMode} />
        <Card>
          <CardHeader>
            <CardTitle>Review before ghost send</CardTitle>
            <CardDescription>
              Confirm the details below. Mode:{" "}
              <span className={`font-mono ${ghostMode === "trustline_touch" ? "text-blue-400" : "text-orange-400"}`}>
                {GHOST_MODES.find((m) => m.id === ghostMode)?.errorCode}
              </span>{" "}
              on <strong>{network}</strong>.{" "}
              {ghostMode === "trustline_touch" ? "Transaction will succeed — no balance changes." : "No funds will move."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 text-sm">
              <div className="rounded-md bg-muted/50 p-3 space-y-1">
                <p className="text-xs text-muted-foreground">
                  {ghostMode === "trustline_touch" ? "Senders" : "Recipients"}
                </p>
                <p className="text-2xl font-bold font-mono">
                  {ghostMode === "trustline_touch"
                    ? (senderMode === "single" ? 1 : parseMultipleKeys().length).toLocaleString()
                    : recipients.length.toLocaleString()}
                </p>
              </div>
              <div className="rounded-md bg-muted/50 p-3 space-y-1">
                <p className="text-xs text-muted-foreground">
                  {ghostMode === "trustline_touch"
                    ? "Transactions"
                    : repeatTimes > 1
                    ? `Batches × ${repeatTimes} rounds`
                    : `Batches (${batchSize} ops each)`}
                </p>
                <p className="text-2xl font-bold font-mono">
                  {ghostMode === "trustline_touch"
                    ? (senderMode === "single" ? 1 : parseMultipleKeys().length).toLocaleString()
                    : costPerRound.batches * repeatTimes}
                </p>
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
              <p className="text-xs text-muted-foreground">{ghostMode === "trustline_touch" ? "Trustline" : "Payment"}</p>
              {ghostMode === "trustline_touch" ? (
                <div className="space-y-1">
                  <p className="font-mono font-semibold">
                    {customAssetCode.trim()} ({customAssetIssuer.trim().slice(0, 4)}…{customAssetIssuer.trim().slice(-4)})
                  </p>
                  <p className="text-xs text-blue-500">
                    change_trust to MAX_LIMIT — no balance change
                  </p>
                </div>
              ) : ghostMode === "underfunded" ? (
                <div className="space-y-1">
                  <p className="font-mono font-semibold">
                    {underfundedAmount ?? "…"} XLM
                  </p>
                  <p className="text-xs text-orange-500">
                    Auto-set above your balance ({balanceXlm?.toFixed(4) ?? "…"} XLM) to guarantee op_underfunded
                  </p>
                </div>
              ) : (
                <p className="font-mono font-semibold">
                  {amount}{" "}
                  {isNative
                    ? "XLM"
                    : `${customAssetCode.trim()} (${customAssetIssuer.trim().slice(0, 4)}…${customAssetIssuer.trim().slice(-4)})`}
                </p>
              )}
            </div>

            {recipients.length > 0 && ghostMode !== "trustline_touch" && (
              <div className="rounded-md border border-border p-3 text-sm space-y-2">
                <p className="text-xs text-muted-foreground">
                  First recipients (sample)
                </p>
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
            {!balanceLoading &&
              balanceXlm !== null &&
              balanceXlm < cost.totalXlm && (
                <div className="rounded-md bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    Insufficient balance. Sender has{" "}
                    <strong>
                      {balanceXlm.toLocaleString(undefined, {
                        maximumFractionDigits: 4,
                      })}{" "}
                      XLM
                    </strong>{" "}
                    but estimated cost is{" "}
                    <strong>
                      {cost.totalXlm.toLocaleString(undefined, {
                        maximumFractionDigits: 4,
                      })}{" "}
                      XLM
                    </strong>
                    .
                  </span>
                </div>
              )}
          </CardContent>
          <CardFooter className="flex gap-2">
            <Button onClick={handleSend}>
              <Ghost className="mr-2 h-4 w-4" />
              {ghostMode === "trustline_touch" ? "Touch Trustlines" : "Ghost Send"}
            </Button>
            <Button variant="outline" onClick={() => setPhase("configure")}>
              Back
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render — sending / done phase
  // ---------------------------------------------------------------------------

  if (phase === "sending" || phase === "done") {
    const sent = batchResults.filter((r) => r.status === "success").length;
    const failed = batchResults.filter((r) => r.status === "failed").length;
    const total = batchResults.length;

    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>{phase === "sending" ? "Sending…" : "Complete"}</span>
              {phase === "done" && (
                <div className="flex items-center gap-2 text-sm font-normal">
                  <span className="text-green-500">
                    {successCount.toLocaleString()} recorded
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
                Run {currentRound} — Batch {Math.min(sent + failed + 1, total)} of {total}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto border rounded-md">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="text-left px-3 py-2">Batch</th>
                    <th className="text-left px-3 py-2">{ghostMode === "trustline_touch" ? "Sender" : "Recipients"}</th>
                    <th className="text-left px-3 py-2">Status</th>
                    <th className="text-left px-3 py-2">Proof (Tx Hash)</th>
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
                <Button variant="outline" onClick={handleExport}>
                  <Download className="mr-2 h-4 w-4" />
                  Export CSV
                </Button>
                <Button variant="outline" onClick={handleReset}>
                  New Ghost Send
                </Button>
              </>
            )}
          </CardFooter>
        </Card>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render — configure phase
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      <GhostBanner mode={ghostMode} />

      {/* Mode selector */}
      <div className="grid gap-3 sm:grid-cols-3">
        {GHOST_MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setGhostMode(m.id)}
            className={`text-left rounded-lg border p-4 transition-all space-y-1.5 ${
              ghostMode === m.id
                ? "border-orange-500/60 bg-orange-500/5 ring-1 ring-orange-500/30"
                : "border-border hover:border-muted-foreground/40 hover:bg-muted/30"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">{m.label}</span>
              {ghostMode === m.id && (
                <span className="text-xs font-medium text-orange-500 bg-orange-500/10 rounded-full px-2 py-0.5">
                  Selected
                </span>
              )}
            </div>
            <p className="text-xs font-mono text-orange-400">{m.tagline}</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {m.description}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              <span className="font-medium">Works for:</span> {m.worksFor}
            </p>
          </button>
        ))}
      </div>

      {/* Sender Mode */}
      <Card>
        <CardHeader>
          <CardTitle>Sender Mode</CardTitle>
          <CardDescription>
            Choose how many accounts will send and how recipients are distributed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={senderMode} onValueChange={(v) => setSenderMode(v as SenderMode)}>
            <TabsList className="mb-4 grid grid-cols-4 w-full">
              <TabsTrigger value="single">Single</TabsTrigger>
              <TabsTrigger value="round-robin">Round-Robin</TabsTrigger>
              <TabsTrigger value="all-to-all">All → All</TabsTrigger>
              <TabsTrigger value="rotate">Rotate</TabsTrigger>
            </TabsList>
            <TabsContent value="single">
              <p className="text-sm text-muted-foreground">
                One account sends to all recipients. Uses the secret key or connected wallet below.
              </p>
            </TabsContent>
            <TabsContent value="round-robin" className="space-y-2">
              <p className="text-sm text-muted-foreground mb-2">
                Recipients are split evenly across all senders. Each sender handles its own slice.
              </p>
              <Label htmlFor="multi-keys-rr">Secret Keys (one per line)</Label>
              <textarea
                id="multi-keys-rr"
                className="w-full min-h-28 rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono"
                placeholder={"S...\nS..."}
                value={multipleKeysText}
                onChange={(e) => setMultipleKeysText(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{parseMultipleKeys().length} valid keys</p>
              <WalletAppendSelect
                onAppend={(sk) => setMultipleKeysText((prev) => prev ? prev + "\n" + sk : sk)}
              />
            </TabsContent>
            <TabsContent value="all-to-all" className="space-y-2">
              <p className="text-sm text-muted-foreground mb-2">
                Every sender pays every recipient. N senders × M recipients = N×M transactions total.
              </p>
              <Label htmlFor="multi-keys-ata">Secret Keys (one per line)</Label>
              <textarea
                id="multi-keys-ata"
                className="w-full min-h-28 rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono"
                placeholder={"S...\nS..."}
                value={multipleKeysText}
                onChange={(e) => setMultipleKeysText(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{parseMultipleKeys().length} valid keys</p>
              <WalletAppendSelect
                onAppend={(sk) => setMultipleKeysText((prev) => prev ? prev + "\n" + sk : sk)}
              />
            </TabsContent>
            <TabsContent value="rotate" className="space-y-2">
              <p className="text-sm text-muted-foreground mb-2">
                Each repeat round uses the next key in the list (cycles). Requires Repeat × ≥ 2.
              </p>
              <Label htmlFor="multi-keys-rot">Secret Keys (one per line)</Label>
              <textarea
                id="multi-keys-rot"
                className="w-full min-h-28 rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono"
                placeholder={"S...\nS..."}
                value={multipleKeysText}
                onChange={(e) => setMultipleKeysText(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{parseMultipleKeys().length} valid keys</p>
              <WalletAppendSelect
                onAppend={(sk) => setMultipleKeysText((prev) => prev ? prev + "\n" + sk : sk)}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Memo + key */}
      <Card>
        <CardHeader>
          <CardTitle>Message &amp; Signing</CardTitle>
          <CardDescription>
            The memo is attached to every ghost transaction and visible on explorers.
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

          {ghostMode === "trustline_touch" ? (
            <div className="space-y-2">
              <Label>Asset to Touch</Label>
              <div className="flex gap-2">
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
              <p className="text-xs text-muted-foreground">
                Each sender will submit change_trust(asset, MAX_LIMIT) with your memo. No balance changes.
              </p>
            </div>
          ) : (
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
                    className={`flex-1 rounded-md border px-3 py-1.5 text-sm transition-colors ${
                      assetType === "xlm"
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border hover:bg-muted/50"
                    }`}
                  >
                    XLM
                  </button>
                  <button
                    type="button"
                    onClick={() => setAssetType("custom")}
                    className={`flex-1 rounded-md border px-3 py-1.5 text-sm transition-colors ${
                      assetType === "custom"
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border hover:bg-muted/50"
                    }`}
                  >
                    Custom
                  </button>
                </div>
                {assetType === "custom" && (
                  <div className="flex gap-2 pt-1">
                    <Input
                      placeholder="CODE"
                      value={customAssetCode}
                      onChange={(e) =>
                        setCustomAssetCode(e.target.value)
                      }
                      className="w-24 font-mono text-xs"
                    />
                    <Input
                      placeholder="ISSUER (G…)"
                      value={customAssetIssuer}
                      onChange={(e) =>
                        setCustomAssetIssuer(e.target.value.trim())
                      }
                      className="font-mono text-xs"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto_auto]">
            {senderMode !== "single" && (
              <p className="text-xs text-muted-foreground col-span-full">
                Secret keys are set in the Sender Mode card above.
              </p>
            )}
            <div className={`space-y-2 ${senderMode !== "single" ? "hidden" : ""}`}>
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
                  const v = Math.min(
                    100,
                    Math.max(1, parseInt(e.target.value) || 1),
                  );
                  setBatchSize(v);
                }}
                className="w-20"
              />
            </div>
            <div className="space-y-2">
              <Label
                htmlFor="fee-mult"
                title="Multiply the base fee (100 stroops) for priority"
              >
                Fee ×
              </Label>
              <Input
                id="fee-mult"
                type="number"
                min={1}
                max={100}
                value={feeMultiplier}
                onChange={(e) => {
                  const v = Math.min(
                    100,
                    Math.max(1, parseInt(e.target.value) || 1),
                  );
                  setFeeMultiplier(v);
                }}
                className="w-20"
              />
            </div>
            <div className="space-y-2">
              <Label
                htmlFor="repeat-times"
                title="Send to all recipients this many times in sequence"
              >
                Repeat ×
              </Label>
              <Input
                id="repeat-times"
                type="number"
                min={1}
                max={100}
                value={repeatTimes}
                onChange={(e) => {
                  const v = Math.min(
                    100,
                    Math.max(1, parseInt(e.target.value) || 1),
                  );
                  setRepeatTimes(v);
                }}
                className="w-20"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Recipients — hidden for trustline_touch (no recipients needed) */}
      {ghostMode !== "trustline_touch" && <Card>
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
            onValueChange={(v) =>
              setSourceTab(v as "manual" | "assets" | "group")
            }
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
                {parseValidAddresses(manualText).length.toLocaleString()} unique
                addresses
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
                  placeholder={
                    "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN\nYOURC:GISSUER…"
                  }
                  value={assetsText}
                  onChange={(e) => setAssetsText(e.target.value)}
                />
              </div>

              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <Label
                    htmlFor="min-balance"
                    className="text-xs whitespace-nowrap"
                  >
                    Min balance
                  </Label>
                  <Input
                    id="min-balance"
                    type="number"
                    min="0"
                    step="1"
                    value={minBalance}
                    onChange={(e) =>
                      setMinBalance(parseFloat(e.target.value) || 0)
                    }
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
                  No asset groups saved yet. Create groups in the Asset Lookup
                  or Asset Sales modules.
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
                  {selectedGroupId &&
                    (() => {
                      const grp = groups.find((g) => g.id === selectedGroupId);
                      if (!grp) return null;
                      return (
                        <div className="rounded-md border border-border p-3 space-y-2">
                          <p className="text-xs text-muted-foreground">
                            Members ({grp.members.length})
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {grp.members.slice(0, 10).map((m) => (
                              <ShortAddress
                                key={m.id}
                                address={m.address}
                                network={network}
                              />
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
                  {parseValidAddresses(excludeText).length.toLocaleString()}{" "}
                  addresses excluded
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
      </Card>}

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
