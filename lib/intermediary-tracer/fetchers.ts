import type {
  AccountOriginResult,
  CreatorAccountResult,
  FunderCandidate,
  ScanProgress,
  TraceResult,
} from "./types";
import { scoreCandidate } from "./matcher";

/** Display a Stellar address as GA42…PFBI */
function shortAddr(addr: string): string {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// HTTP helper with retry / backoff (mirrors proceeds-investigator pattern)
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const MAX_RETRIES = 3;
  let delay = 2000;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, { signal });
    if (res.status === 429 || res.status === 503) {
      if (attempt === MAX_RETRIES)
        throw new Error(`Rate limited (${res.status})`);
      const retryAfter = parseInt(res.headers.get("retry-after") ?? "0") * 1000;
      await sleep(retryAfter > 0 ? retryAfter : delay);
      delay = Math.min(delay * 2, 30_000);
      continue;
    }
    if (!res.ok) throw new Error(`Horizon ${res.status}: ${url}`);
    return res.json();
  }
}

type HorizonRecord = Record<string, unknown>;
type HorizonPage = { _embedded?: { records?: HorizonRecord[] } };

// ---------------------------------------------------------------------------
// Fetch create_account info for a single account
// ---------------------------------------------------------------------------

export async function fetchAccountCreation(
  horizonUrl: string,
  account: string,
  signal: AbortSignal,
): Promise<{
  funder: string;
  startingBalance: number;
  createdAt: string;
  pagingToken: string;
} | null> {
  const base = horizonUrl.replace(/\/$/, "");

  const toResult = (op: HorizonRecord) => ({
    funder: op.funder as string,
    startingBalance: parseFloat((op.starting_balance as string) ?? "0"),
    createdAt: op.created_at as string,
    pagingToken: op.paging_token as string,
  });

  // Only accept a create_account op where this address is the one being created,
  // not one where it acted as the funder.
  const isOwnCreation = (op: HorizonRecord) =>
    op.type === "create_account" && (op.account as string) === account;

  try {
    // Pass 1: fast path — the very first op (ascending) is the create_account.
    const page = (await fetchJson(
      `${base}/accounts/${encodeURIComponent(account)}/operations?order=asc&limit=1`,
      signal,
    )) as HorizonPage;
    const firstOp = page._embedded?.records?.[0];
    if (firstOp && isOwnCreation(firstOp)) return toResult(firstOp);

    // Pass 2: type-filtered scan (200 ops). Horizon returns create_account ops
    // involving this address (either as account or funder) — use strict match.
    const filtered = (await fetchJson(
      `${base}/accounts/${encodeURIComponent(account)}/operations?order=asc&limit=200&type=create_account`,
      signal,
    )) as HorizonPage;
    const filteredOp = (filtered._embedded?.records ?? []).find(isOwnCreation);
    if (filteredOp) return toResult(filteredOp);

    // Pass 3: unfiltered scan — for Horizon nodes that don't support type filtering.
    const unfiltered = (await fetchJson(
      `${base}/accounts/${encodeURIComponent(account)}/operations?order=asc&limit=200`,
      signal,
    )) as HorizonPage;
    const unfilteredOp = (unfiltered._embedded?.records ?? []).find(
      isOwnCreation,
    );
    if (unfilteredOp) return toResult(unfilteredOp);

    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Find funder candidates for a single create_account operation
//
// Strategy: scan incoming payments to the intermediary going backwards
// from the create_account paging_token (i.e., look at older records).
// Stop as soon as we go past (createdAt - windowSec).
// ---------------------------------------------------------------------------

export async function findFunderCandidates(
  horizonUrl: string,
  intermediary: string,
  createPagingToken: string,
  createdAt: string,
  startingBalance: number,
  windowSec: number,
  tolerancePct: number,
  signal: AbortSignal,
): Promise<{ candidates: FunderCandidate[]; noNativeCandidates: boolean }> {
  const base = horizonUrl.replace(/\/$/, "");
  const createTime = new Date(createdAt).getTime();
  const fromTime = createTime - windowSec * 1_000;

  const candidates: FunderCandidate[] = [];
  let hasAnyInWindow = false;

  // Scan backwards in time from the create_account paging_token
  let cursor: string | undefined = createPagingToken;

  while (!signal.aborted) {
    const params = new URLSearchParams({ order: "desc", limit: "100" });
    if (cursor) params.set("cursor", cursor);

    const data = (await fetchJson(
      `${base}/accounts/${encodeURIComponent(intermediary)}/payments?${params}`,
      signal,
    )) as HorizonPage;
    const records = data._embedded?.records ?? [];

    let pastWindow = false;
    for (const rec of records) {
      const recTime = new Date(rec.created_at as string).getTime();

      if (recTime > createTime) {
        // Skip records after the create_account (shouldn't happen but be safe)
        continue;
      }
      if (recTime < fromTime) {
        // Past our window — stop
        pastWindow = true;
        break;
      }

      hasAnyInWindow = true;

      // Must be incoming to intermediary
      const to = (rec.to ?? rec.account) as string | undefined;
      if (to !== intermediary) continue;
      if (rec.type === "create_account") continue;

      const from = (rec.from ?? rec.funder) as string | undefined;
      if (!from || from === intermediary) continue;

      const rawAmount = (rec.amount ?? rec.starting_balance) as string;
      const sentAmount = parseFloat(rawAmount ?? "0");
      if (sentAmount <= 0) continue;

      const assetType = rec.asset_type as string;
      const asset =
        assetType === "native"
          ? "XLM"
          : `${rec.asset_code as string}:${rec.asset_issuer as string}`;

      // Only XLM payments can be amount-correlated with create_account
      if (assetType !== "native") continue;

      const { timeDeltaSec, amountDiffPct, confidence } = scoreCandidate(
        sentAmount,
        startingBalance,
        rec.created_at as string,
        createdAt,
        windowSec,
      );

      // Filter by tolerance and minimum confidence
      if (amountDiffPct > tolerancePct) continue;
      if (confidence < 20) continue;

      candidates.push({
        address: from,
        sentAmount,
        asset,
        sentAt: rec.created_at as string,
        timeDeltaSec,
        amountDiffPct,
        confidence,
      });
    }

    if (pastWindow || records.length < 100) break;
    cursor = records[records.length - 1].paging_token as string;
  }

  candidates.sort((a, b) => b.confidence - a.confidence);

  return {
    candidates: candidates.slice(0, 5),
    noNativeCandidates: !hasAnyInWindow,
  };
}

// ---------------------------------------------------------------------------
// Trace a single account's origin through an intermediary
// ---------------------------------------------------------------------------

export async function traceAccountOrigin(
  horizonUrl: string,
  targetAccount: string,
  windowSec: number,
  tolerancePct: number,
  knownIntermediaries: Map<string, string>, // address → name
  signal: AbortSignal,
  onLog: (msg: string) => void = () => {},
): Promise<TraceResult | null> {
  onLog(`Fetching creation info for ${shortAddr(targetAccount)}`);

  const creation = await fetchAccountCreation(
    horizonUrl,
    targetAccount,
    signal,
  );
  if (!creation) {
    onLog(
      "No create_account operation found — account may not exist or is invalid.",
    );
    return null;
  }
  if (signal.aborted) return null;

  const creatorName = knownIntermediaries.get(creation.funder);
  const isKnownIntermediary = knownIntermediaries.has(creation.funder);

  onLog(
    `Created by: ${shortAddr(creation.funder)}${creatorName ? ` (${creatorName})` : ""}`,
  );
  onLog(
    `Created at: ${new Date(creation.createdAt).toLocaleString()} · Starting balance: ${creation.startingBalance} XLM`,
  );

  let candidates: FunderCandidate[] = [];
  let noNativeCandidates = false;

  if (isKnownIntermediary) {
    onLog(
      `Known intermediary detected — searching for funder candidates (window=${windowSec}s, tolerance=${tolerancePct}%)…`,
    );
    const result = await findFunderCandidates(
      horizonUrl,
      creation.funder,
      creation.pagingToken,
      creation.createdAt,
      creation.startingBalance,
      windowSec,
      tolerancePct,
      signal,
    );
    candidates = result.candidates;
    noNativeCandidates = result.noNativeCandidates;

    if (candidates.length > 0) {
      onLog(
        `Found ${candidates.length} candidate(s). Top: ${shortAddr(candidates[0].address)} confidence=${candidates[0].confidence}%`,
      );
    } else if (noNativeCandidates) {
      onLog(
        "No XLM payments found in window — account may have been funded via non-native asset.",
      );
    } else {
      onLog("No matching payments found in the time window.");
    }
  } else {
    onLog("Creator is not a known intermediary — no further lookup needed.");
  }

  return {
    targetAccount,
    createdAt: creation.createdAt,
    startingBalance: creation.startingBalance,
    creator: creation.funder,
    creatorName,
    isKnownIntermediary,
    candidates,
    noNativeCandidates,
  };
}

// ---------------------------------------------------------------------------
// Bulk scan: find all accounts created by the intermediary in a time range
// ---------------------------------------------------------------------------

export interface CreatedAccountEntry {
  account: string;
  createdAt: string;
  startingBalance: number;
  pagingToken: string;
  /**
   * undefined = Phase 2 not yet run (show "searching…")
   * null      = Phase 2 ran, no funder found
   * FunderCandidate = funder identified
   */
  topFunder?: FunderCandidate | null;
  noNativeCandidates?: boolean;
  homeDomain?: string;
}

export async function scanIntermediaryCreations(
  horizonUrl: string,
  intermediary: string,
  fromDate: Date | null,
  windowSec: number,
  tolerancePct: number,
  signal: AbortSignal,
  onLog: (msg: string) => void = () => {},
  onResult: (entry: CreatedAccountEntry) => void = () => {},
): Promise<CreatedAccountEntry[]> {
  const base = horizonUrl.replace(/\/$/, "");
  const fromTs = fromDate?.getTime() ?? 0;

  // ── Phase 1: collect all create_account ops by intermediary ─────────────

  const phase1: CreatedAccountEntry[] = [];
  let cursor: string | undefined;
  let pageCount = 0;

  onLog(
    `Phase 1: scanning accounts created by ${shortAddr(intermediary)}${fromDate ? ` since ${fromDate.toLocaleString()}` : " (all time)"}`,
  );

  outer: while (!signal.aborted) {
    const params = new URLSearchParams({
      order: "desc",
      limit: "200",
      type: "create_account",
    });
    if (cursor) params.set("cursor", cursor);

    const url = `${base}/accounts/${encodeURIComponent(intermediary)}/operations?${params}`;
    onLog(`  GET ${url}`);
    const data = (await fetchJson(url, signal)) as HorizonPage;
    const records = data._embedded?.records ?? [];
    pageCount++;

    const newest = records[0]?.created_at as string | undefined;
    const oldest = records[records.length - 1]?.created_at as
      | string
      | undefined;
    const dateRange =
      newest && oldest
        ? ` [${new Date(oldest).toLocaleString()} → ${new Date(newest).toLocaleString()}]`
        : "";
    onLog(`  Page ${pageCount}: ${records.length} ops${dateRange}`);

    for (const op of records) {
      const opTime = new Date(op.created_at as string).getTime();
      if (opTime < fromTs) {
        onLog(`  Reached date cutoff — stopping`);
        break outer;
      }

      if (op.type === "create_account" && op.funder === intermediary) {
        const entry: CreatedAccountEntry = {
          account: op.account as string,
          createdAt: op.created_at as string,
          startingBalance: parseFloat((op.starting_balance as string) ?? "0"),
          pagingToken: op.paging_token as string,
        };
        phase1.push(entry);
        onResult(entry); // stream immediately — UI shows row with "searching…" state
        onLog(
          `  → ${shortAddr(entry.account)} at ${new Date(entry.createdAt).toLocaleString()} · ${entry.startingBalance} XLM`,
        );
      }
    }

    if (records.length < 200) {
      onLog(`  End of records (${records.length} on last page)`);
      break;
    }
    cursor = records[records.length - 1].paging_token as string;
  }

  onLog(`Phase 1 complete: ${phase1.length} accounts found`);

  if (phase1.length === 0 || signal.aborted) return phase1;

  // ── Phase 2: find funder for each account (up to 4 in parallel) ──────────

  onLog(
    `Phase 2: searching funders (window=${windowSec}s, tolerance=${tolerancePct}%, concurrency=4)`,
  );

  const results: CreatedAccountEntry[] = new Array(phase1.length);
  let processed = 0;

  async function processOne(i: number): Promise<void> {
    if (signal.aborted) return;
    const entry = phase1[i];
    onLog(
      `  [${i + 1}/${phase1.length}] ${shortAddr(entry.account)} · ${entry.startingBalance} XLM`,
    );

    const [{ candidates, noNativeCandidates }, accountData] = await Promise.all(
      [
        findFunderCandidates(
          horizonUrl,
          intermediary,
          entry.pagingToken,
          entry.createdAt,
          entry.startingBalance,
          windowSec,
          tolerancePct,
          signal,
        ),
        fetchJson(
          `${base}/accounts/${encodeURIComponent(entry.account)}`,
          signal,
        )
          .then((d) => d as Record<string, unknown>)
          .catch(() => ({}) as Record<string, unknown>),
      ],
    );

    const homeDomain =
      (accountData.home_domain as string | undefined) || undefined;
    // null = processed, no funder found; undefined = not yet processed
    const topFunder: FunderCandidate | null = candidates[0] ?? null;

    if (homeDomain) onLog(`    → Home domain: ${homeDomain}`);
    if (topFunder) {
      onLog(
        `    → Funder: ${shortAddr(topFunder.address)} · confidence=${topFunder.confidence}%`,
      );
    } else if (noNativeCandidates) {
      onLog(`    → No XLM payments found in window`);
    } else {
      onLog(`    → No matching payment found`);
    }

    const result: CreatedAccountEntry = {
      ...entry,
      topFunder,
      noNativeCandidates,
      homeDomain,
    };
    results[i] = result;
    processed++;
    onResult(result);
  }

  // Run with concurrency limit of 4
  const CONCURRENCY = 4;
  const queue = [...phase1.keys()]; // [0, 1, 2, ...]
  async function worker(): Promise<void> {
    while (queue.length > 0 && !signal.aborted) {
      const i = queue.shift()!;
      await processOne(i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, phase1.length) }, worker),
  );

  if (signal.aborted) onLog(`Stopped after ${processed}/${phase1.length}`);
  onLog(`Done. ${processed} results.`);
  return results.filter(Boolean);
}

// ---------------------------------------------------------------------------
// Reverse lookup: given a known creator + intermediary, find all accounts
// the creator funded through that intermediary.
//
// Strategy:
//   Phase 1 — scan creator's outgoing XLM payments to the intermediary.
//   Phase 2 — for each such payment at time T, amount A, scan the
//             intermediary's create_account ops AFTER T within windowSec,
//             match by amount (tolerance) and time proximity.
// ---------------------------------------------------------------------------

export async function findCreatorAccounts(
  horizonUrl: string,
  creator: string,
  intermediary: string,
  fromDate: Date | null,
  windowSec: number,
  tolerancePct: number,
  signal: AbortSignal,
  onLog: (msg: string) => void = () => {},
  onResult: (r: CreatorAccountResult) => void = () => {},
): Promise<CreatorAccountResult[]> {
  const base = horizonUrl.replace(/\/$/, "");
  const fromTs = fromDate?.getTime() ?? 0;

  // ── Phase 1: outgoing XLM payments from creator → intermediary ──────────

  onLog(
    `Phase 1: scanning outgoing XLM payments from ${shortAddr(creator)} → ${shortAddr(intermediary)}${fromDate ? ` since ${fromDate.toLocaleDateString()}` : " (all time)"}`,
  );

  type Payment = {
    pagingToken: string;
    sentAt: string;
    sentAmount: number;
  };

  const payments: Payment[] = [];
  let cursor: string | undefined;
  let pageCount = 0;

  outer: while (!signal.aborted) {
    const params = new URLSearchParams({ order: "desc", limit: "200" });
    if (cursor) params.set("cursor", cursor);

    const url = `${base}/accounts/${encodeURIComponent(creator)}/payments?${params}`;
    onLog(`  GET ${url}`);
    const data = (await fetchJson(url, signal)) as HorizonPage;
    const records = data._embedded?.records ?? [];
    pageCount++;

    let relevantCount = 0;
    for (const rec of records) {
      const recTime = new Date(rec.created_at as string).getTime();
      if (recTime < fromTs) {
        onLog(`  Reached date limit — stopping Phase 1`);
        break outer;
      }

      // Must be outgoing XLM payment from creator to intermediary
      if (
        rec.asset_type === "native" &&
        (rec.from ?? rec.funder) === creator &&
        (rec.to ?? rec.account) === intermediary
      ) {
        payments.push({
          pagingToken: rec.paging_token as string,
          sentAt: rec.created_at as string,
          sentAmount: parseFloat((rec.amount as string) ?? "0"),
        });
        relevantCount++;
      }
    }

    const newest = records[0]?.created_at as string | undefined;
    const oldest = records[records.length - 1]?.created_at as
      | string
      | undefined;
    const dateRange =
      newest && oldest
        ? ` [${new Date(oldest).toLocaleDateString()} → ${new Date(newest).toLocaleDateString()}]`
        : "";
    onLog(
      `  Page ${pageCount}: ${records.length} payments (${relevantCount} to intermediary)${dateRange}`,
    );

    if (records.length < 200) {
      onLog(`  Last page reached`);
      break;
    }
    cursor = records[records.length - 1].paging_token as string;
  }

  onLog(
    `Phase 1 complete: ${payments.length} outgoing XLM payments to intermediary`,
  );

  if (payments.length === 0) return [];

  // ── Phase 2: for each payment, find create_account ops by intermediary
  //            that happened within windowSec AFTER the payment.
  //
  //  We scan the intermediary's operations in ascending order (oldest first),
  //  starting from the beginning of each payment's time window. Since we can't
  //  cursor by timestamp, we scan pages until opTime > untilTime, stopping early.
  // ---------------------------------------------------------------------------

  onLog(
    `Phase 2: for each payment, scanning intermediary ops in the next ${windowSec}s for a matching create_account`,
  );

  const results: CreatorAccountResult[] = [];

  for (let i = 0; i < payments.length; i++) {
    if (signal.aborted) {
      onLog(`Stopped after ${i}/${payments.length} payments processed`);
      break;
    }

    const pmt = payments[i];
    const sentTime = new Date(pmt.sentAt).getTime();
    const untilTime = sentTime + windowSec * 1_000;

    onLog(
      `  [${i + 1}/${payments.length}] ${pmt.sentAmount} XLM sent at ${new Date(pmt.sentAt).toLocaleString()} — looking for create_account within ${windowSec}s…`,
    );

    // Walk intermediary's operations forward in time from the payment.
    // We use the payment's paging_token as a starting cursor — since Horizon
    // operation IDs are globally sequential, this seeks the intermediary's
    // op stream to approximately the same point in ledger time.
    // We then scan ascending until we're past untilTime.
    let opCursor: string | undefined = pmt.pagingToken;
    let opPageCount = 0;
    let foundInWindow = false;

    opLoop: while (!signal.aborted) {
      const params = new URLSearchParams({
        order: "asc",
        limit: "200",
        type: "create_account",
      });
      if (opCursor) params.set("cursor", opCursor);

      const opUrl = `${base}/accounts/${encodeURIComponent(intermediary)}/operations?${params}`;
      onLog(`    GET ${opUrl}`);
      const data = (await fetchJson(opUrl, signal)) as HorizonPage;
      const records = data._embedded?.records ?? [];
      opPageCount++;

      for (const op of records) {
        const opTime = new Date(op.created_at as string).getTime();

        if (opTime > untilTime) break opLoop; // past the window — done

        // only keep create_account ops where the intermediary is the funder
        if (op.type !== "create_account" || op.funder !== intermediary)
          continue;

        const startingBalance = parseFloat(
          (op.starting_balance as string) ?? "0",
        );
        const { timeDeltaSec, amountDiffPct, confidence } = scoreCandidate(
          pmt.sentAmount,
          startingBalance,
          pmt.sentAt,
          op.created_at as string,
          windowSec,
        );

        if (amountDiffPct > tolerancePct) continue;
        if (confidence < 20) continue;

        const accountData = await fetchJson(
          `${base}/accounts/${encodeURIComponent(op.account as string)}`,
          signal,
        )
          .then((d) => d as Record<string, unknown>)
          .catch(() => ({}) as Record<string, unknown>);
        const homeDomain =
          (accountData.home_domain as string | undefined) || undefined;

        onLog(
          `    → ${shortAddr(op.account as string)} created ${new Date(op.created_at as string).toLocaleString()} · ${startingBalance} XLM · confidence=${confidence}%${homeDomain ? ` · ${homeDomain}` : ""}`,
        );

        const result: CreatorAccountResult = {
          createdAccount: op.account as string,
          createdAt: op.created_at as string,
          startingBalance,
          sentAt: pmt.sentAt,
          sentAmount: pmt.sentAmount,
          timeDeltaSec,
          amountDiffPct,
          confidence,
          homeDomain,
        };
        results.push(result);
        onResult(result);
        foundInWindow = true;
      }

      if (records.length < 200) break; // no more ops
      opCursor = records[records.length - 1].paging_token as string;
    }

    if (!foundInWindow) {
      onLog(
        `    → no matching create_account found in window (scanned ${opPageCount} page(s))`,
      );
    }
  }

  onLog(`Done. ${results.length} accounts found.`);
  return results;
}
