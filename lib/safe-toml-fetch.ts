import { request } from "node:https";
import type { LookupFunction } from "node:net";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_TOML_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 8000;

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
  return !/^[23][0-9a-f]{3}:/.test(normalized)
    || normalized.startsWith("2001:db8:") || normalized.startsWith("2002:") || normalized.startsWith("2001:0:")
    || normalized === "::"
    || normalized === "::1"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || /^fe[89ab]/.test(normalized)
    || normalized.startsWith("ff");
}

async function assertPublicHost(url: URL) {
  if (url.protocol !== "https:" || (url.port && url.port !== "443")) {
    throw new Error("Only HTTPS on the default port is allowed");
  }
  const hostname = url.hostname.replace(/\.$/, "").toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || isIP(hostname)) {
    throw new Error("Host is not allowed");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const results = await Promise.race([
    lookup(hostname, { all: true, verbatim: true }),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("TOML DNS lookup timed out")), REQUEST_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
  if (results.length === 0 || results.some((result) => isBlockedIp(result.address))) {
    throw new Error("Host resolves to a non-public address");
  }
  return results;
}

/** Bind the socket lookup to the validated result; TLS still verifies the original hostname. */
export async function fetchPinnedToml(url: URL): Promise<{ status: number; location?: string; body: string }> {
  const deadline = Date.now() + REQUEST_TIMEOUT_MS;
  const addresses = await assertPublicHost(url);
  const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  };
  return new Promise((resolve, reject) => {
    const req = request(url, {
      lookup: pinnedLookup, agent: false,
      headers: { "User-Agent": "stellar-toolkit/1.0", Accept: "text/plain, application/toml;q=0.9" },
    });
    const timer = setTimeout(() => req.destroy(new Error("TOML request timed out")), Math.max(1, deadline - Date.now()));
    req.on("error", reject);
    req.on("close", () => clearTimeout(timer));
    req.on("response", (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
        response.destroy();
        resolve({ status: response.statusCode, location: response.headers.location, body: "" });
        return;
      }
      if (Number(response.headers["content-length"]) > MAX_TOML_BYTES) {
        response.destroy(); reject(new Error("TOML file is too large")); return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      response.on("error", reject);
      response.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > MAX_TOML_BYTES) { response.destroy(new Error("TOML file is too large")); return; }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({ status: response.statusCode ?? 502, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.end();
  });
}

export async function fetchPublicToml(domain: string): Promise<string> {
  let url = new URL(`https://${domain}/.well-known/stellar.toml`);

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const response = await fetchPinnedToml(url);

    if (response.status >= 300 && response.status < 400) {
      const location = response.location;
      if (!location || redirect === MAX_REDIRECTS) throw new Error("Too many or invalid redirects");
      url = new URL(location, url);
      continue;
    }
    if (response.status < 200 || response.status >= 300) throw new Error(`TOML fetch failed: HTTP ${response.status}`);
    return response.body;
  }

  throw new Error("Too many redirects");
}
