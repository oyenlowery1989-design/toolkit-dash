import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase-server";

// ---------------------------------------------------------------------------
// Horizon Proxy
//
// Routes GET /api/horizon/<path...> to public-network Horizon.
//
// Benefits over direct client-side requests:
//   - Single place to add caching, rate limiting, or auth headers later.
//   - Hides the upstream Horizon URL from browser network logs.
//   - Removes the Horizon domains from the browser CSP connect-src if all
//     pages are migrated to use this proxy.
// ---------------------------------------------------------------------------

const HORIZON_URLS: Record<string, string> = {
  public: "https://horizon.stellar.org",
};

// Hard limit: refuse suspiciously large upstream responses to avoid buffering
// a multi-MB payload in a serverless function.
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024; // 4 MB

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const { path } = await params;

  const { searchParams } = request.nextUrl;
  const network = searchParams.get("network") ?? "public";

  const baseUrl = HORIZON_URLS[network];
  if (!baseUrl) {
    return NextResponse.json(
      {
        error: `Unknown network: ${network}. Only public mainnet is supported.`,
      },
      { status: 400 },
    );
  }

  // Forward all query params except "network".
  const forwardParams = new URLSearchParams(searchParams);
  forwardParams.delete("network");

  const upstreamPath = "/" + path.join("/");
  const qs = forwardParams.toString();
  const targetUrl = `${baseUrl}${upstreamPath}${qs ? `?${qs}` : ""}`;

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, {
      headers: { Accept: "application/json" },
      // Next.js fetch is cached by default in production; opt out so we always
      // get fresh data (callers can add their own Cache-Control headers).
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { error: "Could not reach Horizon. Check network connectivity." },
      { status: 502 },
    );
  }

  // Guard against unexpectedly large responses.
  const contentLength = upstream.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > MAX_RESPONSE_BYTES) {
    await upstream.body?.cancel();
    return NextResponse.json(
      { error: "Upstream response too large." },
      { status: 502 },
    );
  }

  let body: unknown;
  try {
    if (!upstream.body) throw new Error("Missing response body");
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let json = "";
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return NextResponse.json({ error: "Upstream response too large." }, { status: 502 });
      }
      json += decoder.decode(chunk.value, { stream: true });
    }
    body = JSON.parse(json + decoder.decode());
  } catch {
    return NextResponse.json(
      { error: "Upstream returned non-JSON response." },
      { status: 502 },
    );
  }

  return NextResponse.json(body, {
    status: upstream.status,
    headers: {
      // Propagate Horizon's rate-limit headers so callers can back off.
      ...(upstream.headers.get("x-ratelimit-limit")
        ? { "x-ratelimit-limit": upstream.headers.get("x-ratelimit-limit")! }
        : {}),
      ...(upstream.headers.get("x-ratelimit-remaining")
        ? {
            "x-ratelimit-remaining": upstream.headers.get(
              "x-ratelimit-remaining",
            )!,
          }
        : {}),
    },
  });
}
