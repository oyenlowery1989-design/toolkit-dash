import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const auth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase-server", () => ({ requireAuth: auth }));
import { GET } from "@/app/api/horizon/[...path]/route";

const request = () => new NextRequest("http://localhost/api/horizon/accounts/GABC?network=public");
const params = { params: Promise.resolve({ path: ["accounts", "GABC"] }) };

afterEach(() => vi.unstubAllGlobals());

describe("Horizon proxy", () => {
  it("rejects unauthenticated requests without contacting Horizon", async () => {
    auth.mockResolvedValue({ ok: false, response: new Response("", { status: 401 }) });
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect((await GET(request(), params)).status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects an oversized response without a Content-Length header", async () => {
    auth.mockResolvedValue({ ok: true, userId: "owner" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array(4 * 1024 * 1024 + 1))));
    const response = await GET(request(), params);
    expect(response.status).toBe(502);
    expect((await response.json()).error).toMatch(/too large/);
  });

  it("returns a bounded JSON response", async () => {
    auth.mockResolvedValue({ ok: true, userId: "owner" });
    const fetcher = vi.fn().mockResolvedValue(Response.json({ account_id: "GABC" }));
    vi.stubGlobal("fetch", fetcher);
    const response = await GET(request(), params);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ account_id: "GABC" });
    expect(fetcher).toHaveBeenCalledWith("https://horizon.stellar.org/accounts/GABC", expect.any(Object));
  });
});
