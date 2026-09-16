import { afterEach, describe, expect, it, vi } from "vitest";
import { inferDistribLite } from "@/lib/asset-lookup/fetchers";

const HORIZON = "https://horizon.example.com";
const ISSUER = "GISSUER";

afterEach(() => vi.restoreAllMocks());

describe("inferDistribLite", () => {
  it("does not infer a recipient from a case-distinct asset", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          _embedded: {
            records: [
              {
                type: "payment",
                from: ISSUER,
                to: "GDISTRIBUTOR",
                asset_code: "TOKEN",
                asset_issuer: ISSUER,
                amount: "100",
              },
            ],
          },
        }),
      ),
    );

    const candidates = await inferDistribLite(
      HORIZON,
      "Token",
      ISSUER,
      new AbortController().signal,
    );

    expect(candidates).toEqual([]);
  });

  it("surfaces Horizon failures instead of reporting no candidates", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unavailable", { status: 400 })),
    );

    await expect(
      inferDistribLite(
        HORIZON,
        "TOKEN",
        ISSUER,
        new AbortController().signal,
      ),
    ).rejects.toThrow("Horizon request failed (400)");
  });
});
