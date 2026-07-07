import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchXlmBalance } from "../horizon-balance";

afterEach(() => vi.restoreAllMocks());

describe("fetchXlmBalance", () => {
  it("returns parsed native balance on 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ balances: [{ asset_type: "native", balance: "123.4567890" }] }), { status: 200 })));
    await expect(fetchXlmBalance("http://x", "G...")).resolves.toBeCloseTo(123.456789);
  });

  it("returns 'unfunded' on 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nf", { status: 404 })));
    await expect(fetchXlmBalance("http://x", "G...")).resolves.toBe("unfunded");
  });

  it("returns 'error' on non-OK status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 500 })));
    await expect(fetchXlmBalance("http://x", "G...")).resolves.toBe("error");
  });

  it("returns 'error' when no native balance entry exists", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ balances: [{ asset_type: "credit_alphanum4", balance: "5" }] }), { status: 200 })));
    await expect(fetchXlmBalance("http://x", "G...")).resolves.toBe("error");
  });

  it("returns 'error' on network/abort failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError")));
    await expect(fetchXlmBalance("http://x", "G...")).resolves.toBe("error");
  });

  it("respects an already-aborted external signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const f = vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError"));
    vi.stubGlobal("fetch", f);
    await expect(fetchXlmBalance("http://x", "G...", controller.signal)).resolves.toBe("error");
  });
});
