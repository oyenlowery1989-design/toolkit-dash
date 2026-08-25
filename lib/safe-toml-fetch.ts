import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_TOML_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;

function isBlockedIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224;
}

export function isBlockedIp(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isBlockedIpv4(address);
  if (version !== 6) return true;

  const normalized = address.toLowerCase().split("%")[0];
  if (normalized.startsWith("::ffff:")) return isBlockedIpv4(normalized.slice(7));
  return normalized === "::"
    || normalized === "::1"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || /^fe[89ab]/.test(normalized)
    || normalized.startsWith("ff");
}

async function assertPublicHost(url: URL): Promise<void> {
  if (url.protocol !== "https:" || (url.port && url.port !== "443")) {
    throw new Error("Only HTTPS on the default port is allowed");
  }
  const hostname = url.hostname.replace(/\.$/, "").toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || isIP(hostname)) {
    throw new Error("Host is not allowed");
  }
  const results = await lookup(hostname, { all: true, verbatim: true });
  if (results.length === 0 || results.some((result) => isBlockedIp(result.address))) {
    throw new Error("Host resolves to a non-public address");
  }
}

async function readLimitedBody(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_TOML_BYTES) {
    throw new Error("TOML file is too large");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_TOML_BYTES) {
      await reader.cancel();
      throw new Error("TOML file is too large");
    }
    chunks.push(value);
  }

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

export async function fetchPublicToml(domain: string): Promise<string> {
  let url = new URL(`https://${domain}/.well-known/stellar.toml`);

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    await assertPublicHost(url);
    const response = await fetch(url, {
      headers: { "User-Agent": "stellar-toolkit/1.0", Accept: "text/plain, application/toml;q=0.9" },
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirect === MAX_REDIRECTS) throw new Error("Too many or invalid redirects");
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) throw new Error(`TOML fetch failed: HTTP ${response.status}`);
    return readLimitedBody(response);
  }

  throw new Error("Too many redirects");
}
