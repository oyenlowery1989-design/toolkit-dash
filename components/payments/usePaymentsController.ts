"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Keypair, TransactionBuilder, type FeeBumpTransaction, Transaction, Asset, StrKey } from "stellar-sdk";
import { toast } from "sonner";
import { useSettings, resolveNetworkPassphrase } from "@/lib/settings";
import { getErrorMessage } from "@/lib/stellar-helpers";
import { useAddressBook } from "@/hooks/use-address-book";
import { useActiveWallet } from "@/hooks/use-active-wallet";
import { useWalletsV2 } from "@/hooks/use-wallets-v2";
import { useAutoSaveSigningKey } from "@/hooks/use-auto-save-signing-key";
import { useHorizonServer } from "@/hooks/use-horizon-server";
import { checkSignerCanPay, type SignerCheckResult } from "@/lib/stellar-signer-check";
import { signPaymentTransaction } from "@/lib/payments-signing";
import { submitMainnetTransaction } from "@/lib/mainnet-submit-client";
import type { TxStatus, PaymentTab, PathMode, PaymentLeg, AccountBalance, PathRecord, ClaimantEntry } from "@/lib/payments/types";
import { makeLeg, makeClaimant, assetLabel, isValidAssetCode, isLegValid } from "@/lib/payments/helpers";

import { addSendOperations, addPathOperation, addClaimableBalanceOperation, addPaymentMemo, buildCreateAccountTransaction, buildTrustlineTransaction } from "@/lib/payments/transactions";

export function usePaymentsController() {
  // -- Tab state
  const [activeTab, setActiveTab] = useState<PaymentTab>("send");

  // -- Multi-leg send state
  const [legs, setLegs] = useState<PaymentLeg[]>([makeLeg()]);

  // -- Account balances for asset picker
  const [accountBalances, setAccountBalances] = useState<AccountBalance[]>([]);
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [balancesError, setBalancesError] = useState<string | null>(null);
  const [signerCheck, setSignerCheck] = useState<SignerCheckResult | null>(null);

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
  const [pathsFetchedAt, setPathsFetchedAt] = useState<number | null>(null);
  const [isFindingPaths, setIsFindingPaths] = useState(false);
  const [pathError, setPathError] = useState<string | null>(null);
  const pathRequestRef = useRef(0);

  // -- Claimable balance fields
  const [claimAssetKey, setClaimAssetKey] = useState("native");
  const [claimAmount, setClaimAmount] = useState("");
  const [claimants, setClaimants] = useState<ClaimantEntry[]>([makeClaimant()]);

  // -- Fee bump fields
  const [innerTxXdr, setInnerTxXdr] = useState("");
  const [parsedInnerTxOps, setParsedInnerTxOps] = useState<number | null>(null);
  const [parsedInnerTxFee, setParsedInnerTxFee] = useState<string | null>(null);
  const [parsedInnerTxSigs, setParsedInnerTxSigs] = useState<number | null>(null);
  const [innerTxParseError, setInnerTxParseError] = useState<string | null>(null);
  const [feeBumpBaseFee, setFeeBumpBaseFee] = useState("200");

  // -- Memo (plain text; empty = no memo). Required unless explicitly skipped —
  // memos matter for exchange/custodial destinations, so submit stays blocked
  // on an empty memo until the user consciously opts out.
  const [memoValue, setMemoValue] = useState("");
  const [memoSkipped, setMemoSkipped] = useState(false);

  // -- Fee
  const [fee, setFee] = useState("100");

  // -- Network (global)
  const { settings } = useSettings();
  const network = settings.network;
  const { server: horizonServer, url: horizonUrl } = useHorizonServer();
  const pathInputs = JSON.stringify([horizonUrl, pathMode, srcIsNative, srcAssetCode, srcAssetIssuer, destIsNative, destAssetCode, destAssetIssuer, pathDest, destAmount, exactSendAmount]);
  const pathInputsRef = useRef(pathInputs);
  pathInputsRef.current = pathInputs;

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
  interface TrustlineFix { leg: PaymentLeg; walletId: string; publicKey: string; walletName: string }
  const [trustlinePrompt, setTrustlinePrompt] = useState<TrustlineFix[] | null>(null);
  /** Which tab was active when this prompt was raised — retry must target THIS tab, not whatever tab is active now. */
  const [trustlinePromptTab, setTrustlinePromptTab] = useState<PaymentTab | null>(null);
  const [trustlineAdding, setTrustlineAdding] = useState(false);
  const [trustlineStatus, setTrustlineStatus] = useState<string | null>(null);

  // -- Confirmation dialog
  const [confirmOpen, setConfirmOpen] = useState(false);

  // -- Offer cancel counts per leg (for error op-index mapping)
  const legCancelCountsRef = useRef<number[]>([]);

  // -- Guard against a double-invocation race on rapid double-click of Confirm & Submit
  const submittingRef = useRef(false);

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
      setParsedInnerTxSigs(null);
      setInnerTxParseError(null);
      return;
    }
    try {
      const networkPassphrase = resolveNetworkPassphrase(network);
      const tx = new Transaction(xdr, networkPassphrase);
      setParsedInnerTxOps(tx.operations.length);
      setParsedInnerTxFee(tx.fee);
      setParsedInnerTxSigs(tx.signatures.length);
      setInnerTxParseError(null);
    } catch (e) {
      setParsedInnerTxOps(null);
      setParsedInnerTxFee(null);
      setParsedInnerTxSigs(null);
      setInnerTxParseError(getErrorMessage(e));
    }
  }, [innerTxXdr, network]);

  const innerPerOpFee = useMemo(() => {
    if (parsedInnerTxFee === null || !parsedInnerTxOps) return null;
    return Math.ceil(Number(parsedInnerTxFee) / parsedInnerTxOps);
  }, [parsedInnerTxFee, parsedInnerTxOps]);

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
    } catch { }
    return null;
  }, [signingWalletId, wallets, secretKeyDisplay]);

  const selectedWallet = wallets.find((w) => w.id === signingWalletId);
  const hasSigningKey = signingWalletId
    ? Boolean(selectedWallet?.hasKey || selectedWallet?.secretKey)
    : Boolean(currentPublicKey);
  const signingIdentity = `${signingWalletId ?? "manual"}:${currentPublicKey ?? ""}`;
  const signingIdentityRef = useRef(signingIdentity);
  const signingVersionRef = useRef(0);
  useEffect(() => {
    signingVersionRef.current += 1;
    signingIdentityRef.current = signingIdentity;
    setConfirmOpen(false);
    setTrustlinePrompt(null);
    setTrustlinePromptTab(null);
    return () => { signingIdentityRef.current = ""; };
  }, [signingIdentity]);

  // Same secret-key resolution as currentPublicKey, but keeping the Keypair
  // itself — the Sponsorship tab signs its own transactions independently of
  // the shared handleSubmit flow.
  const signerKeypair = useMemo<Keypair | null>(() => {
    try {
      if (signingWalletId) {
        const w = wallets.find((w) => w.id === signingWalletId);
        return w?.secretKey ? Keypair.fromSecret(w.secretKey) : null;
      }
      const sk = secretKeyDisplay.trim();
      if (sk.startsWith("S") && sk.length > 10) return Keypair.fromSecret(sk);
    } catch { }
    return null;
  }, [signingWalletId, wallets, secretKeyDisplay]);

  // ---------------------------------------------------------------------------
  // Load account balances
  // ---------------------------------------------------------------------------

  /** Cache key: "PUBKEY:HORIZON_URL" — ensures reload on network/Horizon change */
  const loadBalancesRef = useRef<string | null>(null);

  const loadBalances = useCallback(async (pubKey: string) => {
    const cacheKey = `${pubKey}:${horizonUrl}`;
    if (loadBalancesRef.current === cacheKey) return;
    loadBalancesRef.current = cacheKey;
    setBalancesLoading(true);
    setBalancesError(null);
    try {
      const account = await horizonServer.loadAccount(pubKey);
      const subentryCount = account.subentry_count;
      const numSponsoring = (account as any).num_sponsoring ?? 0;
      const numSponsored = (account as any).num_sponsored ?? 0;
      const balances: AccountBalance[] = account.balances
        .filter((b) => b.asset_type !== "liquidity_pool_shares")
        .map((b) => {
          if (b.asset_type === "native") {
            return {
              key: "native",
              balance: b.balance,
              assetCode: "XLM",
              assetIssuer: "",
              subentryCount,
              numSponsoring,
              numSponsored,
              sellingLiabilities: b.selling_liabilities,
            };
          }
          const bal = b as { asset_type: "credit_alphanum4" | "credit_alphanum12"; asset_code: string; asset_issuer: string; balance: string; selling_liabilities: string };
          return {
            key: `${bal.asset_code}:${bal.asset_issuer}`,
            balance: bal.balance,
            assetCode: bal.asset_code,
            assetIssuer: bal.asset_issuer,
            subentryCount,
            numSponsoring,
            numSponsored,
            sellingLiabilities: bal.selling_liabilities,
          };
        });
      // XLM always first — splice to front if not already
      const nativeIdx = balances.findIndex((b) => b.key === "native");
      if (nativeIdx > 0) balances.unshift(balances.splice(nativeIdx, 1)[0]);
      // Discard stale result: the user may have switched wallets while this
      // fetch was in flight, in which case currentPublicKey has moved on.
      if (pubKey !== currentPublicKey) return;
      setAccountBalances(balances);
      setSignerCheck(
        checkSignerCanPay(
          { signers: account.signers, thresholds: account.thresholds },
          pubKey,
        ),
      );
    } catch (e) {
      if (pubKey !== currentPublicKey) return;
      setBalancesError(getErrorMessage(e));
      setAccountBalances([]);
      setSignerCheck(null);
      loadBalancesRef.current = null;
    } finally {
      if (pubKey === currentPublicKey) setBalancesLoading(false);
    }
  }, [horizonUrl, horizonServer, currentPublicKey]);

  useEffect(() => {
    if (currentPublicKey) {
      loadBalances(currentPublicKey);
    } else {
      setAccountBalances([]);
      setBalancesError(null);
      setSignerCheck(null);
      loadBalancesRef.current = null;
    }
  }, [currentPublicKey, loadBalances]);

  // Reset stale balance-derived state (amounts/removeTrustline) when the signing
  // account changes — a leg's amount/Max value was computed against the OLD
  // account's balances. Destinations are signer-independent user intent, left alone.
  const prevPublicKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevPublicKeyRef.current;
    if (prev !== null && prev !== currentPublicKey) {
      setLegs((ls) => ls.map((l) => ({ ...l, amount: "", removeTrustline: false })));
      setClaimAmount("");
      setClaimAssetKey("native");
    }
    prevPublicKeyRef.current = currentPublicKey;
  }, [currentPublicKey]);

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
    if (activeTab !== "feebump" && activeTab !== "sponsorship" && !memoValue.trim() && !memoSkipped) return false;
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
      const trimmed = claimants.map((c) => c.destination.trim());
      const noDuplicates = new Set(trimmed).size === trimmed.length;
      return (
        Number(claimAmount) > 0 &&
        claimants.length > 0 &&
        claimants.length <= 10 &&
        noDuplicates &&
        claimants.every((c) => StrKey.isValidEd25519PublicKey(c.destination.trim()))
      );
    }
    if (activeTab === "feebump") {
      return (
        innerTxXdr.trim().length > 0 &&
        innerTxParseError === null &&
        parsedInnerTxOps !== null &&
        Number(feeBumpBaseFee) >= 100 &&
        (innerPerOpFee === null || Number(feeBumpBaseFee) >= innerPerOpFee)
      );
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Path finding
  // ---------------------------------------------------------------------------

  const handleFindPaths = useCallback(async () => {
    const request = ++pathRequestRef.current;
    const inputs = pathInputsRef.current;
    setIsFindingPaths(false);
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
      let records: any[];
      if (pathMode === "strict-receive") {
        const result = await horizonServer
          .strictReceivePaths([srcAsset], dstAsset, destAmount)
          .call();
        records = result.records as any[];
      } else {
        const result = await horizonServer
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

      if (request !== pathRequestRef.current || inputs !== pathInputsRef.current) return;
      setPaths(mapped);
      setPathsFetchedAt(Date.now());
      if (mapped.length === 0) setPathError("No paths found for this pair and amount.");
    } catch (e) {
      if (request === pathRequestRef.current && inputs === pathInputsRef.current) setPathError(getErrorMessage(e));
    } finally {
      if (request === pathRequestRef.current && inputs === pathInputsRef.current) setIsFindingPaths(false);
    }
  }, [
    horizonServer, pathDest, pathMode,
    destAmount, exactSendAmount,
    srcIsNative, srcAssetCode, srcAssetIssuer,
    destIsNative, destAssetCode, destAssetIssuer,
  ]);

  // Clear any previously found paths whenever an input that affects path-finding
  // changes — otherwise a stale route (computed for old inputs) could be submitted
  // alongside newly-edited assets/amounts/destination.
  useEffect(() => {
    pathRequestRef.current++;
    setPaths([]);
    setSelectedPathIndex(null);
    setPathError(null);
    setPathsFetchedAt(null);
    setIsFindingPaths(false);
  }, [
    horizonUrl,
    pathMode,
    srcIsNative, srcAssetCode, srcAssetIssuer,
    destIsNative, destAssetCode, destAssetIssuer,
    pathDest, destAmount, exactSendAmount,
  ]);

  // Tick to keep the confirm dialog's path-staleness warning live while it's open.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!(confirmOpen && activeTab === "path")) return;
    const interval = setInterval(() => forceTick((t) => t + 1), 15000);
    return () => clearInterval(interval);
  }, [confirmOpen, activeTab]);

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
    if (!hasSigningKey) {
      toast.error(signingWalletId ? "This wallet is watch-only; save its signing key in Wallet Manager first." : "Please select a wallet or enter your secret key.");
      return;
    }
    setConfirmOpen(true);
  }

  async function handleSubmit() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    const walletId = signingWalletId;
    const manualSecret = secretKeyRef.current;
    const identity = signingIdentity;
    const version = signingVersionRef.current;
    const publicKey = currentPublicKey;
    let manualKeyCleared = false;
    const assertSignerUnchanged = () => {
      const clearedAfterSigning = !walletId && manualKeyCleared && signingIdentityRef.current === "manual:" && signingVersionRef.current === version + 1;
      if ((signingIdentityRef.current !== identity || signingVersionRef.current !== version) && !clearedAfterSigning) throw new Error("Signing wallet changed. Review the payment again.");
    };
    const sign = async <T extends Transaction | FeeBumpTransaction>(tx: T) => {
      assertSignerUnchanged();
      const signed = await signPaymentTransaction(tx, walletId, manualSecret);
      assertSignerUnchanged();
      return signed;
    };
    try {
      setConfirmOpen(false);
      setTxStatus("building");
      setTxHash(null);
      setTxError(null);

      try {
        if (!publicKey || !hasSigningKey) throw new Error("Select a wallet with a saved signing key.");
        // Fee bump is special — no account load needed for inner tx
        if (activeTab === "feebump") {
          const networkPassphrase = resolveNetworkPassphrase(network);
          const innerTx = new Transaction(innerTxXdr.trim(), networkPassphrase);
          setTxStatus("signing");
          let feeBumpTx = TransactionBuilder.buildFeeBumpTransaction(
            publicKey,
            feeBumpBaseFee,
            innerTx,
            networkPassphrase,
          );
          feeBumpTx = await sign(feeBumpTx);
          if (!signingWalletId) {
            autoSaveSigningKey(publicKey);
            manualKeyCleared = true;
            secretKeyRef.current = "";
            setSecretKeyDisplay("");
            setShowSecret(false);
          }
          setTxStatus("submitting");
          const result = await submitMainnetTransaction(feeBumpTx);
          const hash = (result as any).hash ?? (result as any).id ?? "unknown";
          setTxHash(hash);
          setTxStatus("success");
          toast.success("Fee bump transaction submitted!");
          return;
        }

        // 2. Load account
        const server = horizonServer;
        const account = await server.loadAccount(publicKey);

        // 3. Build transaction
        const networkPassphrase = resolveNetworkPassphrase(network);
        const builder = new TransactionBuilder(account, { fee, networkPassphrase });

        if (activeTab === "send") {
          const needsOffers = legs.some((l) => l.removeTrustline && l.assetKey !== "native");
          let offers: any[] = [];
          if (needsOffers) {
            let page = await server.offers().forAccount(publicKey).limit(200).call();
            offers = [...page.records];
            while (page.records.length === 200) {
              page = await page.next();
              offers = [...offers, ...page.records];
            }
          }
          legCancelCountsRef.current = addSendOperations(builder, legs, offers);
        } else if (activeTab === "path") {
          addPathOperation(builder, { selectedPath: paths[selectedPathIndex!], pathMode, srcIsNative, srcAssetCode, srcAssetIssuer, destIsNative, destAssetCode, destAssetIssuer, maxSendAmount, pathDest, destAmount, exactSendAmount, minReceiveAmount });
        } else if (activeTab === "claimable") {
          addClaimableBalanceOperation(builder, claimAssetKey, claimAmount, claimants);
        }

        // 4. Add memo (not for claimable balance — no memo on that op, but it's still valid)
        addPaymentMemo(builder, memoValue);

        // 5. Build & sign
        setTxStatus("signing");
        const tx = await sign(builder.setTimeout(30).build());

        // 6. Clear manual secret key after signing
        if (!signingWalletId) {
          autoSaveSigningKey(publicKey);
          manualKeyCleared = true;
          secretKeyRef.current = "";
          setSecretKeyDisplay("");
          setShowSecret(false);
        }

        // 7. Submit — for XLM single-leg, retry as createAccount if no destination
        setTxStatus("submitting");
        let result: Awaited<ReturnType<typeof submitMainnetTransaction>>;
        try {
          result = await submitMainnetTransaction(tx);
        } catch (submitErr: any) {
          const opCodes: string[] =
            submitErr?.response?.data?.extras?.result_codes?.operations ?? [];
          const errMsg: string = getErrorMessage(submitErr);

          if (activeTab === "path" && opCodes.some((c) => ["op_over_source_max", "op_under_dest_min", "op_too_few_offers"].includes(c))) {
            setTxStatus("error");
            setTxError(`Path payment failed (${opCodes.join(", ")}) — the order book has likely moved since you quoted. Re-run Find Paths and submit again.`);
            return;
          }

          const isNoDestination = opCodes.includes("op_no_destination") || errMsg.includes("op_no_destination");

          // Build op-index → leg map (each leg emits N cancel ops + 1 payment op + optionally 1 changeTrust op)
          const legOpIndex: number[] = [];
          let opIdx = 0;
          for (let i = 0;i < legs.length;i++) {
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
              if (destWallet && (destWallet.hasKey || destWallet.secretKey)) {
                fixes.push({ leg, walletId: destWallet.id, publicKey: destWallet.publicKey, walletName: destWallet.name });
              }
            });
            if (fixes.length > 0) {
              setTxStatus("error");
              setTxError("Destination account(s) missing trustline for this asset.");
              setTrustlinePrompt(fixes);
              setTrustlinePromptTab(activeTab);
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

          // A bare op_invalid_limit (without op_no_trust) on a trustline-removal leg most likely
          // means the account still has open liabilities for this asset (e.g. an offer that wasn't
          // detected/cancelled in the pre-flight step above) blocking changeTrust(limit: "0").
          const hasRemoveTrustlineLeg = legs.some((l) => l.removeTrustline && l.assetKey !== "native");
          if (activeTab === "send" && hasInvalidLimit && !isNoTrust && hasRemoveTrustlineLeg) {
            setTxStatus("error");
            setTxError(
              "Cannot remove trustline: the account still has open liabilities for this asset " +
              "(e.g. a remaining open offer using it). Cancel any remaining offers for this asset " +
              "and retry.",
            );
            return;
          }

          if (activeTab === "send" && legs.length === 1 && legs[0].assetKey === "native" && isNoDestination) {
            toast.info("Destination account not found — retrying as account creation…");
            setTxStatus("building");
            const account2 = await server.loadAccount(publicKey);
            const tx2 = await sign(buildCreateAccountTransaction(account2, fee, networkPassphrase, legs[0].destination, legs[0].amount, memoValue));
            setTxStatus("submitting");
            result = await submitMainnetTransaction(tx2);
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
    } finally {
      submittingRef.current = false;
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
    setParsedInnerTxSigs(null);
    setInnerTxParseError(null);
    setFeeBumpBaseFee("200");
    setMemoValue("");
    setMemoSkipped(false);
    setFee("100");
    setSecretKeyDisplay("");
    secretKeyRef.current = "";
    setShowSecret(false);
    setTxStatus("idle");
    setTxHash(null);
    setTxError(null);
    setTrustlinePrompt(null);
    setTrustlinePromptTab(null);
    setTrustlineStatus(null);
    setCopied(false);
  }

  // ---------------------------------------------------------------------------
  // Trustline recovery
  // ---------------------------------------------------------------------------

  async function handleAddTrustlinesAndRetry() {
    if (!trustlinePrompt) return;
    // Guard against the user switching tabs while this prompt is showing — retrying
    // must re-evaluate the SAME tab's form that originally failed, not whatever tab
    // happens to be active now.
    if (trustlinePromptTab && activeTab !== trustlinePromptTab) {
      toast.error(`Switch back to the "${trustlinePromptTab}" tab to retry this trustline fix.`);
      return;
    }
    const identity = signingIdentity;
    const version = signingVersionRef.current;
    const assertSignerUnchanged = () => {
      if (signingIdentityRef.current !== identity || signingVersionRef.current !== version) throw new Error("Signing wallet changed. Review the payment again.");
    };
    setTrustlineAdding(true);
    setTxError(null);
    setTrustlineStatus("Adding trustlines\u2026");
    try {
      const server = horizonServer;
      const networkPassphrase = resolveNetworkPassphrase(network);

      for (let i = 0;i < trustlinePrompt.length;i++) {
        const fix = trustlinePrompt[i];
        setTrustlineStatus(`Adding trustline for ${assetLabel(fix.leg.assetKey)} on ${fix.walletName}\u2026 (${i + 1}/${trustlinePrompt.length})`);
        const destAccount = await server.loadAccount(fix.publicKey);
        const trustTx = buildTrustlineTransaction(destAccount, fee, networkPassphrase, fix.leg.assetKey);
        assertSignerUnchanged();
        const signedTrustTx = await signPaymentTransaction(trustTx, fix.walletId, "");
        assertSignerUnchanged();
        await submitMainnetTransaction(signedTrustTx);
        toast.success(`Trustline added on ${fix.walletName}`);
      }

      setTrustlineStatus("Trustlines added \u2014 retrying payment\u2026");
      setTrustlinePrompt(null);
      setTrustlinePromptTab(null);
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

  return {
    txStatus,
    txHash,
    network,
    handleCopyHash,
    copied,
    handleReset,
    wallets,
    signingWalletId,
    setSigningWalletId,
    activeTab,
    hasSigningKey,
    showSecret,
    secretKeyDisplay,
    handleSecretKeyChange,
    setShowSecret,
    currentPublicKey,
    setActiveTab,
    balancesLoading,
    balancesError,
    accountBalances,
    loadBalancesRef,
    loadBalances,
    signerCheck,
    legs,
    removeLeg,
    updateLeg,
    fee,
    addressBookEntries,
    setAddressBookTargetLegId,
    setAddressBookOpen,
    addLeg,
    pathMode,
    setPathMode,
    srcIsNative,
    setSrcIsNative,
    srcAssetCode,
    setSrcAssetCode,
    srcAssetIssuer,
    setSrcAssetIssuer,
    maxSendAmount,
    setMaxSendAmount,
    exactSendAmount,
    setExactSendAmount,
    destIsNative,
    setDestIsNative,
    destAssetCode,
    setDestAssetCode,
    destAssetIssuer,
    setDestAssetIssuer,
    destAmount,
    setDestAmount,
    minReceiveAmount,
    setMinReceiveAmount,
    pathDest,
    setPathDest,
    handleFindPaths,
    isFindingPaths,
    pathError,
    paths,
    setSelectedPathIndex,
    selectedPathIndex,
    claimAssetKey,
    setClaimAssetKey,
    claimAmount,
    setClaimAmount,
    claimants,
    setClaimants,
    updateClaimant,
    removeClaimant,
    innerTxXdr,
    setInnerTxXdr,
    innerTxParseError,
    parsedInnerTxOps,
    parsedInnerTxFee,
    parsedInnerTxSigs,
    feeBumpBaseFee,
    setFeeBumpBaseFee,
    innerPerOpFee,
    signerKeypair,
    horizonServer,
    horizonUrl,
    memoValue,
    setMemoValue,
    memoSkipped,
    setMemoSkipped,
    setFee,
    addressBookOpen,
    handleSelectAddress,
    handleRemoveAddress,
    newLabel,
    setNewLabel,
    newKey,
    setNewKey,
    handleAddAddress,
    handleOpenConfirm,
    isSubmitting,
    formValid,
    txError,
    trustlinePrompt,
    handleAddTrustlinesAndRetry,
    trustlineAdding,
    setTrustlinePrompt,
    setTrustlinePromptTab,
    trustlineStatus,
    confirmOpen,
    setConfirmOpen,
    pathsFetchedAt,
    handleSubmit
  };
}

export type PaymentsController = ReturnType<typeof usePaymentsController>;
