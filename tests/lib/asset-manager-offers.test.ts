import { afterEach, expect, it, vi } from "vitest";
import { Horizon, Keypair } from "stellar-sdk";
import { fetchMyOffers } from "@/lib/asset-manager";

afterEach(() => vi.restoreAllMocks());

it("loads every offer page and excludes offers against assets other than XLM", async () => {
  const issuer = Keypair.random().publicKey();
  const custom = { asset_type: "credit_alphanum4", asset_code: "EUR", asset_issuer: issuer };
  const native = { asset_type: "native" };
  const row = (id: number, side: "sell" | "buy", other = native) => ({
    id: String(id), amount: "2", price: "0.5", last_modified_ledger: id,
    selling: side === "sell" ? { asset_type: "credit_alphanum12", asset_code: "wUSDC", asset_issuer: issuer } : other,
    buying: side === "sell" ? other : { asset_type: "credit_alphanum12", asset_code: "wUSDC", asset_issuer: issuer },
  });
  const sellFirst = Array.from({ length: 200 }, (_, i) => row(i, "sell", i === 0 ? custom : native));
  let side: "sell" | "buy" = "sell";
  const offers = {
    seller: () => offers,
    selling: () => { side = "sell"; return offers; },
    buying: () => { side = "buy"; return offers; },
    limit: () => offers,
    call: async () => side === "sell"
      ? { records: sellFirst, next: async () => ({ records: [row(201, "sell")] }) }
      : { records: [row(300, "buy"), row(301, "buy", custom)] },
  };
  vi.spyOn(Horizon.Server.prototype, "offers").mockImplementation(() => offers as never);

  const result = await fetchMyOffers("https://horizon.stellar.org", Keypair.random().publicKey(), "wUSDC", issuer);
  expect(result).toHaveLength(201);
  expect(result.some((offer) => offer.id === "0" || offer.id === "301")).toBe(false);
  expect(result.find((offer) => offer.id === "201")?.side).toBe("sell");
  expect(result.find((offer) => offer.id === "300")?.side).toBe("buy");
});
