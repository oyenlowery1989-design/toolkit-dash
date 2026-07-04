export class HorizonFetchError extends Error {
  constructor(public status: number, url: string) {
    super(`Horizon request failed (${status}): ${url}`);
    this.name = "HorizonFetchError";
  }
}

const RETRYABLE = new Set([429, 502, 503, 504]);

export async function fetchJson(
  url: string,
  signal?: AbortSignal,
  opts: { retries?: number; onLog?: (msg: string) => void } = {},
): Promise<any> {
  const retries = opts.retries ?? 4;
  let lastStatus = 0;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const delay = 500 * 2 ** (attempt - 1);
      opts.onLog?.(`  retry ${attempt}/${retries} in ${delay}ms (HTTP ${lastStatus})`);
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, delay);
        signal?.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("aborted", "AbortError")); }, { once: true });
      });
    }
    let res: Response;
    try {
      res = await fetch(url, { signal });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      lastStatus = 0; // network error — retryable
      if (attempt === retries) throw e;
      continue;
    }
    if (res.ok) return res.json();
    lastStatus = res.status;
    if (!RETRYABLE.has(res.status)) throw new HorizonFetchError(res.status, url);
    if (attempt === retries) throw new HorizonFetchError(res.status, url);
  }
  throw new HorizonFetchError(lastStatus, url); // unreachable guard (finding F9)
}
