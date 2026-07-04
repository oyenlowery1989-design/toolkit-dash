"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  Horizon,
  Keypair,
  TransactionBuilder,
  Transaction,
  Operation,
  Asset,
  Claimant,
  Memo,
  StrKey,
} from "stellar-sdk";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Send,
  Loader2,
  AlertTriangle,
  ShieldAlert,
  Eye,
  EyeOff,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  BookUser,
  Plus,
  Trash2,
  Route,
  Wallet,
  Coins,
  RefreshCw,
  Gift,
  Zap,
  ArrowLeftRight,
} from "lucide-react";
import { toast } from "sonner";
import {
  useSettings,
  NETWORK_LABELS,
  resolveHorizonUrl,
  resolveNetworkPassphrase,
} from "@/lib/settings";
import type { Network } from "@/lib/settings";
import { getErrorMessage } from "@/lib/stellar-helpers";
import { shortAddr } from "@/lib/format";
import { useAddressBook } from "@/hooks/use-address-book";
import { useActiveWallet } from "@/hooks/use-active-wallet";
import { useWalletsV2 } from "@/hooks/use-wallets-v2";
import { useAutoSaveSigningKey } from "@/hooks/use-auto-save-signing-key";
import { ShortAddress } from "@/components/asset-lookup";
import { WalletSelect } from "@/components/ui/wallet-select";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TxStatus =
  | "idle"
  | "building"
  | "signing"
  | "submitting"
  | "success"
  | "error";
type MemoType = "none" | "text" | "id" | "hash" | "return";
type PaymentTab = "send" | "path" | "claimable" | "feebump";
type PathMode = "strict-receive" | "strict-send";

interface PaymentLeg {
  id: string;
  /** "native" for XLM, "CODE:ISSUER" for tokens */
  assetKey: string;
  amount: string;
  destination: string;
  removeTrustline?: boolean;
}

interface AccountBalance {
  /** "native" | "CODE:ISSUER" */
  key: string;
  balance: string;
  assetCode: string;
  assetIssuer: string;
}

interface PathRecord {
  id: string;
  sourceAssetType: string;
  sourceAssetCode?: string;
  sourceAssetIssuer?: string;
  sourceAmount: string;
  destinationAssetType: string;
  destinationAssetCode?: string;
  destinationAssetIssuer?: string;
  destinationAmount: string;
  path: Array<{
    asset_type: string;
    asset_code?: string;
    asset_issuer?: string;
  }>;
}

interface ClaimantEntry {
  id: string;
  destination: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLeg(): PaymentLeg {
  return { id: crypto.randomUUID(), assetKey: "native", amount: "", destination: "" };
}

function makeClaimant(): ClaimantEntry {
  return { id: crypto.randomUUID(), destination: "" };
}

function assetFromKey(key: string): Asset {
  if (key === "native") return Asset.native();
  const colonIdx = key.indexOf(":");
  return new Asset(key.slice(0, colonIdx), key.slice(colonIdx + 1));
}

/** Works for both "native"/"CODE:ISSUER" keys and Horizon asset_type/asset_code pairs. */
function assetLabel(keyOrType: string, code?: string): string {
  if (keyOrType === "native") return "XLM";
  if (code !== undefined) return code || "unknown"; // called with Horizon asset_type + asset_code
  return keyOrType.split(":")[0]; // called with "CODE:ISSUER" key
}

function buildMemo(type: MemoType, value: string): Memo {
  switch (type) {
    case "text":   return Memo.text(value);
    case "id":     return Memo.id(value);
    case "hash":   return Memo.hash(value);
    case "return": return Memo.return(value);
    default:       return Memo.none();
  }
}

function isValidAssetCode(code: string): boolean {
  return /^[a-zA-Z0-9]{1,12}$/.test(code);
}

function isLegValid(leg: PaymentLeg): boolean {
  return (
    StrKey.isValidEd25519PublicKey(leg.destination.trim()) &&
    Number(leg.amount) > 0
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PaymentsPage() {
  // -- Tab state
  const [activeTab, setActiveTab] = useState<PaymentTab>("send");

  // -- Multi-leg send state
  const [legs, setLegs] = useState<PaymentLeg[]>([makeLeg()]);

  // -- Account balances for asset picker
  const [accountBalances, setAccountBalances] = useState<AccountBalance[]>([]);
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [balancesError, setBalancesError] = useState<string | null>(null);

  // -- Path payment fields
  const [pathMode, setPathMode] = useState<PathMode>("strict-receive");
  const [srcIsNative, setSrcIsNative] = useState(true);
  const [srcAssetCode, setSrcAssetCode] = useState("");
  const [srcAssetIssuer, setSrcAssetIssuer] = useState("");
  const [maxSendAmount, setMaxSendAmount] = useState("");   // strict-receive
  const [exactSendAmount, setExactSendAmount] = useState(""); // strict-send
  const [destIsNative, setDestIsNative] = useState(true);
  const [destAssetCode, setDestAssetCode] = useState("");
  const [destAssetIssuer, setDestAssetIssuer] = useState("");
  const [destAmount, setDestAmount] = useState("");        // strict-receive exact dest
  const [minReceiveAmount, setMinReceiveAmount] = useState(""); // strict-send min receive
  const [pathDest, setPathDest] = useState("");
  const [paths, setPaths] = useState<PathRecord[]>([]);
  const [selectedPathIndex, setSelectedPathIndex] = useState<number | null>(null);
  const [isFindingPaths, setIsFindingPaths] = useState(false);
  const [pathError, setPathError] = useState<string | null>(null);

  // -- Claimable balance fields
  const [claimAssetKey, setClaimAssetKey] = useState("native");
  const [claimAmount, setClaimAmount] = useState("");
  const [claimants, setClaimants] = useState<ClaimantEntry[]>([makeClaimant()]);

  // -- Fee bump fields
  const [innerTxXdr, setInnerTxXdr] = useState("");
  const [parsedInnerTxOps, setParsedInnerTxOps] = useState<number | null>(null);
  const [parsedInnerTxFee, setParsedInnerTxFee] = useState<string | null>(null);
  const [innerTxParseError, setInnerTxParseError] = useState<string | null>(null);
  const [feeBumpBaseFee, setFeeBumpBaseFee] = useState("200");

  // -- Memo
  const [memoType, setMemoType] = useState<MemoType>("none");
  const [memoValue, setMemoValue] = useState("");

  // -- Fee
  const [fee, setFee] = useState("100");

  // -- Network (global)
  const { settings } = useSettings();
  const network = settings.network;

  // -- Address book
  const { entries: addressBookEntries, setEntries: setAddressBookEntries } = useAddressBook();
  const [addressBookOpen, setAddressBookOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newKey, setNewKey] = useState("");
  /** Which leg to apply address book selection to */
  const [addressBookTargetLegId, setAddressBookTargetLegId] = useState<string | null>(null);

  // -- Active wallet
  const { activeWallet } = useActiveWallet();
  const { wallets } = useWalletsV2();
  const { autoSave: autoSaveSigningKey } = useAutoSaveSigningKey();

  // -- Secret key (security: stored in ref, not state)
  const secretKeyRef = useRef<string>("");
  const [secretKeyDisplay, setSecretKeyDisplay] = useState("");
  const [showSecret, setShowSecret] = useState(false);

  // -- Signing wallet: which wallet to use for signing
  const [signingWalletId, setSigningWalletId] = useState<string | null>(null);

  // When active wallet changes, default signing wallet to it
  useEffect(() => {
    setSigningWalletId(activeWallet?.id ?? null);
  }, [activeWallet?.id]);

  // Sync secretKeyRef from signing wallet or manual input
  useEffect(() => {
    if (signingWalletId) {
      const w = wallets.find((w) => w.id === signingWalletId);
      secretKeyRef.current = w?.secretKey ?? "";
    } else {
      secretKeyRef.current = secretKeyDisplay;
    }
  }, [signingWalletId, wallets, secretKeyDisplay]);

  // -- Transaction status
  const [txStatus, setTxStatus] = useState<TxStatus>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);

  // -- Trustline recovery prompt
  interface TrustlineFix { leg: PaymentLeg; secretKey: string; walletName: string }
  const [trustlinePrompt, setTrustlinePrompt] = useState<TrustlineFix[] | null>(null);
  const [trustlineAdding, setTrustlineAdding] = useState(false);
  const [trustlineStatus, setTrustlineStatus] = useState<string | null>(null);

  // -- Confirmation dialog
  const [confirmOpen, setConfirmOpen] = useState(false);

  // -- Offer cancel counts per leg (for error op-index mapping)
  const legCancelCountsRef = useRef<number[]>([]);

  // -- Clipboard feedback
  const [copied, setCopied] = useState(false);

  // -- Cleanup secret on unmount
  useEffect(() => {
    return () => {
      secretKeyRef.current = "";
    };
  }, []);

  // -- Parse inner tx XDR for fee bump
  useEffect(() => {
    const xdr = innerTxXdr.trim();
    if (!xdr) {
      setParsedInnerTxOps(null);
      setParsedInnerTxFee(null);
      setInnerTxParseError(null);
      return;
    }
    try {
      const networkPassphrase = resolveNetworkPassphrase(network);
      const tx = new Transaction(xdr, networkPassphrase);
      setParsedInnerTxOps(tx.operations.length);
      setParsedInnerTxFee(tx.fee);
      setInnerTxParseError(null);
    } catch (e) {
      setParsedInnerTxOps(null);
      setParsedInnerTxFee(null);
      setInnerTxParseError(getErrorMessage(e));
    }
  }, [innerTxXdr, network]);

  // ---------------------------------------------------------------------------
  // Derive current public key (memoized so effect deps are explicit)
  // ---------------------------------------------------------------------------

  const currentPublicKey = useMemo<string | null>(() => {
    if (signingWalletId) {
      return wallets.find((w) => w.id === signingWalletId)?.publicKey ?? null;
    }
    try {
      const sk = secretKeyDisplay.trim();
      if (sk.startsWith("S") && sk.length > 10) return Keypair.fromSecret(sk).publicKey();
    } catch {}
    return null;
  }, [signingWalletId, wallets, secretKeyDisplay]);

  // ---------------------------------------------------------------------------
  // Load account balances
  // ---------------------------------------------------------------------------

  /** Cache key: "PUBKEY:HORIZON_URL" — ensures reload on network/Horizon change */
  const loadBalancesRef = useRef<string | null>(null);

  const loadBalances = useCallback(async (pubKey: string) => {
    const horizonUrl = resolveHorizonUrl(settings);
    const cacheKey = `${pubKey}:${horizonUrl}`;
    if (loadBalancesRef.current === cacheKey) return;
    loadBalancesRef.current = cacheKey;
    setBalancesLoading(true);
    setBalancesError(null);
    try {
      const server = new Horizon.Server(horizonUrl);
      const account = await server.loadAccount(pubKey);
      const balances: AccountBalance[] = account.balances
        .filter((b) => b.asset_type !== "liquidity_pool_shares")
        .map((b) => {
          if (b.asset_type === "native") {
            return { key: "native", balance: b.balance, assetCode: "XLM", assetIssuer: "" };
          }
          const bal = b as { asset_type: "credit_alphanum4" | "credit_alphanum12"; asset_code: string; asset_issuer: string; balance: string };
          return {
            key: `${bal.asset_code}:${bal.asset_issuer}`,
            balance: bal.balance,
            assetCode: bal.asset_code,
            assetIssuer: bal.asset_issuer,
          };
        });
      // XLM always first — splice to front if not already
      const nativeIdx = balances.findIndex((b) => b.key === "native");
      if (nativeIdx > 0) balances.unshift(balances.splice(nativeIdx, 1)[0]);
      setAccountBalances(balances);
    } catch (e) {
      setBalancesError(getErrorMessage(e));
      setAccountBalances([]);
      loadBalancesRef.current = null;
    } finally {
      setBalancesLoading(false);
    }
  }, [settings]);

  useEffect(() => {
    if (currentPublicKey) {
      loadBalances(currentPublicKey);
    } else {
      setAccountBalances([]);
      setBalancesError(null);
      loadBalancesRef.current = null;
    }
  }, [currentPublicKey, loadBalances]);

  // ---------------------------------------------------------------------------
  // Leg helpers
  // ---------------------------------------------------------------------------

  function updateLeg(id: string, patch: Partial<PaymentLeg>) {
    setLegs((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function removeLeg(id: string) {
    setLegs((prev) => prev.filter((l) => l.id !== id));
  }

  function addLeg() {
    setLegs((prev) => [...prev, makeLeg()]);
  }

  function updateClaimant(id: string, destination: string) {
    setClaimants((prev) => prev.map((c) => (c.id === id ? { ...c, destination } : c)));
  }

  function removeClaimant(id: string) {
    setClaimants((prev) => prev.filter((c) => c.id !== id));
  }

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  function isFormValid(): boolean {
    if (activeTab === "send") {
      return legs.length > 0 && legs.every(isLegValid);
    }
    if (activeTab === "path") {
      const srcValid =
        srcIsNative ||
        (isValidAssetCode(srcAssetCode.trim()) &&
          StrKey.isValidEd25519PublicKey(srcAssetIssuer.trim()));
      const destValid =
        destIsNative ||
        (isValidAssetCode(destAssetCode.trim()) &&
          StrKey.isValidEd25519PublicKey(destAssetIssuer.trim()));
      const destOk = StrKey.isValidEd25519PublicKey(pathDest.trim());
      if (pathMode === "strict-receive") {
        return (
          destOk &&
          Number(destAmount) > 0 &&
          Number(maxSendAmount) > 0 &&
          srcValid &&
          destValid &&
          selectedPathIndex !== null
        );
      } else {
        return (
          destOk &&
          Number(exactSendAmount) > 0 &&
          Number(minReceiveAmount) > 0 &&
          srcValid &&
          destValid &&
          selectedPathIndex !== null
        );
      }
    }
    if (activeTab === "claimable") {
      return (
        Number(claimAmount) > 0 &&
        claimants.length > 0 &&
        claimants.every((c) => StrKey.isValidEd25519PublicKey(c.destination.trim()))
      );
    }
    if (activeTab === "feebump") {
      return (
        innerTxXdr.trim().length > 0 &&
        innerTxParseError === null &&
        parsedInnerTxOps !== null &&
        Number(feeBumpBaseFee) >= 100
      );
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Path finding
  // ---------------------------------------------------------------------------

  const handleFindPaths = useCallback(async () => {
    setPaths([]);
    setSelectedPathIndex(null);
    setPathError(null);

    const destAcct = pathDest.trim();
    if (!StrKey.isValidEd25519PublicKey(destAcct)) {
      setPathError("Invalid destination account.");
      return;
    }

    const srcAsset = srcIsNative
      ? Asset.native()
      : isValidAssetCode(srcAssetCode.trim()) &&
          StrKey.isValidEd25519PublicKey(srcAssetIssuer.trim())
        ? new Asset(srcAssetCode.trim(), srcAssetIssuer.trim())
        : null;
    const dstAsset = destIsNative
      ? Asset.native()
      : isValidAssetCode(destAssetCode.trim()) &&
          StrKey.isValidEd25519PublicKey(destAssetIssuer.trim())
        ? new Asset(destAssetCode.trim(), destAssetIssuer.trim())
        : null;

    if (!srcAsset) { setPathError("Invalid source asset configuration."); return; }
    if (!dstAsset) { setPathError("Invalid destination asset configuration."); return; }

    if (pathMode === "strict-receive") {
      if (Number(destAmount) <= 0) {
        setPathError("Destination amount must be greater than 0.");
        return;
      }
    } else {
      if (Number(exactSendAmount) <= 0) {
        setPathError("Send amount must be greater than 0.");
        return;
      }
    }

    setIsFindingPaths(true);
    try {
      const server = new Horizon.Server(resolveHorizonUrl(settings));

      let records: any[];
      if (pathMode === "strict-receive") {
        const result = await server
          .strictReceivePaths([srcAsset], dstAsset, destAmount)
          .call();
        records = result.records as any[];
      } else {
        const result = await server
          .strictSendPaths(srcAsset, exactSendAmount, [dstAsset])
          .call();
        records = result.records as any[];
      }

      const mapped: PathRecord[] = records.map((r: any, i: number) => ({
        id: String(i),
        sourceAssetType: r.source_asset_type,
        sourceAssetCode: r.source_asset_code,
        sourceAssetIssuer: r.source_asset_issuer,
        sourceAmount: r.source_amount,
        destinationAssetType: r.destination_asset_type,
        destinationAssetCode: r.destination_asset_code,
        destinationAssetIssuer: r.destination_asset_issuer,
        destinationAmount: r.destination_amount,
        path: r.path ?? [],
      }));

      setPaths(mapped);
      if (mapped.length === 0) setPathError("No paths found for this pair and amount.");
    } catch (e) {
      setPathError(getErrorMessage(e));
    } finally {
      setIsFindingPaths(false);
    }
  }, [
    settings, pathDest, pathMode,
    destAmount, exactSendAmount,
    srcIsNative, srcAssetCode, srcAssetIssuer,
    destIsNative, destAssetCode, destAssetIssuer,
  ]);

  // Clear paths when mode changes
  useEffect(() => {
    setPaths([]);
    setSelectedPathIndex(null);
    setPathError(null);
  }, [pathMode]);

  // ---------------------------------------------------------------------------
  // Address book helpers
  // ---------------------------------------------------------------------------

  function handleAddAddress() {
    const label = newLabel.trim();
    const key = newKey.trim();
    if (!label || !StrKey.isValidEd25519PublicKey(key)) return;
    setAddressBookEntries([...addressBookEntries, { label, publicKey: key, timestamp: Date.now() }]);
    setNewLabel("");
    setNewKey("");
  }

  function handleRemoveAddress(index: number) {
    setAddressBookEntries(addressBookEntries.filter((_, i) => i !== index));
  }

  function handleSelectAddress(publicKey: string) {
    if (activeTab === "path") {
      setPathDest(publicKey);
      return;
    }
    const targetId = addressBookTargetLegId ?? legs[0]?.id;
    if (targetId) updateLeg(targetId, { destination: publicKey });
    setAddressBookTargetLegId(null);
  }

  // ---------------------------------------------------------------------------
  // Confirm & Submit
  // ---------------------------------------------------------------------------

  function handleOpenConfirm() {
    if (!isFormValid()) return;
    if (activeTab !== "feebump" && !secretKeyRef.current.trim()) {
      toast.error("Please enter your secret key.");
      return;
    }
    if (activeTab === "feebump" && !secretKeyRef.current.trim()) {
      toast.error("Please select a wallet or enter your secret key for the fee account.");
      return;
    }
    setConfirmOpen(true);
  }

  async function handleSubmit() {
    setConfirmOpen(false);
    setTxStatus("building");
    setTxHash(null);
    setTxError(null);

    try {
      // Fee bump is special — no account load needed for inner tx
      if (activeTab === "feebump") {
        const keypair = Keypair.fromSecret(secretKeyRef.current.trim());
        const networkPassphrase = resolveNetworkPassphrase(network);
        const innerTx = new Transaction(innerTxXdr.trim(), networkPassphrase);
        setTxStatus("signing");
        const feeBumpTx = TransactionBuilder.buildFeeBumpTransaction(
          keypair.publicKey(),
          feeBumpBaseFee,
          innerTx,
          networkPassphrase,
        );
        feeBumpTx.sign(keypair);
        if (!signingWalletId) {
          autoSaveSigningKey(keypair.publicKey());
          secretKeyRef.current = "";
          setSecretKeyDisplay("");
          setShowSecret(false);
        }
        setTxStatus("submitting");
        const server = new Horizon.Server(resolveHorizonUrl(settings));
        const result = await server.submitTransaction(feeBumpTx);
        const hash = (result as any).hash ?? (result as any).id ?? "unknown";
        setTxHash(hash);
        setTxStatus("success");
        toast.success("Fee bump transaction submitted!");
        return;
      }

      // 1. Derive keypair
      const keypair = Keypair.fromSecret(secretKeyRef.current.trim());
      const publicKey = keypair.publicKey();

      // 2. Load account
      const server = new Horizon.Server(resolveHorizonUrl(settings));
      const account = await server.loadAccount(publicKey);

      // 3. Build transaction
      const networkPassphrase = resolveNetworkPassphrase(network);
      const builder = new TransactionBuilder(account, { fee, networkPassphrase });

      if (activeTab === "send") {
        const cancelCounts: number[] = [];
        for (const leg of legs) {
          let cancelCount = 0;
          // If removing trustline, cancel any open sell offers for this asset first
          if (leg.removeTrustline && leg.assetKey !== "native") {
            const [code, issuer] = leg.assetKey.split(":");
            const offersResult = await server.offers().forAccount(publicKey).limit(200).call();
            const offersToCancel = offersResult.records.filter((o: any) => {
              const selling = o.selling;
              return selling.asset_type !== "native" && selling.asset_code === code && selling.asset_issuer === issuer;
            });
            for (const o of offersToCancel) {
              const buyingAsset = (o as any).buying.asset_type === "native"
                ? Asset.native()
                : new Asset((o as any).buying.asset_code, (o as any).buying.asset_issuer);
              builder.addOperation(
                Operation.manageSellOffer({
                  selling: assetFromKey(leg.assetKey),
                  buying: buyingAsset,
                  amount: "0",
                  price: (o as any).price,
                  offerId: (o as any).id,
                }),
              );
              cancelCount++;
            }
          }
          cancelCounts.push(cancelCount);
          builder.addOperation(
            Operation.payment({
              destination: leg.destination.trim(),
              asset: assetFromKey(leg.assetKey),
              amount: leg.amount,
            }),
          );
          if (leg.removeTrustline && leg.assetKey !== "native") {
            builder.addOperation(
              Operation.changeTrust({ asset: assetFromKey(leg.assetKey), limit: "0" }),
            );
          }
        }
        legCancelCountsRef.current = cancelCounts;
      } else if (activeTab === "path") {
        const selectedPath = paths[selectedPathIndex!];
        const sendAsset = srcIsNative ? Asset.native() : new Asset(srcAssetCode.trim(), srcAssetIssuer.trim());
        const receiveAsset = destIsNative ? Asset.native() : new Asset(destAssetCode.trim(), destAssetIssuer.trim());
        const intermediaryPath = selectedPath.path.map((p) =>
          p.asset_type === "native" ? Asset.native() : new Asset(p.asset_code!, p.asset_issuer!),
        );
        if (pathMode === "strict-receive") {
          builder.addOperation(
            Operation.pathPaymentStrictReceive({
              sendAsset,
              sendMax: maxSendAmount,
              destination: pathDest.trim(),
              destAsset: receiveAsset,
              destAmount,
              path: intermediaryPath,
            }),
          );
        } else {
          builder.addOperation(
            Operation.pathPaymentStrictSend({
              sendAsset,
              sendAmount: exactSendAmount,
              destination: pathDest.trim(),
              destAsset: receiveAsset,
              destMin: minReceiveAmount,
              path: intermediaryPath,
            }),
          );
        }
      } else if (activeTab === "claimable") {
        builder.addOperation(
          Operation.createClaimableBalance({
            asset: assetFromKey(claimAssetKey),
            amount: claimAmount,
            claimants: claimants.map(
              (c) => new Claimant(c.destination.trim(), Claimant.predicateUnconditional()),
            ),
          }),
        );
      }

      // 4. Add memo (not for claimable balance — no memo on that op, but it's still valid)
      if (memoType !== "none" && memoValue.trim()) {
        builder.addMemo(buildMemo(memoType, memoValue.trim()));
      }

      // 5. Build & sign
      setTxStatus("signing");
      const tx = builder.setTimeout(30).build();
      tx.sign(keypair);

      // 6. Clear manual secret key after signing
      if (!signingWalletId) {
        autoSaveSigningKey(keypair.publicKey());
        secretKeyRef.current = "";
        setSecretKeyDisplay("");
        setShowSecret(false);
      }

      // 7. Submit — for XLM single-leg, retry as createAccount if no destination
      setTxStatus("submitting");
      let result: Awaited<ReturnType<typeof server.submitTransaction>>;
      try {
        result = await server.submitTransaction(tx);
      } catch (submitErr: any) {
        const opCodes: string[] =
          submitErr?.response?.data?.extras?.result_codes?.operations ?? [];
        const errMsg: string = getErrorMessage(submitErr);
        const isNoDestination = opCodes.includes("op_no_destination") || errMsg.includes("op_no_destination");

        // Build op-index → leg map (each leg emits N cancel ops + 1 payment op + optionally 1 changeTrust op)
        const legOpIndex: number[] = [];
        let opIdx = 0;
        for (let i = 0; i < legs.length; i++) {
          opIdx += (legCancelCountsRef.current[i] ?? 0); // skip cancel ops
          legOpIndex.push(opIdx);                         // payment op index
          opIdx++;
          if (legs[i].removeTrustline && legs[i].assetKey !== "native") opIdx++;
        }

        // Check for op_no_trust — offer to add trustlines if we hold destination keys
        const isNoTrust = opCodes.some((c) => c === "op_no_trust");
        if (activeTab === "send" && isNoTrust) {
          const fixes: TrustlineFix[] = [];
          legs.forEach((leg, i) => {
            if (leg.assetKey === "native") return;
            const paymentOpCode = opCodes[legOpIndex[i]];
            if (paymentOpCode !== "op_no_trust") return;
            const destPub = leg.destination.trim();
            const destWallet = wallets.find((w) => w.publicKey === destPub);
            if (destWallet?.secretKey) {
              fixes.push({ leg, secretKey: destWallet.secretKey, walletName: destWallet.name });
            }
          });
          if (fixes.length > 0) {
            setTxStatus("error");
            setTxError("Destination account(s) missing trustline for this asset.");
            setTrustlinePrompt(fixes);
            return;
          }
        }

        // op_invalid_limit on a changeTrust op means the payment before it failed
        // so balance is still non-zero — give a clear message instead of raw codes
        const hasInvalidLimit = opCodes.some((c) => c === "op_invalid_limit");
        if (activeTab === "send" && hasInvalidLimit && isNoTrust) {
          setTxStatus("error");
          setTxError(
            "Cannot remove trustline: the payment to the destination failed (op_no_trust), " +
            "so the balance is still in your account. Fix the destination trustline first, then retry.",
          );
          return;
        }

        if (activeTab === "send" && legs.length === 1 && legs[0].assetKey === "native" && isNoDestination) {
          toast.info("Destination account not found — retrying as account creation…");
          setTxStatus("building");
          const account2 = await server.loadAccount(keypair.publicKey());
          const builder2 = new TransactionBuilder(account2, { fee, networkPassphrase });
          builder2.addOperation(
            Operation.createAccount({
              destination: legs[0].destination.trim(),
              startingBalance: legs[0].amount,
            }),
          );
          if (memoType !== "none" && memoValue.trim()) {
            builder2.addMemo(buildMemo(memoType, memoValue.trim()));
          }
          const tx2 = builder2.setTimeout(30).build();
          tx2.sign(keypair);
          setTxStatus("submitting");
          result = await server.submitTransaction(tx2);
        } else {
          throw submitErr;
        }
      }

      const hash = (result as any).hash ?? (result as any).id ?? "unknown";
      setTxHash(hash);
      setTxStatus("success");
      toast.success("Transaction submitted successfully!");
    } catch (e) {
      if (!signingWalletId) {
        secretKeyRef.current = "";
        setSecretKeyDisplay("");
        setShowSecret(false);
      }
      setTxError(getErrorMessage(e));
      setTxStatus("error");
      toast.error("Transaction failed: " + getErrorMessage(e));
    }
  }

  // ---------------------------------------------------------------------------
  // Reset
  // ---------------------------------------------------------------------------

  function handleReset() {
    setLegs([makeLeg()]);
    setPathMode("strict-receive");
    setSrcIsNative(true);
    setSrcAssetCode("");
    setSrcAssetIssuer("");
    setMaxSendAmount("");
    setExactSendAmount("");
    setDestIsNative(true);
    setDestAssetCode("");
    setDestAssetIssuer("");
    setDestAmount("");
    setMinReceiveAmount("");
    setPathDest("");
    setPaths([]);
    setSelectedPathIndex(null);
    setPathError(null);
    setClaimAssetKey("native");
    setClaimAmount("");
    setClaimants([makeClaimant()]);
    setInnerTxXdr("");
    setParsedInnerTxOps(null);
    setParsedInnerTxFee(null);
    setInnerTxParseError(null);
    setFeeBumpBaseFee("200");
    setMemoType("none");
    setMemoValue("");
    setFee("100");
    setSecretKeyDisplay("");
    secretKeyRef.current = "";
    setShowSecret(false);
    setTxStatus("idle");
    setTxHash(null);
    setTxError(null);
    setTrustlinePrompt(null);
    setTrustlineStatus(null);
    setCopied(false);
  }

  // ---------------------------------------------------------------------------
  // Trustline recovery
  // ---------------------------------------------------------------------------

  async function handleAddTrustlinesAndRetry() {
    if (!trustlinePrompt) return;
    setTrustlineAdding(true);
    setTxError(null);
    setTrustlineStatus("Adding trustlines\u2026");
    try {
      const server = new Horizon.Server(resolveHorizonUrl(settings));
      const networkPassphrase = resolveNetworkPassphrase(network);

      for (let i = 0; i < trustlinePrompt.length; i++) {
        const fix = trustlinePrompt[i];
        setTrustlineStatus(`Adding trustline for ${assetLabel(fix.leg.assetKey)} on ${fix.walletName}\u2026 (${i + 1}/${trustlinePrompt.length})`);
        const destKeypair = Keypair.fromSecret(fix.secretKey);
        const destAccount = await server.loadAccount(destKeypair.publicKey());
        const asset = assetFromKey(fix.leg.assetKey);
        const trustTx = new TransactionBuilder(destAccount, { fee, networkPassphrase })
          .addOperation(Operation.changeTrust({ asset }))
          .setTimeout(30)
          .build();
        trustTx.sign(destKeypair);
        await server.submitTransaction(trustTx);
        toast.success(`Trustline added on ${fix.walletName}`);
      }

      setTrustlineStatus("Trustlines added \u2014 retrying payment\u2026");
      setTrustlinePrompt(null);
      setTrustlineAdding(false);
      setTrustlineStatus(null);
      // Retry the original payment
      setTxStatus("idle");
      setTxError(null);
      handleOpenConfirm();
    } catch (e) {
      setTrustlineAdding(false);
      setTrustlineStatus(null);
      setTxError("Failed to add trustline: " + getErrorMessage(e));
      toast.error("Failed to add trustline: " + getErrorMessage(e));
    }
  }

  // ---------------------------------------------------------------------------
  // Copy to clipboard
  // ---------------------------------------------------------------------------

  async function handleCopyHash() {
    if (!txHash) return;
    await navigator.clipboard.writeText(txHash);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // ---------------------------------------------------------------------------
  // Secret key handler
  // ---------------------------------------------------------------------------

  function handleSecretKeyChange(val: string) {
    secretKeyRef.current = val;
    setSecretKeyDisplay(val);
  }

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  const isSubmitting =
    txStatus === "building" || txStatus === "signing" || txStatus === "submitting";
  const formValid = isFormValid();

  // ---------------------------------------------------------------------------
  // Render — Success state
  // ---------------------------------------------------------------------------

  if (txStatus === "success" && txHash) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-lg font-semibold">Payments</h1>
        </div>

        <Card className="border-green-500/30 bg-green-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-600 dark:text-green-400">
              <Check className="h-5 w-5" />
              Transaction Submitted
            </CardTitle>
            <CardDescription>
              Your transaction was signed and submitted to the {NETWORK_LABELS[network]}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Transaction Hash</Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-md bg-muted px-3 py-2 text-xs font-mono break-all">
                  {txHash}
                </code>
                <Button variant="outline" size="icon" onClick={handleCopyHash} className="shrink-0">
                  {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <Button onClick={handleReset} className="w-full sm:w-auto">
              <Send className="mr-2 h-4 w-4" />
              Send Another
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render — Main
  // ---------------------------------------------------------------------------

  const hasSigningKey = signingWalletId
    ? wallets.some((w) => w.id === signingWalletId)
    : secretKeyDisplay.trim().length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Payments</h1>
      </div>

      {/* ================================================================== */}
      {/* Signing Card — always at top so balances load immediately          */}
      {/* ================================================================== */}
      <Card>
        <CardHeader className="pb-3 pt-4 px-4">
          <CardTitle className="text-sm font-medium">Signing Account</CardTitle>
          <CardDescription className="text-xs">
            Select your wallet or enter a secret key. Available assets load automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 px-4 pb-4">
          {/* Wallet picker */}
          {wallets.length > 0 && (
            <div className="flex items-center justify-between">
              <Label>Wallet</Label>
              <WalletSelect
                currentId={signingWalletId ?? undefined}
                onPick={(w) => setSigningWalletId(w.id)}
                align="end"
              />
            </div>
          )}

          {/* Selected wallet chip */}
          {signingWalletId && (() => {
            const w = wallets.find((w) => w.id === signingWalletId);
            if (!w) return null;
            return (
              <div className="flex items-center gap-2 rounded-md border border-green-500/40 bg-green-500/5 px-3 py-2 text-sm">
                <Wallet className="h-4 w-4 shrink-0 text-green-500" />
                <span className="flex-1 truncate font-medium">{w.name}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {w.publicKey.slice(0, 4)}…{w.publicKey.slice(-4)}
                </span>
              </div>
            );
          })()}

          {/* Manual key input */}
          {!signingWalletId && (
            <div className="space-y-1.5">
              <Label htmlFor="secret-key">Secret Key</Label>
              <div className="flex gap-2">
                <Input
                  id="secret-key"
                  type={showSecret ? "text" : "password"}
                  placeholder="S..."
                  value={secretKeyDisplay}
                  onChange={(e) => handleSecretKeyChange(e.target.value)}
                  className="font-mono text-sm flex-1"
                  autoComplete="off"
                  data-lpignore="true"
                  data-1p-ignore
                />
                <Button
                  variant="outline"
                  size="icon"
                  type="button"
                  onClick={() => setShowSecret(!showSecret)}
                  className="shrink-0"
                >
                  {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          )}

          {/* Security note */}
          <p className="text-xs text-muted-foreground flex items-center gap-1.5 pt-1">
            <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-amber-500" />
            Your key signs locally and is never stored or transmitted.
          </p>
        </CardContent>
      </Card>

      {/* ================================================================== */}
      {/* Payment Tabs                                                       */}
      {/* ================================================================== */}
      <Card>
        <CardHeader className="pb-3 pt-4 px-4">
          <CardTitle className="text-sm font-medium">New Payment</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as PaymentTab)}>
            <TabsList className="w-full grid grid-cols-4">
              <TabsTrigger value="send" className="gap-1.5">
                <Send className="h-3.5 w-3.5" />
                Send
              </TabsTrigger>
              <TabsTrigger value="path" className="gap-1.5">
                <Route className="h-3.5 w-3.5" />
                Path
              </TabsTrigger>
              <TabsTrigger value="claimable" className="gap-1.5">
                <Gift className="h-3.5 w-3.5" />
                Claimable
              </TabsTrigger>
              <TabsTrigger value="feebump" className="gap-1.5">
                <Zap className="h-3.5 w-3.5" />
                Fee Bump
              </TabsTrigger>
            </TabsList>

            {/* ---- Tab 1: Send (unified XLM + tokens, multi-leg) ---- */}
            <TabsContent value="send" className="space-y-4 mt-4">

              {/* Asset balance status bar */}
              <div className="flex items-center gap-2 text-xs text-muted-foreground min-h-[20px]">
                {balancesLoading && (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading your account balances…
                  </>
                )}
                {!balancesLoading && balancesError && (
                  <>
                    <AlertTriangle className="h-3 w-3 text-destructive shrink-0" />
                    <span className="text-destructive">{balancesError}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 px-1 text-xs"
                      onClick={() => {
                        loadBalancesRef.current = null;
                        if (currentPublicKey) loadBalances(currentPublicKey);
                      }}
                    >
                      <RefreshCw className="h-3 w-3 mr-1" />
                      Retry
                    </Button>
                  </>
                )}
                {!balancesLoading && !balancesError && accountBalances.length > 0 && (
                  <>
                    <Coins className="h-3 w-3" />
                    {accountBalances.length} asset{accountBalances.length !== 1 ? "s" : ""} available
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 px-1 text-xs"
                      onClick={() => {
                        loadBalancesRef.current = null;
                        if (currentPublicKey) loadBalances(currentPublicKey);
                      }}
                    >
                      <RefreshCw className="h-3 w-3" />
                    </Button>
                  </>
                )}
                {!balancesLoading && !balancesError && accountBalances.length === 0 && (
                  <span className="italic">
                    Connect a wallet or enter your signing key below to load available assets.
                  </span>
                )}
              </div>

              {/* Payment legs */}
              <div className="space-y-3">
                {legs.map((leg, idx) => (
                  <div
                    key={leg.id}
                    className="rounded-md border border-border bg-muted/20 p-4 space-y-3"
                  >
                    {/* Leg header */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Payment {legs.length > 1 ? idx + 1 : ""}
                      </span>
                      {legs.length > 1 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-destructive"
                          onClick={() => removeLeg(leg.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>

                    {/* Asset picker */}
                    <div className="space-y-2">
                      <Label className="text-sm">Asset</Label>
                      {accountBalances.length > 0 ? (
                        <Select
                          value={leg.assetKey}
                          onValueChange={(val) => updateLeg(leg.id, { assetKey: val })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select asset…" />
                          </SelectTrigger>
                          <SelectContent>
                            {accountBalances.map((b) => (
                              <SelectItem key={b.key} value={b.key}>
                                <div className="flex items-center gap-3">
                                  <span className="font-medium">{b.assetCode}</span>
                                  <span className="text-xs text-muted-foreground font-mono">
                                    {parseFloat(b.balance).toLocaleString(undefined, { maximumFractionDigits: 7 })}
                                  </span>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <div className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
                          <Coins className="h-4 w-4 shrink-0" />
                          {balancesLoading ? "Loading assets…" : "No assets loaded — connect a wallet or enter signing key"}
                        </div>
                      )}
                    </div>

                    {/* Amount */}
                    <div className="space-y-2">
                      <Label className="text-sm">Amount</Label>
                      <div className="flex gap-2">
                        <Input
                          type="number"
                          placeholder="0.00"
                          min="0"
                          step="any"
                          value={leg.amount}
                          onChange={(e) => updateLeg(leg.id, { amount: e.target.value })}
                          className="flex-1"
                        />
                        {(() => {
                          const bal = accountBalances.find((b) => b.key === leg.assetKey);
                          if (!bal) return null;
                          // For XLM, reserve ~1 XLM minimum
                          const maxAmt = leg.assetKey === "native"
                            ? Math.max(0, parseFloat(bal.balance) - 1).toFixed(7)
                            : bal.balance;
                          return (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-9 px-2 text-xs shrink-0"
                              onClick={() => updateLeg(leg.id, { amount: maxAmt })}
                            >
                              Max
                            </Button>
                          );
                        })()}
                      </div>
                      {leg.amount && Number(leg.amount) <= 0 && (
                        <p className="text-xs text-destructive flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3 shrink-0" />
                          Amount must be greater than 0.
                        </p>
                      )}
                      {/* Remove trustline after sending — only for non-native */}
                      {leg.assetKey !== "native" && (
                        <>
                          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none pt-0.5">
                            <input
                              type="checkbox"
                              checked={!!leg.removeTrustline}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                if (checked) {
                                  const bal = accountBalances.find((b) => b.key === leg.assetKey);
                                  const maxAmt = bal ? bal.balance : leg.amount;
                                  updateLeg(leg.id, { removeTrustline: true, amount: maxAmt });
                                } else {
                                  updateLeg(leg.id, { removeTrustline: false });
                                }
                              }}
                              className="h-3.5 w-3.5 rounded border-input"
                            />
                            Remove trustline after sending
                            <span className="text-muted-foreground/60">(send full balance first)</span>
                          </label>
                          {leg.removeTrustline && (() => {
                            const bal = accountBalances.find((b) => b.key === leg.assetKey);
                            if (!bal) return null;
                            if (parseFloat(leg.amount) < parseFloat(bal.balance)) {
                              return (
                                <p className="text-xs text-amber-500 flex items-center gap-1">
                                  <AlertTriangle className="h-3 w-3 shrink-0" />
                                  Amount is less than full balance ({bal.balance}). Trustline removal will fail if balance remains.
                                </p>
                              );
                            }
                            return null;
                          })()}
                        </>
                      )}
                    </div>

                    {/* Destination */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm">Destination Account</Label>
                        <div className="flex items-center gap-1">
                          <WalletSelect
                            onPick={(w) => updateLeg(leg.id, { destination: w.publicKey })}
                            align="end"
                          />
                          {addressBookEntries.length > 0 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-xs gap-1"
                              onClick={() => {
                                setAddressBookTargetLegId(leg.id);
                                setAddressBookOpen(true);
                              }}
                            >
                              <BookUser className="h-3 w-3" />
                              Book
                            </Button>
                          )}
                        </div>
                      </div>
                      <Input
                        placeholder="G..."
                        value={leg.destination}
                        onChange={(e) => updateLeg(leg.id, { destination: e.target.value })}
                        className="font-mono text-sm"
                      />
                      {leg.destination.trim() && StrKey.isValidEd25519PublicKey(leg.destination.trim()) && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Check className="h-3 w-3 text-green-500 shrink-0" />
                          <ShortAddress address={leg.destination.trim()} network={network} />
                        </div>
                      )}
                      {leg.destination.trim() && !StrKey.isValidEd25519PublicKey(leg.destination.trim()) && (
                        <p className="text-xs text-destructive flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3 shrink-0" />
                          Invalid Stellar public key.
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Add payment leg button */}
              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={addLeg}
              >
                <Plus className="h-4 w-4" />
                Add Payment
              </Button>
            </TabsContent>

            {/* ---- Tab 2: Path Payment ---- */}
            <TabsContent value="path" className="space-y-4 mt-4">

              {/* Strict receive / strict send toggle */}
              <div className="flex items-center gap-2 rounded-md border border-border p-1">
                <button
                  type="button"
                  onClick={() => setPathMode("strict-receive")}
                  className={`flex-1 flex items-center justify-center gap-1.5 rounded py-1.5 text-sm font-medium transition-colors ${
                    pathMode === "strict-receive"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <ArrowLeftRight className="h-3.5 w-3.5" />
                  Strict Receive
                </button>
                <button
                  type="button"
                  onClick={() => setPathMode("strict-send")}
                  className={`flex-1 flex items-center justify-center gap-1.5 rounded py-1.5 text-sm font-medium transition-colors ${
                    pathMode === "strict-send"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Send className="h-3.5 w-3.5" />
                  Strict Send
                </button>
              </div>
              <p className="text-xs text-muted-foreground -mt-2">
                {pathMode === "strict-receive"
                  ? "Specify exactly how much the destination receives — you pay up to a max."
                  : "Specify exactly how much you send — destination receives at least a minimum."}
              </p>

              {/* Source asset */}
              <fieldset className="space-y-3 rounded-md border border-border p-4">
                <legend className="px-2 text-sm font-medium text-muted-foreground">
                  Source Asset
                </legend>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="src-native"
                    checked={srcIsNative}
                    onChange={(e) => setSrcIsNative(e.target.checked)}
                    className="h-4 w-4 rounded border-input"
                  />
                  <Label htmlFor="src-native" className="text-sm cursor-pointer">
                    Native (XLM)
                  </Label>
                </div>
                {!srcIsNative && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="src-code">Asset Code</Label>
                      <Input
                        id="src-code"
                        placeholder="USDC"
                        maxLength={12}
                        value={srcAssetCode}
                        onChange={(e) => setSrcAssetCode(e.target.value)}
                      />
                      {srcAssetCode.trim() && !isValidAssetCode(srcAssetCode.trim()) && (
                        <p className="text-xs text-destructive flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3 shrink-0" />
                          1-12 alphanumeric characters.
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="src-issuer">Asset Issuer</Label>
                      <Input
                        id="src-issuer"
                        placeholder="G..."
                        value={srcAssetIssuer}
                        onChange={(e) => setSrcAssetIssuer(e.target.value)}
                        className="font-mono text-sm"
                      />
                      {srcAssetIssuer.trim() && !StrKey.isValidEd25519PublicKey(srcAssetIssuer.trim()) && (
                        <p className="text-xs text-destructive flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3 shrink-0" />
                          Invalid issuer public key.
                        </p>
                      )}
                    </div>
                  </div>
                )}
                {pathMode === "strict-receive" ? (
                  <div className="space-y-2">
                    <Label htmlFor="max-send">Max Send Amount</Label>
                    <Input
                      id="max-send"
                      type="number"
                      placeholder="0.00"
                      min="0"
                      step="any"
                      value={maxSendAmount}
                      onChange={(e) => setMaxSendAmount(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Maximum you are willing to spend.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="exact-send">Exact Send Amount</Label>
                    <Input
                      id="exact-send"
                      type="number"
                      placeholder="0.00"
                      min="0"
                      step="any"
                      value={exactSendAmount}
                      onChange={(e) => setExactSendAmount(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Exact amount you will send.</p>
                  </div>
                )}
              </fieldset>

              {/* Destination asset */}
              <fieldset className="space-y-3 rounded-md border border-border p-4">
                <legend className="px-2 text-sm font-medium text-muted-foreground">
                  Destination Asset
                </legend>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="dest-native"
                    checked={destIsNative}
                    onChange={(e) => setDestIsNative(e.target.checked)}
                    className="h-4 w-4 rounded border-input"
                  />
                  <Label htmlFor="dest-native" className="text-sm cursor-pointer">
                    Native (XLM)
                  </Label>
                </div>
                {!destIsNative && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="dest-code">Asset Code</Label>
                      <Input
                        id="dest-code"
                        placeholder="USDC"
                        maxLength={12}
                        value={destAssetCode}
                        onChange={(e) => setDestAssetCode(e.target.value)}
                      />
                      {destAssetCode.trim() && !isValidAssetCode(destAssetCode.trim()) && (
                        <p className="text-xs text-destructive flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3 shrink-0" />
                          1-12 alphanumeric characters.
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="dest-issuer">Asset Issuer</Label>
                      <Input
                        id="dest-issuer"
                        placeholder="G..."
                        value={destAssetIssuer}
                        onChange={(e) => setDestAssetIssuer(e.target.value)}
                        className="font-mono text-sm"
                      />
                      {destAssetIssuer.trim() && !StrKey.isValidEd25519PublicKey(destAssetIssuer.trim()) && (
                        <p className="text-xs text-destructive flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3 shrink-0" />
                          Invalid issuer public key.
                        </p>
                      )}
                    </div>
                  </div>
                )}
                {pathMode === "strict-receive" ? (
                  <div className="space-y-2">
                    <Label htmlFor="dest-amount">Destination Amount</Label>
                    <Input
                      id="dest-amount"
                      type="number"
                      placeholder="0.00"
                      min="0"
                      step="any"
                      value={destAmount}
                      onChange={(e) => setDestAmount(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Exact amount the destination will receive.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="min-receive">Min Receive Amount</Label>
                    <Input
                      id="min-receive"
                      type="number"
                      placeholder="0.00"
                      min="0"
                      step="any"
                      value={minReceiveAmount}
                      onChange={(e) => setMinReceiveAmount(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Minimum the destination must receive (tx fails if below).</p>
                  </div>
                )}
              </fieldset>

              {/* Destination account */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="path-dest">Destination Account</Label>
                  <div className="flex items-center gap-1">
                    <WalletSelect
                      currentValue={pathDest}
                      onPick={(w) => setPathDest(w.publicKey)}
                    />
                    {addressBookEntries.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs gap-1"
                        onClick={() => setAddressBookOpen(true)}
                      >
                        <BookUser className="h-3 w-3" />
                        Book
                      </Button>
                    )}
                  </div>
                </div>
                <Input
                  id="path-dest"
                  placeholder="G..."
                  value={pathDest}
                  onChange={(e) => setPathDest(e.target.value)}
                  className="font-mono text-sm"
                />
                {pathDest.trim() && StrKey.isValidEd25519PublicKey(pathDest.trim()) && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Check className="h-3 w-3 text-green-500 shrink-0" />
                    <ShortAddress address={pathDest.trim()} network={network} />
                  </div>
                )}
                {pathDest.trim() && !StrKey.isValidEd25519PublicKey(pathDest.trim()) && (
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    Invalid Stellar public key.
                  </p>
                )}
              </div>

              {/* Find paths */}
              <Button
                onClick={handleFindPaths}
                disabled={isFindingPaths}
                variant="outline"
                className="w-full"
              >
                {isFindingPaths ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Route className="mr-2 h-4 w-4" />
                )}
                Find Paths
              </Button>

              {pathError && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  {pathError}
                </p>
              )}

              {/* Path results */}
              {paths.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium">
                    Available Paths ({paths.length})
                  </Label>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {paths.map((p, i) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setSelectedPathIndex(i)}
                        className={`w-full text-left rounded-md border p-3 transition-colors ${
                          selectedPathIndex === i
                            ? "border-primary bg-primary/5 ring-1 ring-primary"
                            : "border-border hover:bg-muted/50"
                        }`}
                      >
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <div
                              className={`h-3 w-3 rounded-full border-2 ${
                                selectedPathIndex === i
                                  ? "border-primary bg-primary"
                                  : "border-muted-foreground"
                              }`}
                            />
                            <span className="font-mono font-medium">
                              {p.sourceAmount}{" "}
                              {assetLabel(p.sourceAssetType, p.sourceAssetCode)}
                            </span>
                            <span className="text-muted-foreground">→</span>
                            <span className="font-mono font-medium">
                              {p.destinationAmount}{" "}
                              {assetLabel(p.destinationAssetType, p.destinationAssetCode)}
                            </span>
                          </div>
                        </div>
                        {p.path.length > 0 && (
                          <div className="mt-1 text-xs text-muted-foreground ml-5">
                            via{" "}
                            {p.path
                              .map((hop) => assetLabel(hop.asset_type, hop.asset_code))
                              .join(" → ")}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </TabsContent>

            {/* ---- Tab 3: Claimable Balance ---- */}
            <TabsContent value="claimable" className="space-y-4 mt-4">
              <p className="text-sm text-muted-foreground">
                Create a claimable balance that claimants can claim at any time (unconditional predicate).
                The asset is locked from your account until claimed or reclaimed.
              </p>

              {/* Asset picker */}
              <div className="space-y-2">
                <Label>Asset</Label>
                {accountBalances.length > 0 ? (
                  <Select
                    value={claimAssetKey}
                    onValueChange={setClaimAssetKey}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select asset…" />
                    </SelectTrigger>
                    <SelectContent>
                      {accountBalances.map((b) => (
                        <SelectItem key={b.key} value={b.key}>
                          <div className="flex items-center gap-3">
                            <span className="font-medium">{b.assetCode}</span>
                            <span className="text-xs text-muted-foreground font-mono">
                              {parseFloat(b.balance).toLocaleString(undefined, { maximumFractionDigits: 7 })}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
                    <Coins className="h-4 w-4 shrink-0" />
                    {balancesLoading ? "Loading assets…" : "Connect a wallet or enter signing key to load assets"}
                  </div>
                )}
              </div>

              {/* Amount */}
              <div className="space-y-2">
                <Label htmlFor="claim-amount">Amount</Label>
                <Input
                  id="claim-amount"
                  type="number"
                  placeholder="0.00"
                  min="0"
                  step="any"
                  value={claimAmount}
                  onChange={(e) => setClaimAmount(e.target.value)}
                />
                {claimAmount && Number(claimAmount) <= 0 && (
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    Amount must be greater than 0.
                  </p>
                )}
              </div>

              {/* Claimants */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Claimants</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs gap-1"
                    onClick={() => setClaimants((prev) => [...prev, makeClaimant()])}
                  >
                    <Plus className="h-3 w-3" />
                    Add
                  </Button>
                </div>
                {claimants.map((c, idx) => (
                  <div key={c.id} className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Input
                        placeholder="G... (claimant address)"
                        value={c.destination}
                        onChange={(e) => updateClaimant(c.id, e.target.value)}
                        className="font-mono text-sm flex-1"
                      />
                      {claimants.length > 1 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => removeClaimant(c.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                    {c.destination.trim() && StrKey.isValidEd25519PublicKey(c.destination.trim()) && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground pl-1">
                        <Check className="h-3 w-3 text-green-500 shrink-0" />
                        <ShortAddress address={c.destination.trim()} network={network} />
                      </div>
                    )}
                    {c.destination.trim() && !StrKey.isValidEd25519PublicKey(c.destination.trim()) && (
                      <p className="text-xs text-destructive flex items-center gap-1 pl-1">
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        Invalid Stellar public key.
                      </p>
                    )}
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  All claimants use an unconditional predicate — they can claim at any time.
                  The creator (you) is also implicitly able to reclaim via clawback if AUTH_CLAWBACK is set.
                </p>
              </div>
            </TabsContent>

            {/* ---- Tab 4: Fee Bump ---- */}
            <TabsContent value="feebump" className="space-y-4 mt-4">
              <p className="text-sm text-muted-foreground">
                Wrap a signed transaction with a higher fee. Useful when the original fee is too low
                and the transaction is stuck. The fee account pays the difference.
              </p>

              {/* Inner transaction XDR */}
              <div className="space-y-2">
                <Label htmlFor="inner-xdr">Inner Transaction XDR</Label>
                <textarea
                  id="inner-xdr"
                  rows={4}
                  placeholder="Paste the signed transaction XDR here…"
                  value={innerTxXdr}
                  onChange={(e) => setInnerTxXdr(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono resize-y min-h-[80px] focus:outline-none focus:ring-2 focus:ring-ring"
                />
                {innerTxXdr.trim() && innerTxParseError && (
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    {innerTxParseError}
                  </p>
                )}
                {innerTxXdr.trim() && !innerTxParseError && parsedInnerTxOps !== null && (
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <Check className="h-3 w-3 text-green-500 shrink-0" />
                    <span>Valid transaction</span>
                    <span className="text-muted-foreground/60">·</span>
                    <span>{parsedInnerTxOps} op{parsedInnerTxOps !== 1 ? "s" : ""}</span>
                    <span className="text-muted-foreground/60">·</span>
                    <span>current fee: {parsedInnerTxFee} stroops</span>
                  </div>
                )}
              </div>

              {/* Base fee for fee bump */}
              <div className="space-y-2 max-w-xs">
                <Label htmlFor="feebump-fee">New Base Fee (stroops per op)</Label>
                <Input
                  id="feebump-fee"
                  type="number"
                  min="100"
                  step="1"
                  value={feeBumpBaseFee}
                  onChange={(e) => setFeeBumpBaseFee(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Must be ≥ 100 stroops and ≥ the inner tx's fee per op.
                  The fee account (your signing wallet) pays the difference.
                </p>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* ================================================================== */}
      {/* Memo + Fee side-by-side — not shown for fee bump                 */}
      {/* ================================================================== */}
      {activeTab !== "feebump" && (
        <div className="grid grid-cols-2 gap-4">
          {/* Memo */}
          <Card>
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-sm font-medium">Memo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 px-4 pb-4">
              <Select value={memoType} onValueChange={(v) => setMemoType(v as MemoType)}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="text">Text</SelectItem>
                  <SelectItem value="id">ID</SelectItem>
                  <SelectItem value="hash">Hash</SelectItem>
                  <SelectItem value="return">Return</SelectItem>
                </SelectContent>
              </Select>
              {memoType !== "none" && (
                <Input
                  className="h-8 text-sm"
                  placeholder={
                    memoType === "text" ? "Memo text…" :
                    memoType === "id" ? "12345" : "64-char hex…"
                  }
                  value={memoValue}
                  onChange={(e) => setMemoValue(e.target.value)}
                />
              )}
            </CardContent>
          </Card>

          {/* Fee */}
          <Card>
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-sm font-medium">Fee</CardTitle>
              <CardDescription className="text-xs">Stroops per operation</CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <Input
                id="fee"
                type="number"
                min="100"
                step="1"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
                className="h-8 text-sm"
              />
            </CardContent>
          </Card>
        </div>
      )}

      {/* ================================================================== */}
      {/* Address Book                                                       */}
      {/* ================================================================== */}
      <Card>
        <CardHeader
          className="cursor-pointer select-none pb-3 pt-3 px-4"
          onClick={() => setAddressBookOpen(!addressBookOpen)}
        >
          <CardTitle className="text-sm font-medium flex items-center justify-between">
            <span className="flex items-center gap-2">
              <BookUser className="h-3.5 w-3.5" />
              Address Book
              {addressBookEntries.length > 0 && (
                <span className="text-xs text-muted-foreground font-normal">({addressBookEntries.length})</span>
              )}
            </span>
            {addressBookOpen ? (
              <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </CardTitle>
        </CardHeader>
        {addressBookOpen && (
          <CardContent className="space-y-4">
            {addressBookEntries.length > 0 ? (
              <div className="space-y-2">
                {addressBookEntries.map((entry, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded-md border border-border p-3 hover:bg-muted/50 transition-colors"
                  >
                    <button
                      type="button"
                      className="flex-1 text-left"
                      onClick={() => handleSelectAddress(entry.publicKey)}
                    >
                      <div className="text-sm font-medium">{entry.label}</div>
                      <div className="text-xs font-mono text-muted-foreground">
                        {shortAddr(entry.publicKey)}
                      </div>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveAddress(i)}
                      className="shrink-0 h-8 w-8 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-2">
                No saved addresses yet.
              </p>
            )}

            {/* Add new address */}
            <div className="border-t border-border pt-4 space-y-3">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">
                Add New Address
              </Label>
              <div className="grid gap-3 sm:grid-cols-[1fr_2fr_auto]">
                <Input
                  placeholder="Label"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                />
                <Input
                  placeholder="G..."
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  className="font-mono text-sm"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleAddAddress}
                  disabled={!newLabel.trim() || !StrKey.isValidEd25519PublicKey(newKey.trim())}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {newKey.trim() && !StrKey.isValidEd25519PublicKey(newKey.trim()) && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  Invalid Stellar public key.
                </p>
              )}
            </div>
          </CardContent>
        )}
      </Card>

      {/* ================================================================== */}
      {/* Submit Button                                                      */}
      {/* ================================================================== */}
      <div className="flex justify-end">
        <Button
          onClick={handleOpenConfirm}
          disabled={isSubmitting || !formValid || !hasSigningKey}
          className="w-full sm:w-auto"
        >
          {isSubmitting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : activeTab === "feebump" ? (
            <Zap className="mr-2 h-4 w-4" />
          ) : activeTab === "claimable" ? (
            <Gift className="mr-2 h-4 w-4" />
          ) : (
            <Send className="mr-2 h-4 w-4" />
          )}
          {txStatus === "building"
            ? "Building..."
            : txStatus === "signing"
              ? "Signing..."
              : txStatus === "submitting"
                ? "Submitting..."
                : activeTab === "feebump"
                  ? "Bump Fee & Submit"
                  : activeTab === "claimable"
                    ? "Create Claimable Balance"
                    : "Sign & Submit"}
        </Button>
      </div>

      {/* ================================================================== */}
      {/* Error display                                                      */}
      {/* ================================================================== */}
      {txStatus === "error" && txError && (
        <Card className={trustlinePrompt ? "border-amber-500/40 bg-amber-500/5" : "border-destructive/50 bg-destructive/5"}>
          <CardContent className="pt-6 space-y-3">
            <div className={`flex items-start gap-3 ${trustlinePrompt ? "text-amber-700 dark:text-amber-400" : "text-destructive"}`}>
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-medium">{trustlinePrompt ? "Trustline Required" : "Transaction Failed"}</p>
                <p className="text-xs">{txError}</p>
              </div>
            </div>

            {trustlinePrompt && (
              <div className="space-y-3 pl-7">
                <div className="space-y-1.5">
                  {trustlinePrompt.map((fix) => (
                    <div key={fix.leg.id} className="flex items-center gap-2 text-xs">
                      <Check className="h-3 w-3 text-green-500 shrink-0" />
                      <span className="text-muted-foreground">
                        <span className="font-medium text-foreground">{fix.walletName}</span>
                        {" — add "}
                        <span className="font-mono font-medium">{assetLabel(fix.leg.assetKey)}</span>
                        {" trustline"}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleAddTrustlinesAndRetry}
                    disabled={trustlineAdding}
                    className="gap-2"
                  >
                    {trustlineAdding
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Plus className="h-3.5 w-3.5" />}
                    {trustlineAdding ? "Adding trustline…" : "Add trustline & retry"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setTrustlinePrompt(null)}
                    disabled={trustlineAdding}
                  >
                    Dismiss
                  </Button>
                </div>
                {trustlineAdding && trustlineStatus && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5 pl-7">
                    <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                    {trustlineStatus}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ================================================================== */}
      {/* Confirmation Dialog                                                */}
      {/* ================================================================== */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Transaction</DialogTitle>
            <DialogDescription>
              Please review the transaction details before submitting.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {activeTab === "send" ? (
              <div className="space-y-3">
                {legs.map((leg, idx) => (
                  <div key={leg.id} className="rounded-md border border-border p-3 text-sm space-y-1.5">
                    {legs.length > 1 && (
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                        Payment {idx + 1}
                      </p>
                    )}
                    <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
                      <span className="text-muted-foreground">Asset:</span>
                      <span className="font-mono font-medium">{assetLabel(leg.assetKey)}</span>
                      <span className="text-muted-foreground">Amount:</span>
                      <span className="font-mono">{leg.amount} {assetLabel(leg.assetKey)}</span>
                      <span className="text-muted-foreground">To:</span>
                      <span className="font-mono text-xs break-all">{leg.destination.trim()}</span>
                    </div>
                  </div>
                ))}
                <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm pt-1">
                  <span className="text-muted-foreground">Fee:</span>
                  <span className="font-mono">{fee} stroops</span>
                  <span className="text-muted-foreground">Network:</span>
                  <span>{NETWORK_LABELS[network]}</span>
                  {memoType !== "none" && memoValue.trim() && (
                    <>
                      <span className="text-muted-foreground">Memo:</span>
                      <span className="font-mono text-xs break-all">({memoType}) {memoValue.trim()}</span>
                    </>
                  )}
                </div>
              </div>
            ) : activeTab === "path" ? (
              <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <span className="text-muted-foreground">Mode:</span>
                <span>{pathMode === "strict-receive" ? "Strict Receive" : "Strict Send"}</span>
                <span className="text-muted-foreground">Destination:</span>
                <span className="font-mono text-xs break-all">{pathDest.trim()}</span>
                {pathMode === "strict-receive" ? (
                  <>
                    <span className="text-muted-foreground">Receive exactly:</span>
                    <span className="font-mono">{destAmount} {destIsNative ? "XLM" : destAssetCode.trim()}</span>
                    <span className="text-muted-foreground">Send at most:</span>
                    <span className="font-mono">{maxSendAmount} {srcIsNative ? "XLM" : srcAssetCode.trim()}</span>
                  </>
                ) : (
                  <>
                    <span className="text-muted-foreground">Send exactly:</span>
                    <span className="font-mono">{exactSendAmount} {srcIsNative ? "XLM" : srcAssetCode.trim()}</span>
                    <span className="text-muted-foreground">Receive at least:</span>
                    <span className="font-mono">{minReceiveAmount} {destIsNative ? "XLM" : destAssetCode.trim()}</span>
                  </>
                )}
                <span className="text-muted-foreground">Fee:</span>
                <span className="font-mono">{fee} stroops</span>
                <span className="text-muted-foreground">Network:</span>
                <span>{NETWORK_LABELS[network]}</span>
                {memoType !== "none" && memoValue.trim() && (
                  <>
                    <span className="text-muted-foreground">Memo:</span>
                    <span className="font-mono text-xs break-all">({memoType}) {memoValue.trim()}</span>
                  </>
                )}
              </div>
            ) : activeTab === "claimable" ? (
              <div className="space-y-3">
                <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                  <span className="text-muted-foreground">Asset:</span>
                  <span className="font-mono font-medium">{assetLabel(claimAssetKey)}</span>
                  <span className="text-muted-foreground">Amount:</span>
                  <span className="font-mono">{claimAmount} {assetLabel(claimAssetKey)}</span>
                  <span className="text-muted-foreground">Claimants:</span>
                  <span>{claimants.length}</span>
                  <span className="text-muted-foreground">Fee:</span>
                  <span className="font-mono">{fee} stroops</span>
                  <span className="text-muted-foreground">Network:</span>
                  <span>{NETWORK_LABELS[network]}</span>
                </div>
                <div className="space-y-1">
                  {claimants.map((c, i) => (
                    <div key={c.id} className="text-xs font-mono text-muted-foreground break-all">
                      {i + 1}. {c.destination.trim()}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <span className="text-muted-foreground">Inner tx ops:</span>
                <span className="font-mono">{parsedInnerTxOps}</span>
                <span className="text-muted-foreground">Inner tx fee:</span>
                <span className="font-mono">{parsedInnerTxFee} stroops</span>
                <span className="text-muted-foreground">New base fee:</span>
                <span className="font-mono">{feeBumpBaseFee} stroops/op</span>
                <span className="text-muted-foreground">Fee account:</span>
                <span className="font-mono text-xs break-all">
                  {currentPublicKey ?? "—"}
                </span>
                <span className="text-muted-foreground">Network:</span>
                <span>{NETWORK_LABELS[network]}</span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit}>Confirm & Submit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
