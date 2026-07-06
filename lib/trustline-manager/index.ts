// lib/trustline-manager/index.ts
//
// Core logic for adding and removing trustlines on Stellar accounts.
// Uses change_trust operation — limit="0" removes a trustline.
// One tx per account, all assets batched inside.

import {
  Asset,
  Horizon,
  Keypair,
  Operation,
  TransactionBuilder,
  BASE_FEE,
} from "stellar-sdk";
import { resolveNetworkPassphrase, type Network } from "@/lib/settings";

export const MAX_TRUST_LIMIT = "922337203685.4775807";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AddTrustlineOptions {
  assetCode: string;
  issuer: string;
  /** Pass limit="0" or remove=true to remove the trustline. */
  limit?: string;
  remove?: boolean;
  signingSecret: string;
  horizonUrl: string;
  network: Network;
  onLog?: (msg: string) => void;
}

export interface AddTrustlineResult {
  txHash: string;
}

export interface BulkAsset {
  code: string;
  issuer: string;
}

export interface BulkResult {
  accountPubkey: string;
  assetCode: string;
  issuer: string;
  status: "success" | "error";
  txHash?: string;
  error?: string;
}

export interface AddTrustlineBulkOptions {
  assets: BulkAsset[];
  signingSecrets: string[];
  /** Pass limit="0" or remove=true to remove trustlines. */
  limit?: string;
  remove?: boolean;
  horizonUrl: string;
  network: Network;
  onResult?: (result: BulkResult) => void;
  onLog?: (msg: string) => void;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// addTrustline — single account, single asset
// ---------------------------------------------------------------------------

export async function addTrustline(
  opts: AddTrustlineOptions
): Promise<AddTrustlineResult> {
  const { assetCode, issuer, remove = false, signingSecret, horizonUrl, network, onLog } = opts;
  const limit = remove ? "0" : (opts.limit ?? MAX_TRUST_LIMIT);

  const keypair = Keypair.fromSecret(signingSecret);
  const server = new Horizon.Server(horizonUrl);
  const networkPassphrase = resolveNetworkPassphrase(network);

  onLog?.(`Loading account ${keypair.publicKey().slice(0, 8)}…`);
  const account = await server.loadAccount(keypair.publicKey());

  const asset = new Asset(assetCode, issuer);
  const action = remove ? "remove" : "add";
  onLog?.(`Building change_trust tx (${action}) for ${assetCode}:${issuer.slice(0, 8)}…`);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(Operation.changeTrust({ asset, limit }))
    .setTimeout(30)
    .build();

  tx.sign(keypair);

  onLog?.(`Submitting transaction…`);
  const result = await server.submitTransaction(tx);
  onLog?.(`Done — tx hash: ${result.hash}`);

  return { txHash: result.hash };
}

// ---------------------------------------------------------------------------
// addTrustlineBulk — many accounts × many assets
// Each account gets one tx with all its change_trust ops batched inside.
// Stellar max ops per tx = 100; split into batches of 100 if needed.
// ---------------------------------------------------------------------------

const MAX_OPS_PER_TX = 100;

export async function addTrustlineBulk(opts: AddTrustlineBulkOptions): Promise<void> {
  const {
    assets,
    signingSecrets,
    remove = false,
    horizonUrl,
    network,
    onResult,
    onLog,
    signal,
  } = opts;
  const limit = remove ? "0" : (opts.limit ?? MAX_TRUST_LIMIT);

  const server = new Horizon.Server(horizonUrl);
  const networkPassphrase = resolveNetworkPassphrase(network);

  for (const secret of signingSecrets) {
    if (signal?.aborted) break;

    let keypair: Keypair;
    try {
      keypair = Keypair.fromSecret(secret);
    } catch {
      for (const a of assets) {
        onResult?.({
          accountPubkey: "(invalid secret)",
          assetCode: a.code,
          issuer: a.issuer,
          status: "error",
          error: "Invalid secret key",
        });
      }
      continue;
    }

    const pubkey = keypair.publicKey();
    onLog?.(`Processing ${pubkey.slice(0, 8)}… (${assets.length} assets)`);

    // Load account once per secret key
    let account: Horizon.AccountResponse;
    try {
      account = await server.loadAccount(pubkey);
    } catch (e) {
      for (const a of assets) {
        onResult?.({
          accountPubkey: pubkey,
          assetCode: a.code,
          issuer: a.issuer,
          status: "error",
          error: "Account not found or not funded",
        });
      }
      continue;
    }

    // Split assets into batches of MAX_OPS_PER_TX
    for (let batchStart = 0; batchStart < assets.length; batchStart += MAX_OPS_PER_TX) {
      if (signal?.aborted) break;

      const batch = assets.slice(batchStart, batchStart + MAX_OPS_PER_TX);

      try {
        const builder = new TransactionBuilder(account, {
          fee: String(Number(BASE_FEE) * batch.length),
          networkPassphrase,
        }).setTimeout(30);

        for (const a of batch) {
          builder.addOperation(
            Operation.changeTrust({ asset: new Asset(a.code, a.issuer), limit })
          );
        }

        const tx = builder.build();
        tx.sign(keypair);

        const result = await server.submitTransaction(tx);

        for (const a of batch) {
          onResult?.({
            accountPubkey: pubkey,
            assetCode: a.code,
            issuer: a.issuer,
            status: "success",
            txHash: result.hash,
          });
        }

        // Advance sequence for next batch on the same account
        // (TransactionBuilder tracks sequence internally via account object)
      } catch (e: unknown) {
        const errMsg = extractHorizonError(e);
        for (const a of batch) {
          onResult?.({
            accountPubkey: pubkey,
            assetCode: a.code,
            issuer: a.issuer,
            status: "error",
            error: errMsg,
          });
        }

        // Reload account so sequence number is correct for next batch
        try {
          account = await server.loadAccount(pubkey);
        } catch {
          break;
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// drainAndRemoveTrustline — send full balance to destination, then remove
// If assetCode is "XLM" or "native": uses accountMerge instead.
// ---------------------------------------------------------------------------

export interface DrainAndRemoveOptions {
  assetCode: string;
  issuer?: string;         // not needed for XLM
  destination: string;
  signingSecret: string;
  horizonUrl: string;
  network: Network;
  onLog?: (msg: string) => void;
}

export async function drainAndRemoveTrustline(
  opts: DrainAndRemoveOptions
): Promise<AddTrustlineResult> {
  const { assetCode, issuer, destination, signingSecret, horizonUrl, network, onLog } = opts;
  const isNative = assetCode.toUpperCase() === "XLM" || assetCode === "native";

  const keypair = Keypair.fromSecret(signingSecret);
  const server = new Horizon.Server(horizonUrl);
  const networkPassphrase = resolveNetworkPassphrase(network);

  onLog?.(`Loading account ${keypair.publicKey().slice(0, 8)}…`);
  const account = await server.loadAccount(keypair.publicKey());

  const builder = new TransactionBuilder(account, {
    fee: String(Number(BASE_FEE) * 2),
    networkPassphrase,
  }).setTimeout(30);

  if (isNative) {
    // accountMerge sends all XLM and removes the account entirely
    onLog?.(`Building accountMerge → ${destination.slice(0, 8)}…`);
    builder.addOperation(Operation.accountMerge({ destination }));
  } else {
    if (!issuer) throw new Error("Issuer required for non-native asset");
    const asset = new Asset(assetCode, issuer);

    // Find current balance
    const balanceLine = account.balances.find(
      (b) =>
        (b.asset_type === "credit_alphanum4" || b.asset_type === "credit_alphanum12") &&
        (b as { asset_code?: string }).asset_code === assetCode &&
        (b as { asset_issuer?: string }).asset_issuer === issuer
    );
    const balance = balanceLine ? (balanceLine as { balance: string }).balance : "0";

    if (parseFloat(balance) > 0) {
      onLog?.(`Sending ${balance} ${assetCode} → ${destination.slice(0, 8)}…`);
      builder.addOperation(
        Operation.payment({ destination, asset, amount: balance })
      );
    } else {
      onLog?.(`Balance is 0, skipping payment step.`);
    }

    onLog?.(`Building change_trust (remove) for ${assetCode}…`);
    builder.addOperation(Operation.changeTrust({ asset, limit: "0" }));
  }

  const tx = builder.build();
  tx.sign(keypair);

  onLog?.(`Submitting transaction…`);
  const result = await server.submitTransaction(tx);
  onLog?.(`Done — tx hash: ${result.hash}`);

  return { txHash: result.hash };
}

// ---------------------------------------------------------------------------
// drainAndRemoveBulk — drain + remove for many accounts × many assets
// XLM/native uses accountMerge per account (one merge per account, not per asset).
// ---------------------------------------------------------------------------

export interface DrainAndRemoveBulkOptions {
  assets: BulkAsset[];
  signingSecrets: string[];
  destination: string;
  horizonUrl: string;
  network: Network;
  onResult?: (result: BulkResult) => void;
  onLog?: (msg: string) => void;
  signal?: AbortSignal;
}

export async function drainAndRemoveBulk(opts: DrainAndRemoveBulkOptions): Promise<void> {
  const { assets, signingSecrets, destination, horizonUrl, network, onResult, onLog, signal } = opts;
  const server = new Horizon.Server(horizonUrl);
  const networkPassphrase = resolveNetworkPassphrase(network);

  for (const secret of signingSecrets) {
    if (signal?.aborted) break;

    let keypair: Keypair;
    try {
      keypair = Keypair.fromSecret(secret);
    } catch {
      for (const a of assets) {
        onResult?.({ accountPubkey: "(invalid secret)", assetCode: a.code, issuer: a.issuer, status: "error", error: "Invalid secret key" });
      }
      continue;
    }

    const pubkey = keypair.publicKey();
    onLog?.(`Processing ${pubkey.slice(0, 8)}… (drain + remove)`);

    let account: Horizon.AccountResponse;
    try {
      account = await server.loadAccount(pubkey);
    } catch {
      for (const a of assets) {
        onResult?.({ accountPubkey: pubkey, assetCode: a.code, issuer: a.issuer, status: "error", error: "Account not found or not funded" });
      }
      continue;
    }

    // Group native vs non-native
    const nativeAssets = assets.filter((a) => a.code.toUpperCase() === "XLM" || a.code === "native");
    const customAssets = assets.filter((a) => a.code.toUpperCase() !== "XLM" && a.code !== "native");

    // Handle native: one accountMerge covers all XLM assets for this account
    if (nativeAssets.length > 0) {
      if (signal?.aborted) break;
      try {
        const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
          .setTimeout(30)
          .addOperation(Operation.accountMerge({ destination }))
          .build();
        tx.sign(keypair);
        const result = await server.submitTransaction(tx);
        for (const a of nativeAssets) {
          onResult?.({ accountPubkey: pubkey, assetCode: a.code, issuer: a.issuer, status: "success", txHash: result.hash });
        }
        // Account is gone after merge — skip custom assets for this account
        if (customAssets.length > 0) {
          for (const a of customAssets) {
            onResult?.({ accountPubkey: pubkey, assetCode: a.code, issuer: a.issuer, status: "error", error: "Account merged — cannot process remaining assets" });
          }
        }
        continue;
      } catch (e: unknown) {
        const errMsg = extractHorizonError(e);
        for (const a of nativeAssets) {
          onResult?.({ accountPubkey: pubkey, assetCode: a.code, issuer: a.issuer, status: "error", error: errMsg });
        }
      }
    }

    // Handle custom assets: batch payment + change_trust per asset (up to MAX_OPS_PER_TX/2 assets per tx)
    const BATCH = Math.floor(MAX_OPS_PER_TX / 2); // 2 ops per asset (payment + change_trust)
    for (let i = 0; i < customAssets.length; i += BATCH) {
      if (signal?.aborted) break;
      const batch = customAssets.slice(i, i + BATCH);

      try {
        const builder = new TransactionBuilder(account, {
          fee: String(Number(BASE_FEE) * batch.length * 2),
          networkPassphrase,
        }).setTimeout(30);

        for (const a of batch) {
          const asset = new Asset(a.code, a.issuer);
          const balanceLine = account.balances.find(
            (b) =>
              (b.asset_type === "credit_alphanum4" || b.asset_type === "credit_alphanum12") &&
              (b as { asset_code?: string }).asset_code === a.code &&
              (b as { asset_issuer?: string }).asset_issuer === a.issuer
          );
          const balance = balanceLine ? (balanceLine as { balance: string }).balance : "0";
          if (parseFloat(balance) > 0) {
            builder.addOperation(Operation.payment({ destination, asset, amount: balance }));
          }
          builder.addOperation(Operation.changeTrust({ asset, limit: "0" }));
        }

        const tx = builder.build();
        tx.sign(keypair);
        const result = await server.submitTransaction(tx);

        for (const a of batch) {
          onResult?.({ accountPubkey: pubkey, assetCode: a.code, issuer: a.issuer, status: "success", txHash: result.hash });
        }
      } catch (e: unknown) {
        const errMsg = extractHorizonError(e);
        for (const a of batch) {
          onResult?.({ accountPubkey: pubkey, assetCode: a.code, issuer: a.issuer, status: "error", error: errMsg });
        }

        // Reload account so sequence number is correct for next batch
        try {
          account = await server.loadAccount(pubkey);
        } catch {
          break;
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// fetchIssuerAuthRequired — checks if the issuer has AUTH_REQUIRED set
// ---------------------------------------------------------------------------

export async function fetchIssuerAuthRequired(
  issuer: string,
  horizonUrl: string
): Promise<boolean> {
  const server = new Horizon.Server(horizonUrl);
  try {
    const account = await server.loadAccount(issuer);
    const flags = account.flags as { auth_required?: boolean };
    return flags.auth_required === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// fetchAccountXlmBalance — returns native balance as number
// ---------------------------------------------------------------------------

export async function fetchAccountXlmBalance(
  publicKey: string,
  horizonUrl: string
): Promise<number | null> {
  const server = new Horizon.Server(horizonUrl);
  try {
    const account = await server.loadAccount(publicKey);
    const native = account.balances.find((b) => b.asset_type === "native");
    return native ? parseFloat(native.balance) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// parseBulkAssets — parse CODE:ISSUER lines
// ---------------------------------------------------------------------------

export interface ParsedAssetLine {
  raw: string;
  code?: string;
  issuer?: string;
  error?: string;
}

export function parseBulkAssets(text: string): ParsedAssetLine[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((raw) => {
      const colonIdx = raw.indexOf(":");
      if (colonIdx === -1) return { raw, error: "Missing colon — expected CODE:ISSUER" };
      const code = raw.slice(0, colonIdx).trim();
      const issuer = raw.slice(colonIdx + 1).trim();
      if (!code) return { raw, error: "Asset code is empty" };
      if (issuer.length !== 56 || !issuer.startsWith("G")) {
        return { raw, code, issuer, error: "Issuer looks invalid (must be G… 56 chars)" };
      }
      return { raw, code, issuer };
    });
}

// ---------------------------------------------------------------------------
// fetchAccountOffersForAsset — returns open offers that sell OR buy a given asset
// Both directions can block trustline removal (Horizon: op_line_full).
// ---------------------------------------------------------------------------

export interface AccountOffer {
  id: string;
  /** Display label: "XLM" or "CODE:ISSUER…" */
  sellingLabel: string;
  buyingLabel: string;
  amount: string;
  price: string;
  /** Raw asset data needed for cancel operation */
  _rawSelling: { type: string; code?: string; issuer?: string };
  _rawBuying: { type: string; code?: string; issuer?: string };
}

function rawToAsset(raw: { type: string; code?: string; issuer?: string }): Asset {
  return raw.type === "native" ? Asset.native() : new Asset(raw.code!, raw.issuer!);
}

export async function fetchAccountOffersForAsset(
  publicKey: string,
  assetCode: string,
  issuer: string,
  horizonUrl: string,
): Promise<AccountOffer[]> {
  const server = new Horizon.Server(horizonUrl);

  let page = await server.offers().forAccount(publicKey).limit(200).call();
  const records = [...page.records];
  while (page.records.length === 200) {
    page = await page.next();
    records.push(...page.records);
  }
  const assetStr = `${assetCode}:${issuer}`;

  return (records as unknown as Record<string, unknown>[])
    .filter((r) => {
      const s = r.selling as Record<string, string>;
      const b = r.buying as Record<string, string>;
      const sellingStr = s.asset_type === "native" ? "XLM" : `${s.asset_code}:${s.asset_issuer}`;
      const buyingStr = b.asset_type === "native" ? "XLM" : `${b.asset_code}:${b.asset_issuer}`;
      return sellingStr === assetStr || buyingStr === assetStr;
    })
    .map((r) => {
      const s = r.selling as Record<string, string>;
      const b = r.buying as Record<string, string>;
      return {
        id: String(r.id),
        sellingLabel:
          s.asset_type === "native" ? "XLM" : `${s.asset_code}:${s.asset_issuer?.slice(0, 8)}…`,
        buyingLabel:
          b.asset_type === "native" ? "XLM" : `${b.asset_code}:${b.asset_issuer?.slice(0, 8)}…`,
        amount: String(r.amount),
        price: String(r.price),
        _rawSelling: { type: s.asset_type, code: s.asset_code, issuer: s.asset_issuer },
        _rawBuying: { type: b.asset_type, code: b.asset_code, issuer: b.asset_issuer },
      };
    });
}

// ---------------------------------------------------------------------------
// cancelOffersBatch — cancels a list of offers (manage_sell_offer amount=0).
// Uses the raw asset data stored on each AccountOffer for correct operation fields.
// Batches up to 100 ops per tx.
// ---------------------------------------------------------------------------

export async function cancelOffersBatch(
  offers: AccountOffer[],
  signingSecret: string,
  horizonUrl: string,
  network: Network,
  onLog?: (msg: string) => void,
): Promise<{ txHash: string }[]> {
  if (offers.length === 0) return [];

  const keypair = Keypair.fromSecret(signingSecret);
  const server = new Horizon.Server(horizonUrl);
  const networkPassphrase = resolveNetworkPassphrase(network);

  onLog?.(`Cancelling ${offers.length} offer(s)…`);
  const account = await server.loadAccount(keypair.publicKey());

  const results: { txHash: string }[] = [];
  const BATCH = 100;

  for (let i = 0; i < offers.length; i += BATCH) {
    const batch = offers.slice(i, i + BATCH);
    const builder = new TransactionBuilder(account, {
      fee: String(Number(BASE_FEE) * batch.length),
      networkPassphrase,
    }).setTimeout(30);

    for (const offer of batch) {
      builder.addOperation(
        Operation.manageSellOffer({
          selling: rawToAsset(offer._rawSelling),
          buying: rawToAsset(offer._rawBuying),
          amount: "0",
          price: "1",
          offerId: offer.id,
        }),
      );
    }

    const tx = builder.build();
    tx.sign(keypair);
    const result = await server.submitTransaction(tx);
    onLog?.(`Cancelled — tx: ${result.hash}`);
    results.push({ txHash: result.hash });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractHorizonError(e: unknown): string {
  if (e && typeof e === "object") {
    const err = e as Record<string, unknown>;
    if (err.response && typeof err.response === "object") {
      const resp = err.response as Record<string, unknown>;
      if (resp.data && typeof resp.data === "object") {
        const data = resp.data as Record<string, unknown>;
        if (data.extras && typeof data.extras === "object") {
          const extras = data.extras as Record<string, unknown>;
          if (extras.result_codes && typeof extras.result_codes === "object") {
            const codes = extras.result_codes as { transaction?: string; operations?: string[] };
            const parts: string[] = [];
            if (codes.transaction) parts.push(`tx: ${codes.transaction}`);
            if (codes.operations?.length) parts.push(`ops: ${codes.operations.join(", ")}`);
            if (parts.length) return parts.join(" | ");
          }
        }
        if (typeof data.title === "string") return data.title;
      }
    }
    if (typeof err.message === "string") return err.message;
  }
  return String(e);
}
