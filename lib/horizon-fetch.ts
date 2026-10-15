export class HorizonFetchError extends Error {
  constructor(public status: number, url: string) {
    super(`Horizon request failed (${status}): ${url}`);
    this.name = "HorizonFetchError";
  }
}

const RETRYABLE = new Set([429, 502, 503, 504]);

// Parse a Retry-After header into milliseconds. Supports both the
// delta-seconds form ("120") and the HTTP-date form. Returns null when the
// header is absent or unparseable, so the caller falls back to exponential
// backoff.
function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

export async function fetchJson(
  url: string,
  signal?: AbortSignal,
  opts: { retries?: number; onLog?: (msg: string) => void; headers?: HeadersInit; timeoutMs?: number } = {},
): Promise<any> {
  signal?.throwIfAborted();
  if (opts.timeoutMs !== undefined) {
    const { timeoutMs, ...requestOpts } = opts;
    const deadline = new AbortController();
    const requestSignal = AbortSignal.any(signal ? [signal, deadline.signal] : [deadline.signal]);
    const timer = setTimeout(() => deadline.abort(new DOMException(`Horizon request timed out after ${timeoutMs}ms: ${url}`, "TimeoutError")), timeoutMs);
    let onAbort: () => void = () => {};
    try {
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(requestSignal.reason);
        requestSignal.addEventListener("abort", onAbort, { once: true });
      });
      return await Promise.race([fetchJson(url, requestSignal, requestOpts), aborted]);
    } finally {
      clearTimeout(timer);
      requestSignal.removeEventListener("abort", onAbort);
    }
  }
  const retries = opts.retries ?? 4;
  let lastStatus = 0;
  let retryAfterMs: number | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    signal?.throwIfAborted();
    if (attempt > 0) {
      const delay = retryAfterMs ?? 500 * 2 ** (attempt - 1);
      retryAfterMs = null;
      opts.onLog?.(`  retry ${attempt}/${retries} in ${delay}ms (HTTP ${lastStatus})`);
      signal?.throwIfAborted();
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => { clearTimeout(t); signal?.removeEventListener("abort", onAbort); reject(signal?.reason ?? new DOMException("aborted", "AbortError")); };
        const t = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, delay);
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    }
    let res: Response;
    try {
      signal?.throwIfAborted();
      res = await fetch(url, { signal, headers: opts.headers });
    } catch (e) {
      signal?.throwIfAborted();
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      lastStatus = 0; // network error — retryable
      if (attempt === retries) throw e;
      continue;
    }
    if (res.ok) return res.json();
    lastStatus = res.status;
    if (!RETRYABLE.has(res.status)) throw new HorizonFetchError(res.status, url);
    if (attempt === retries) throw new HorizonFetchError(res.status, url);
    // Honour a server-provided Retry-After for the next backoff sleep;
    // falls back to exponential backoff when the header is absent.
    retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
  }
  throw new HorizonFetchError(lastStatus, url); // unreachable guard (finding F9)
}
