// lib/asset-manager/index.ts
//
// Trustline and issuer-flag management for classic Stellar assets.
// All operations are standard Horizon (no Soroban needed).

import {
  Asset,
  Horizon,
  Keypair,
  Operation,
  TransactionBuilder,
} from "stellar-sdk";
import { resolveNetworkPassphrase, type Network } from "@/lib/settings";

// ---------------------------------------------------------------------------
// Auth flag bitmask values (as per Stellar protocol)
// ---------------------------------------------------------------------------

export const AUTH_FLAGS = {
  REQUIRED: 1,        // New holders must be pre-approved
  REVOCABLE: 2,       // Issuer can freeze/deauthorize trustlines
  IMMUTABLE: 4,       // Locks all flags permanently — IRREVERSIBLE
  CLAWBACK_ENABLED: 8, // Issuer can clawback tokens — requires REVOCABLE
} as const;

export interface IssuerFlags {
  authRequired: boolean;
  authRevocable: boolean;
  authImmutable: boolean;
  authClawbackEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Trustline holder record
// ---------------------------------------------------------------------------

export type TrustlineStatus = "authorized" | "maintain_liabilities" | "frozen";

export interface TrustlineHolder {
  address: string;
  balance: string;
  limit: string;
  status: TrustlineStatus;
  isClawbackEnabled: boolean;
}

function resolveTrustlineStatus(
  isAuthorized: boolean,
  isMaintainLiabilities: boolean,
): TrustlineStatus {
  if (isAuthorized) return "authorized";
  if (isMaintainLiabilities) return "maintain_liabilities";
  return "frozen";
}

// ---------------------------------------------------------------------------
// fetchIssuerFlags
// Loads the issuer account and returns its current auth flags.
// ---------------------------------------------------------------------------

export async function fetchIssuerFlags(
  horizonUrl: string,
  issuerAddress: string,
  signal?: AbortSignal,
): Promise<IssuerFlags> {
  const server = new Horizon.Server(horizonUrl);
  const account = await server.loadAccount(issuerAddress);
  if (signal?.aborted) throw new Error("Aborted");
  const f = account.flags;
  return {
    authRequired: !!f.auth_required,
    authRevocable: !!f.auth_revocable,
    authImmutable: !!f.auth_immutable,
    authClawbackEnabled: !!(f as unknown as Record<string, unknown>).auth_clawback_enabled,
  };
}

// ---------------------------------------------------------------------------
// setIssuerFlag
// Enables or disables a single auth flag on the issuer account.
// Signs and submits the transaction. Returns the TX hash.
// ---------------------------------------------------------------------------

export async function setIssuerFlag(
  horizonUrl: string,
  issuerSecretKey: string,
  flagValue: number,
  enable: boolean,
  network: Network,
  signal?: AbortSignal,
): Promise<string> {
  const keypair = Keypair.fromSecret(issuerSecretKey);
  const server = new Horizon.Server(horizonUrl);
  const account = await server.loadAccount(keypair.publicKey());
  if (signal?.aborted) throw new Error("Aborted");

  const op = Operation.setOptions(
    enable ? { setFlags: flagValue as never } : { clearFlags: flagValue as never },
  );

  const tx = new TransactionBuilder(account, {
    fee: await server.fetchBaseFee().then(String),
    networkPassphrase: resolveNetworkPassphrase(network),
  })
    .addOperation(op)
    .setTimeout(30)
    .build();

  tx.sign(keypair);
  const result = await server.submitTransaction(tx);
  if (signal?.aborted) throw new Error("Aborted");
  return (result as { hash?: string }).hash ?? "";
}

// ---------------------------------------------------------------------------
// fetchTrustlineHolders
// Pages through all accounts holding the given asset.
// Calls onResult for each page so the UI can stream results live.
// ---------------------------------------------------------------------------

export async function fetchTrustlineHolders(
  horizonUrl: string,
  assetCode: string,
  issuerAddress: string,
  signal: AbortSignal,
  onResult: (holders: TrustlineHolder[]) => void,
  onLog: (msg: string) => void,
): Promise<void> {
  const server = new Horizon.Server(horizonUrl);
  const asset = new Asset(assetCode, issuerAddress);
  let cursor: string | null = null;
  let total = 0;

  onLog(`Fetching holders for ${assetCode}:${issuerAddress.slice(0, 4)}…${issuerAddress.slice(-4)}`);

  while (!signal.aborted) {
    let builder: ReturnType<typeof server.accounts> = server
      .accounts()
      .forAsset(asset)
      .limit(200)
      .order("asc");

    if (cursor) builder = builder.cursor(cursor);

    const page = await builder.call();
    if (signal.aborted) break;

    const records = page.records as Horizon.ServerApi.AccountRecord[];
    if (records.length === 0) break;

    const holders: TrustlineHolder[] = [];

    for (const account of records) {
      const balance = (
        account.balances as Horizon.HorizonApi.BalanceLine[]
      ).find(
        (b) =>
          b.asset_type !== "native" &&
          "asset_code" in b &&
          "asset_issuer" in b &&
          b.asset_code?.toUpperCase() === assetCode.toUpperCase() &&
          b.asset_issuer === issuerAddress,
      );

      if (!balance || balance.asset_type === "native") continue;

      const b = balance as Horizon.HorizonApi.BalanceLineAsset;
      holders.push({
        address: account.account_id,
        balance: b.balance,
        limit: b.limit,
        status: resolveTrustlineStatus(
          b.is_authorized,
          b.is_authorized_to_maintain_liabilities,
        ),
        isClawbackEnabled: !!(b as unknown as Record<string, unknown>).is_clawback_enabled,
      });
    }

    if (holders.length > 0) {
      onResult(holders);
      total += holders.length;
      onLog(`  Loaded ${total} holders so far…`);
    }

    if (records.length < 200) break;
    cursor = records[records.length - 1].paging_token;
  }

  onLog(signal.aborted ? "Scan stopped." : `Done — ${total} total holders.`);
}

// ---------------------------------------------------------------------------
// setTrustlineAuthorization
// Sets the authorization state of a specific holder's trustline.
// Requires issuer to have AUTH_REVOCABLE set.
// ---------------------------------------------------------------------------

export type TrustlineAction =
  | "authorize"          // Full authorization — can trade freely
  | "freeze"             // Deauthorize — cannot trade at all, existing offers canceled
  | "maintain_only";     // Can keep existing offers but not create new ones or send/receive

export async function setTrustlineAuthorization(
  horizonUrl: string,
  issuerSecretKey: string,
  holderAddress: string,
  assetCode: string,
  issuerAddress: string,
  action: TrustlineAction,
  network: Network,
  signal?: AbortSignal,
): Promise<string> {
  const keypair = Keypair.fromSecret(issuerSecretKey);
  const server = new Horizon.Server(horizonUrl);
  const asset = new Asset(assetCode, issuerAddress);

  const account = await server.loadAccount(keypair.publicKey());
  if (signal?.aborted) throw new Error("Aborted");

  const flags = {
    authorized: action === "authorize",
    authorizedToMaintainLiabilities: action === "maintain_only",
  };

  const op = Operation.setTrustLineFlags({
    trustor: holderAddress,
    asset,
    flags,
  });

  const tx = new TransactionBuilder(account, {
    fee: await server.fetchBaseFee().then(String),
    networkPassphrase: resolveNetworkPassphrase(network),
  })
    .addOperation(op)
    .setTimeout(30)
    .build();

  tx.sign(keypair);
  const result = await server.submitTransaction(tx);
  if (signal?.aborted) throw new Error("Aborted");
  return (result as { hash?: string }).hash ?? "";
}

// ---------------------------------------------------------------------------
// SellOffer — open DEX offer selling the given asset
// ---------------------------------------------------------------------------

export interface SellOffer {
  id: string;
  seller: string;
  amount: string;
  price: string;
  buying: string;
  buyingIssuer?: string;
  lastModifiedTime: string;
}

// ---------------------------------------------------------------------------
// fetchSellOffers
// Pages through all open DEX offers where the given asset is being sold.
// Calls onResult per page so the UI streams results live.
// ---------------------------------------------------------------------------

export async function fetchSellOffers(
  horizonUrl: string,
  assetCode: string,
  issuerAddress: string,
  signal: AbortSignal,
  onResult: (offers: SellOffer[]) => void,
  onLog: (msg: string) => void,
): Promise<void> {
  const server = new Horizon.Server(horizonUrl);
  const asset = new Asset(assetCode, issuerAddress);
  let cursor: string | null = null;
  let total = 0;

  onLog(`Scanning sell offers for ${assetCode}:${issuerAddress.slice(0, 4)}…${issuerAddress.slice(-4)}`);

  while (!signal.aborted) {
    let builder = server.offers().selling(asset).limit(200);
    if (cursor) builder = builder.cursor(cursor);

    const page = await builder.call();
    if (signal.aborted) break;

    const records = page.records as unknown as Record<string, unknown>[];
    if (records.length === 0) break;

    const offers: SellOffer[] = records.map((r) => {
      const buying = r.buying as Record<string, string>;
      const buyingCode =
        buying.asset_type === "native" ? "XLM" : (buying.asset_code ?? "unknown");
      return {
        id: String(r.id ?? ""),
        seller: String(r.seller ?? ""),
        amount: String(r.amount ?? "0"),
        price: String(r.price ?? "0"),
        buying: buyingCode,
        buyingIssuer:
          buying.asset_type !== "native" ? buying.asset_issuer : undefined,
        lastModifiedTime: String(r.last_modified_time ?? ""),
      };
    });

    onResult(offers);
    total += offers.length;
    onLog(`  ${total} offers found so far…`);

    if (records.length < 200) break;
    cursor = String(records[records.length - 1].paging_token ?? "");
  }

  onLog(signal.aborted ? "Scan stopped." : `Done — ${total} total sell offers.`);
}

// ---------------------------------------------------------------------------
// MyOffer — open DEX offer belonging to a specific account
// ---------------------------------------------------------------------------

export interface MyOffer {
  id: string;
  side: "sell" | "buy";
  amount: string;   // for sell: asset amount; for buy: buyAmount (asset units being bought)
  price: string;    // XLM per asset token
  selling: string;  // what is being sold
  buying: string;   // what is being bought
  buyingIssuer?: string;
  lastModifiedLedger: number;
}

function parseOffer(r: Record<string, unknown>, side: "sell" | "buy"): MyOffer {
  const selling = r.selling as Record<string, string>;
  const buying = r.buying as Record<string, string>;
  const sellingCode = selling.asset_type === "native" ? "XLM" : (selling.asset_code ?? "unknown");
  const buyingCode = buying.asset_type === "native" ? "XLM" : (buying.asset_code ?? "unknown");
  return {
    id: String(r.id ?? ""),
    side,
    amount: String(r.amount ?? "0"),
    price: String(r.price ?? "0"),
    selling: sellingCode,
    buying: buyingCode,
    buyingIssuer: buying.asset_type !== "native" ? buying.asset_issuer : undefined,
    lastModifiedLedger: Number(r.last_modified_ledger ?? 0),
  };
}

// ---------------------------------------------------------------------------
// fetchMyOffers
// Loads all open sell AND buy offers for this asset from a specific account.
// ---------------------------------------------------------------------------

export async function fetchMyOffers(
  horizonUrl: string,
  sellerAddress: string,
  assetCode: string,
  issuerAddress: string,
): Promise<MyOffer[]> {
  const server = new Horizon.Server(horizonUrl);
  const asset = new Asset(assetCode, issuerAddress);

  const [sellPage, buyPage] = await Promise.all([
    server.offers().seller(sellerAddress).selling(asset).limit(200).call(),
    server.offers().seller(sellerAddress).buying(asset).limit(200).call(),
  ]);

  const sells = (sellPage.records as unknown as Record<string, unknown>[]).map((r) => parseOffer(r, "sell"));
  const buys = (buyPage.records as unknown as Record<string, unknown>[]).map((r) => parseOffer(r, "buy"));

  return [...sells, ...buys].sort((a, b) => b.lastModifiedLedger - a.lastModifiedLedger);
}

// ---------------------------------------------------------------------------
// createSellOffer
// Places a new sell offer: selling assetCode/issuer for XLM at given price.
// price = XLM per 1 token (e.g. "0.5" means sell 1 token for 0.5 XLM)
// Returns TX hash.
// ---------------------------------------------------------------------------

export async function createSellOffer(
  horizonUrl: string,
  secretKey: string,
  assetCode: string,
  issuerAddress: string,
  amount: string,
  price: string,
  network: Network,
): Promise<string> {
  const keypair = Keypair.fromSecret(secretKey);
  const server = new Horizon.Server(horizonUrl);
  const selling = new Asset(assetCode, issuerAddress);

  const account = await server.loadAccount(keypair.publicKey());

  const op = Operation.manageSellOffer({
    selling,
    buying: Asset.native(),
    amount,
    price,
    offerId: 0, // 0 = create new offer
  });

  const tx = new TransactionBuilder(account, {
    fee: await server.fetchBaseFee().then(String),
    networkPassphrase: resolveNetworkPassphrase(network),
  })
    .addOperation(op)
    .setTimeout(30)
    .build();

  tx.sign(keypair);
  const result = await server.submitTransaction(tx);
  return (result as { hash?: string }).hash ?? "";
}

// ---------------------------------------------------------------------------
// createBatchOffers
// Places multiple sell (or buy) offers in sequence.
// mode "repeat"  — N identical offers at the same price/amount
// mode "ladder"  — N offers spread evenly between priceFrom and priceTo
// Calls onProgress(done, total, hash) after each submission.
// Returns array of { price, amount, hash?, error? }
// ---------------------------------------------------------------------------

export type BatchMode = "repeat" | "ladder";
export type OfferSide = "sell" | "buy";

export interface BatchOfferResult {
  price: string;
  amount: string;
  hash?: string;
  error?: string;
}

export async function createBatchOffers(options: {
  horizonUrl: string;
  secretKey: string;
  assetCode: string;
  issuerAddress: string;
  side: OfferSide;
  mode: BatchMode;
  count: number;
  amount: string;         // per offer
  priceFrom: string;      // used for both "repeat" (single price) and "ladder" (start price)
  priceTo?: string;       // only for "ladder"
  network: Network;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number, last: BatchOfferResult) => void;
}): Promise<BatchOfferResult[]> {
  const {
    horizonUrl, secretKey, assetCode, issuerAddress, side, mode,
    count, amount, priceFrom, priceTo, network, signal, onProgress,
  } = options;

  const keypair = Keypair.fromSecret(secretKey);
  const server = new Horizon.Server(horizonUrl);
  const asset = new Asset(assetCode, issuerAddress);
  const results: BatchOfferResult[] = [];

  const from = parseFloat(priceFrom);
  const to = mode === "ladder" && priceTo ? parseFloat(priceTo) : from;

  for (let i = 0; i < count; i++) {
    if (signal?.aborted) break;

    const price =
      count === 1
        ? from
        : from + (to - from) * (i / (count - 1));

    const priceStr = price.toFixed(7);

    try {
      const account = await server.loadAccount(keypair.publicKey());
      if (signal?.aborted) break;

      const op =
        side === "sell"
          ? Operation.manageSellOffer({
              selling: asset,
              buying: Asset.native(),
              amount,
              price: priceStr,
              offerId: 0,
            })
          : Operation.manageBuyOffer({
              selling: Asset.native(),
              buying: asset,
              buyAmount: amount,
              price: priceStr,
              offerId: 0,
            });

      const tx = new TransactionBuilder(account, {
        fee: await server.fetchBaseFee().then(String),
        networkPassphrase: resolveNetworkPassphrase(network),
      })
        .addOperation(op)
        .setTimeout(30)
        .build();

      tx.sign(keypair);
      const result = await server.submitTransaction(tx);
      const hash = (result as { hash?: string }).hash ?? "";
      const entry: BatchOfferResult = { price: priceStr, amount, hash };
      results.push(entry);
      onProgress?.(i + 1, count, entry);
    } catch (e) {
      const entry: BatchOfferResult = {
        price: priceStr,
        amount,
        error: e instanceof Error ? e.message : String(e),
      };
      results.push(entry);
      onProgress?.(i + 1, count, entry);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// deleteOffer
// Cancels an existing sell or buy offer by ID (sets amount to 0).
// Returns TX hash.
// ---------------------------------------------------------------------------

export async function deleteOffer(
  horizonUrl: string,
  secretKey: string,
  assetCode: string,
  issuerAddress: string,
  offerId: string,
  price: string,
  side: "sell" | "buy",
  network: Network,
): Promise<string> {
  const keypair = Keypair.fromSecret(secretKey);
  const server = new Horizon.Server(horizonUrl);
  const asset = new Asset(assetCode, issuerAddress);

  const account = await server.loadAccount(keypair.publicKey());

  const op = side === "sell"
    ? Operation.manageSellOffer({
        selling: asset,
        buying: Asset.native(),
        amount: "0",
        price,
        offerId: parseInt(offerId, 10),
      })
    : Operation.manageBuyOffer({
        selling: Asset.native(),
        buying: asset,
        buyAmount: "0",
        price,
        offerId: parseInt(offerId, 10),
      });

  const tx = new TransactionBuilder(account, {
    fee: await server.fetchBaseFee().then(String),
    networkPassphrase: resolveNetworkPassphrase(network),
  })
    .addOperation(op)
    .setTimeout(30)
    .build();

  tx.sign(keypair);
  const result = await server.submitTransaction(tx);
  return (result as { hash?: string }).hash ?? "";
}
