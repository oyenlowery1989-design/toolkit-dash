/// <reference lib="webworker" />

import { Keypair } from "stellar-sdk";

type MatchType = "starts" | "ends" | "contains" | "starts_and_ends";

interface WorkerConfig {
  pattern: string;
  matchType: MatchType;
  maxAttempts: number;
  suffixPattern?: string;
}

function checkMatch(
  str: string,
  pat: string,
  type: MatchType,
  suffixPat?: string,
): boolean {
  if (type === "starts_and_ends") {
    return str.startsWith(pat) && str.endsWith(suffixPat ?? "");
  }
  if (type === "starts") return str.startsWith(pat);
  if (type === "ends") return str.endsWith(pat);
  return str.includes(pat);
}

self.onmessage = (e: MessageEvent<WorkerConfig>) => {
  const { pattern, matchType, maxAttempts, suffixPattern } = e.data;
  let attempts = 0;
  const batchSize = 100;

  try {
    while (attempts < maxAttempts) {
      const pair = Keypair.random();
      const pub = pair.publicKey();

      if (checkMatch(pub, pattern, matchType, suffixPattern)) {
        self.postMessage({
          type: "found",
          key: { publicKey: pub, secret: pair.secret() },
          attempts,
        });
      }

      attempts++;

      if (attempts % batchSize === 0) {
        self.postMessage({ type: "progress", attempts });
      }
    }

    self.postMessage({ type: "limit_reached", attempts });
  } catch (err) {
    self.postMessage({ type: "error", message: (err as Error).message });
  }
};
