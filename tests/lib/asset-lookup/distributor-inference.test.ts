import { afterEach, describe, expect, it, vi } from "vitest";
import { inferDistribLite } from "@/lib/asset-lookup/fetchers";
import aflwa from "../../fixtures/distribution/aflwa-claim.json";

const HORIZON = "https://horizon.example.com";
const ISSUER = "GISSUER";
const RELAY = "GRELAY";
const SELLER = "GSELLER";
const create = {
  id: "20", paging_token: "20", type: "create_claimable_balance",
  source_account: RELAY, asset: `Token:${ISSUER}`, amount: "5000000",
  transaction_successful: true,
  claimants: [{ destination: RELAY }, { destination: SELLER }, { destination: "GELIGIBLE" }],
};
const claim = {
  id: "30", paging_token: "30", type: "claim_claimable_balance",
  balance_id: "balance", claimant: SELLER, transaction_successful: true,
};
function mockHistory(overrides: Record<string, unknown[]> = {}) {
  const routes: Record<string, unknown[]> = {
    [`/accounts/${ISSUER}/payments`]: [{
      id: "10", paging_token: "10", type: "payment", from: ISSUER, to: RELAY,
      asset_code: "Token", asset_issuer: ISSUER, amount: "5000000",
    }],
    [`/accounts/${ISSUER}/operations`]: [],
    [`/accounts/${RELAY}/operations`]: [create],
    ["/operations/20/effects"]: [{ type: "claimable_balance_created", balance_id: "balance", account: RELAY, asset: create.asset, amount: create.amount }],
    ["/claimable_balances/balance/operations"]: [create, claim],
    [`/accounts/${SELLER}/operations`]: [],
    ...overrides,
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const path = new URL(url).pathname;
    if (!(path in routes)) throw new Error(`Unexpected URL: ${url}`);
    return Response.json({ _embedded: { records: routes[path] } });
  }));
}
const infer = (signal = new AbortController().signal) => inferDistribLite(HORIZON, "Token", ISSUER, signal);
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("claimable-balance distributor inference", () => {
  it("ranks the proven claimant above a full-supply relay without assuming eligible recipients received", async () => {
    mockHistory();
    const candidates = await infer();
    expect(candidates[0].address).toBe(SELLER);
    expect(candidates.some(c => c.address === "GELIGIBLE")).toBe(false);
    expect(candidates[0].reason).toContain("claim");
  });
  it.each([
    ["unclaimed", [create]],
    ["failed claim", [create, { ...claim, transaction_successful: false }]],
    ["clawed back", [create, { ...claim, type: "clawback_claimable_balance" }]],
    ["self claim", [create, { ...claim, claimant: RELAY }]],
  ])("keeps the direct recipient for %s", async (_, records) => {
    mockHistory({ "/claimable_balances/balance/operations": records });
    expect((await infer())[0].address).toBe(RELAY);
  });
  it.each([
    ["failed creation", { ...create, transaction_successful: false }],
    ["ineligible claimant", { ...create, claimants: [{ destination: RELAY }] }],
    ["wrong source", { ...create, source_account: "GSPOOF" }],
    ["wrong issuer", { ...create, asset: "Token:GOTHER" }],
    ["wrong case", { ...create, asset: `TOKEN:${ISSUER}` }],
  ])("ignores %s claimable creation", async (_, op) => {
    mockHistory({ [`/accounts/${RELAY}/operations`]: [op] });
    expect((await infer())[0].address).toBe(RELAY);
  });
  it("does not outrank a relay when only a small fraction was forwarded", async () => {
    const small = { ...create, amount: "1" };
    mockHistory({ [`/accounts/${RELAY}/operations`]: [small],
      "/operations/20/effects": [{ type: "claimable_balance_created", balance_id: "balance", account: RELAY, asset: create.asset, amount: "1" }],
      "/claimable_balances/balance/operations": [small, claim],
    });
    expect((await infer())[0].address).toBe(RELAY);
  });
  it("rejects claim history that cannot prove the matching creation", async () => {
    mockHistory({ "/claimable_balances/balance/operations": [{ ...create, id: "99" }, claim] });
    await expect(infer()).rejects.toThrow("does not prove its creation");
  });
  it("keeps normal direct-payment inference and starts relay history after funding", async () => {
    mockHistory({ [`/accounts/${RELAY}/operations`]: [] });
    const candidates = await infer();
    expect(candidates[0].address).toBe(RELAY);
    const urls = vi.mocked(fetch).mock.calls.map(([url]) => new URL(String(url)));
    expect(urls.find(url => url.pathname === `/accounts/${RELAY}/operations`)?.searchParams.get("cursor")).toBe("10");
  });
  it("follows another proven claim hop without counting the relay twice", async () => {
    const secondCreate = { ...create, id: "40", paging_token: "40", source_account: SELLER, claimants: [{ destination: "GFINAL" }] };
    mockHistory({
      [`/accounts/${SELLER}/operations`]: [secondCreate],
      "/operations/40/effects": [{ type: "claimable_balance_created", balance_id: "second", account: SELLER, asset: secondCreate.asset, amount: secondCreate.amount }],
      "/claimable_balances/second/operations": [secondCreate, { ...claim, id: "50", paging_token: "50", balance_id: "second", claimant: "GFINAL" }],
      "/accounts/GFINAL/operations": [],
    });
    expect((await infer()).map(c => c.address)).toEqual(["GFINAL", RELAY, SELLER]);
  });
  it("does not attribute more than the issuer funded", async () => {
    const large = { ...create, amount: "9000000" };
    mockHistory({ [`/accounts/${RELAY}/operations`]: [large],
      "/operations/20/effects": [{ type: "claimable_balance_created", balance_id: "balance", account: RELAY, asset: create.asset, amount: "9000000" }],
      "/claimable_balances/balance/operations": [large, claim],
    });
    const candidates = await infer();
    expect(candidates[0].address).toBe(SELLER);
    expect(candidates[0].reason).toContain("5,000,000");
  });
  it("rejects cycles instead of counting repeated circulation", async () => {
    const secondCreate = { ...create, id: "40", paging_token: "40", source_account: SELLER, claimants: [{ destination: RELAY }] };
    mockHistory({
      [`/accounts/${SELLER}/operations`]: [secondCreate],
      "/operations/40/effects": [{ type: "claimable_balance_created", balance_id: "second", account: SELLER, asset: secondCreate.asset, amount: secondCreate.amount }],
      "/claimable_balances/second/operations": [secondCreate, { ...claim, id: "50", paging_token: "50", balance_id: "second", claimant: RELAY }],
    });
    await expect(infer()).rejects.toThrow("cycle");
  });
  it("logs every fetched URL", async () => {
    mockHistory();
    const logs: string[] = [];
    await inferDistribLite(HORIZON, "Token", ISSUER, new AbortController().signal, message => logs.push(message));
    expect(logs.filter(message => message.startsWith("  GET "))).toHaveLength(6);
  });
  it("reproduces AFLWA's retained live Horizon payment, creation effect, and successful claim", async () => {
    // Public Horizon records captured 2026-10-14; no balance resource is needed after claiming.
    const { payment, creation, history, effects } = aflwa;
    const routes: Record<string, unknown[]> = {
      [`/accounts/${payment.from}/payments`]: [payment],
      [`/accounts/${payment.from}/operations`]: [],
      [`/accounts/${payment.to}/operations`]: [creation],
      [`/operations/${creation.id}/effects`]: effects,
      "/claimable_balances/000000003b347a425e7ebb55a6bf5857f2995c021e645f7354e5757a87122b6cd4bd993e/operations": history,
      "/accounts/GBHWTASVVCTOEIPWDJ7QFVKCP5XN3VRSQLD2ZARWO2GTH54GDQ4BI3EH/operations": [],
    };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      if (!(path in routes)) throw new Error(`Unexpected URL: ${url}`);
      return Response.json({ _embedded: { records: routes[path] } });
    }));
    const candidates = await inferDistribLite(HORIZON, "AFLWA", payment.from, new AbortController().signal);
    expect(candidates.map(c => c.address)).toEqual(["GBHWTASVVCTOEIPWDJ7QFVKCP5XN3VRSQLD2ZARWO2GTH54GDQ4BI3EH", payment.to]);
    expect(candidates[0].evidence?.map(e => e.kind)).toEqual(["issuer_payment", "claimable_balance"]);
    expect(candidates[0].evidence?.[1]).toMatchObject({
      from: payment.to, to: history[1].claimant, balanceId: history[1].balance_id,
      operationId: creation.id, claimOperationId: history[1].id,
      claimTransactionHash: "165a1a798ff2158c516ec6a3cf9204ad1c3ef83d1c5abcabd69ed40eadb4fb60",
      claimCreatedAt: "2026-02-24T17:26:35Z",
    });
  });
  it("paginates creation effects and successful claim history", async () => {
    mockHistory();
    const original = vi.mocked(fetch).getMockImplementation()!;
    const fillers = Array.from({ length: 200 }, (_, i) => ({ type: "unrelated", paging_token: String(i + 100) }));
    vi.mocked(fetch).mockImplementation(async (...args) => {
      const url = new URL(String(args[0]));
      if (url.pathname === "/operations/20/effects") {
        return Response.json({ _embedded: { records: url.searchParams.has("cursor")
          ? [{ type: "claimable_balance_created", balance_id: "balance", account: RELAY, asset: create.asset, amount: create.amount }] : fillers } });
      }
      if (url.pathname === "/claimable_balances/balance/operations") {
        return Response.json({ _embedded: { records: url.searchParams.has("cursor")
          ? [claim] : [create, ...fillers.slice(1)] } });
      }
      return original(...args);
    });
    expect((await infer())[0].address).toBe(SELLER);
  });
  it("rejects non-advancing full history pages", async () => {
    mockHistory({ [`/accounts/${RELAY}/operations`]: Array.from({ length: 200 }, () => ({ type: "unrelated", paging_token: "10" })) });
    await expect(infer()).rejects.toThrow("history limit");
  });
  it("rejects Stop after the issuer payment page instead of returning a direct candidate", async () => {
    mockHistory();
    const controller = new AbortController();
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (...args) => {
      const response = await original(...args);
      controller.abort();
      return response;
    });
    await expect(infer(controller.signal)).rejects.toThrow();
  });
  it.each([
    ["account", { account: "GSPOOF" }],
    ["asset", { asset: "Token:GOTHER" }],
    ["amount", { amount: "1" }],
  ])("rejects mismatching creation-effect %s", async (_, mismatch) => {
    mockHistory({ "/operations/20/effects": [{ type: "claimable_balance_created", balance_id: "balance", account: RELAY, asset: create.asset, amount: create.amount, ...mismatch }] });
    await expect(infer()).rejects.toThrow("creation history is incomplete");
  });
  it.each([
    ["source", { source_account: "GSPOOF" }],
    ["asset", { asset: "Token:GOTHER" }],
    ["amount", { amount: "1" }],
    ["failed creation", { transaction_successful: false }],
  ])("rejects mismatching related-creation %s", async (_, mismatch) => {
    mockHistory({ "/claimable_balances/balance/operations": [{ ...create, ...mismatch }, claim] });
    await expect(infer()).rejects.toThrow("does not prove its creation");
  });
  it("ignores a claim whose source disagrees with its claimant", async () => {
    mockHistory({ "/claimable_balances/balance/operations": [create, { ...claim, source_account: "GSPOOF" }] });
    expect((await infer())[0].address).toBe(RELAY);
  });
  it("retains unlimited issuer-payment pagination beyond 4000 records", async () => {
    mockHistory({ [`/accounts/${RELAY}/operations`]: [] });
    const original = vi.mocked(fetch).getMockImplementation()!;
    let pages = 0;
    vi.mocked(fetch).mockImplementation(async (...args) => {
      if (new URL(String(args[0])).pathname === `/accounts/${ISSUER}/payments` && pages++ < 20) {
        return Response.json({ _embedded: { records: Array.from({ length: 200 }, (_, i) => ({ type: "unrelated", paging_token: String(pages * 200 + i) })) } });
      }
      return original(...args);
    });
    expect((await infer())[0].address).toBe(RELAY);
    expect(pages).toBe(21);
  });
  it("combines converging funding before tracing that recipient", async () => {
    mockHistory({ [`/accounts/${ISSUER}/payments`]: [
      { type: "payment", from: ISSUER, to: RELAY, asset_code: "Token", asset_issuer: ISSUER, amount: "5000000", paging_token: "10" },
      { type: "payment", from: ISSUER, to: SELLER, asset_code: "Token", asset_issuer: ISSUER, amount: "1000000", paging_token: "11" },
    ] });
    const candidates = await infer();
    expect(candidates.map(c => c.address)).toEqual([SELLER, RELAY]);
    expect(candidates[0].reason).toContain("6,000,000");
  });
  it("explicitly requires manual sellers when a converging recipient was already traced", async () => {
    mockHistory({ [`/accounts/${ISSUER}/payments`]: [
      { type: "payment", from: ISSUER, to: RELAY, asset_code: "Token", asset_issuer: ISSUER, amount: "5000000", paging_token: "10" },
      { type: "payment", from: ISSUER, to: SELLER, asset_code: "Token", asset_issuer: ISSUER, amount: "10000000", paging_token: "11" },
    ] });
    await expect(infer()).rejects.toThrow("converging route");
  });
  it("rejects unavailable claim history instead of silently scanning the relay", async () => {
    mockHistory();
    const fetchMock = vi.mocked(fetch);
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (...args) => new URL(String(args[0])).pathname.includes("claimable_balances")
      ? new Response("pruned", { status: 404 }) : original(...args));
    await expect(infer()).rejects.toThrow("404");
  });
  it("rejects an already stopped scan without returning partial candidates", async () => {
    mockHistory();
    const controller = new AbortController();
    controller.abort();
    await expect(infer(controller.signal)).rejects.toThrow();
  });
  it("retains the relay as a historical-sales candidate with its own receipt evidence", async () => {
    mockHistory();
    const candidates = await infer();
    expect(candidates.map(c => c.address)).toEqual([SELLER, RELAY]);
    expect(candidates[1].reason).toContain("historical sales");
    expect(candidates[1].evidence).toEqual([{
      kind: "issuer_payment", from: ISSUER, to: RELAY, amount: "5000000", operationId: "10",
    }]);
    expect(candidates[0].evidence?.[1]).toMatchObject({
      kind: "claimable_balance", from: RELAY, to: SELLER, amount: "5000000",
      operationId: "20", balanceId: "balance", claimOperationId: "30",
    });
  });
  it("seeds a successful claim created directly by the issuer", async () => {
    const issuance = { ...create, source_account: ISSUER };
    mockHistory({
      [`/accounts/${ISSUER}/payments`]: [],
      [`/accounts/${ISSUER}/operations`]: [issuance],
      "/operations/20/effects": [{ type: "claimable_balance_created", balance_id: "balance", account: ISSUER, asset: create.asset, amount: create.amount }],
      "/claimable_balances/balance/operations": [issuance, claim],
    });
    const candidates = await infer();
    expect(candidates.map(c => c.address)).toEqual([SELLER]);
    expect(candidates[0].evidence?.[0]).toMatchObject({ kind: "claimable_balance", from: ISSUER, to: SELLER });
  });
  it("retains each confirmed branch with the common ancestor proof", async () => {
    const first = { ...create, amount: "2000000" };
    const second = { ...create, id: "40", paging_token: "40", amount: "3000000", claimants: [{ destination: "GSECOND" }] };
    mockHistory({
      [`/accounts/${RELAY}/operations`]: [first, second],
      "/operations/20/effects": [{ type: "claimable_balance_created", balance_id: "balance", account: RELAY, asset: create.asset, amount: first.amount }],
      "/claimable_balances/balance/operations": [first, claim],
      "/operations/40/effects": [{ type: "claimable_balance_created", balance_id: "second", account: RELAY, asset: create.asset, amount: second.amount }],
      "/claimable_balances/second/operations": [second, { ...claim, id: "50", paging_token: "50", balance_id: "second", claimant: "GSECOND" }],
      "/accounts/GSECOND/operations": [],
    });
    const candidates = await infer();
    expect(candidates.map(c => c.address)).toEqual(["GSECOND", SELLER, RELAY]);
    expect(candidates[0].evidence?.map(e => e.operationId)).toEqual(["10", "40"]);
    expect(candidates[1].evidence?.map(e => e.operationId)).toEqual(["10", "20"]);
  });
  it("does not allocate a later issuer payment to an earlier claimable creation", async () => {
    mockHistory({ [`/accounts/${ISSUER}/payments`]: [
      { id: "10", paging_token: "10", type: "payment", from: ISSUER, to: RELAY, asset_code: "Token", asset_issuer: ISSUER, amount: "1" },
      { id: "40", paging_token: "40", type: "payment", from: ISSUER, to: RELAY, asset_code: "Token", asset_issuer: ISSUER, amount: "4999999" },
    ] });
    const candidates = await infer();
    expect(candidates[0].address).toBe(RELAY);
    expect(candidates.find(c => c.address === SELLER)?.reason).toContain("up to 1 Token");
    expect(candidates.find(c => c.address === SELLER)?.evidence?.map(e => e.operationId)).toEqual(["10", "20"]);
    expect(candidates.find(c => c.address === SELLER)?.evidence?.find(e => e.kind === "claimable_balance")?.attributedAmount).toBe("1");
  });
  it("rejects a receipt missing the chronology needed to attribute a claim", async () => {
    mockHistory({ [`/accounts/${ISSUER}/payments`]: [
      { id: "10", type: "payment", from: ISSUER, to: RELAY, asset_code: "Token", asset_issuer: ISSUER, amount: "5000000" },
    ] });
    await expect(infer()).rejects.toThrow("cannot prove operation order");
  });
  it("does not silently truncate more than five confirmed recipients", async () => {
    const payments = Array.from({ length: 6 }, (_, i) => ({ id: String(10 + i), paging_token: String(10 + i),
      type: "payment", from: ISSUER, to: `GRECIPIENT${i}`, asset_code: "Token", asset_issuer: ISSUER, amount: "1" }));
    mockHistory({ [`/accounts/${ISSUER}/payments`]: payments,
      ...Object.fromEntries(payments.map(p => [`/accounts/${p.to}/operations`, []])),
    });
    expect(await infer()).toHaveLength(6);
  });
  it("rejects account widths beyond the bounded inference", async () => {
    mockHistory({ [`/accounts/${ISSUER}/payments`]: Array.from({ length: 21 }, (_, i) => ({
      id: String(10 + i), paging_token: String(10 + i), type: "payment", from: ISSUER, to: `GRECIPIENT${i}`,
      asset_code: "Token", asset_issuer: ISSUER, amount: "1",
    })) });
    await expect(infer()).rejects.toThrow("account limit");
  });

  it("rejects a successful claim ordered before its creation", async () => {
    mockHistory({ "/claimable_balances/balance/operations": [create, { ...claim, id: "15", paging_token: "15" }] });
    await expect(infer()).rejects.toThrow("cannot prove claim order");
  });
  it("rejects malformed Horizon pages instead of returning false certainty", async () => {
    mockHistory();
    vi.mocked(fetch).mockResolvedValue(Response.json({}));
    await expect(infer()).rejects.toThrow("history is incomplete");
  });

});
