// components/address-balances/AddressBalancesPanel.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  Loader2,
  RefreshCw,
  Search,
  Wallet,
  X,
} from "lucide-react";
import { useSettings, resolveHorizonUrl } from "@/lib/settings";
import { ShortAddress } from "@/components/shared/ShortAddress";
import { formatXlm, parseAddresses } from "@/lib/format";
import { useBulkScanState } from "@/hooks/use-bulk-scan-state";
import { useXlmUsdPrice } from "@/hooks/use-xlm-usd-price";
import { useSavedSearches } from "@/hooks/use-saved-searches";
import { fetchAddressBalance } from "@/lib/address-balances/fetchers";

function formatUsd(xlm: number, price: number): string {
  return (xlm * price).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AddressRowStatus = "pending" | "loading" | "done" | "error" | "unfunded";

interface AddressRow {
  address: string;
  status: AddressRowStatus;
  total?: number;
  available?: number;
  error?: string;
  locked?: boolean;
  lockReason?: string | null;
}

const SCAN_KEY = "address-balances";
const CONCURRENCY = 5;
const MIN_USD_OPTIONS = [10, 20, 50, 100] as const;

// ---------------------------------------------------------------------------
// Concurrency helper (same pattern as BulkAssetSalesTab.tsx)
// ---------------------------------------------------------------------------

async function runConcurrent<T>(
  items: T[],
  concurrency: number,
  fn: (index: number, item: T) => Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  let next = 0;
  async function worker() {
    while (!signal.aborted) {
      const i = next++;
      if (i >= items.length) return;
      await fn(i, items[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: AddressRowStatus }) {
  if (status === "pending")
    return <span className="text-xs text-muted-foreground">Pending</span>;
  if (status === "loading")
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading…
      </span>
    );
  if (status === "done")
    return (
      <span className="text-xs text-green-600 dark:text-green-400">Done</span>
    );
  if (status === "unfunded")
    return (
      <span className="text-xs text-yellow-600 dark:text-yellow-400">
        Unfunded
      </span>
    );
  return <span className="text-xs text-destructive">Error</span>;
}

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

export function AddressBalancesPanel() {
  const { settings } = useSettings();
  const [addressesText, setAddressesText] = useState("");
  const [rows, setRows] = useState<AddressRow[]>([]);
  const [running, setRunning] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [interrupted, setInterrupted] = useState(false);
  const [minUsdFilter, setMinUsdFilter] = useState<number | null>(null);
  const [lockedFilter, setLockedFilter] = useState<"all" | "locked" | "unlocked">("all");
  const [sortOrder, setSortOrder] = useState<"none" | "desc" | "asc">("none");
  const abortRef = useRef<AbortController | null>(null);
  const scanState = useBulkScanState<AddressRow>(SCAN_KEY);
  const { price: xlmUsdPrice, ensure: ensureXlmUsdPrice } = useXlmUsdPrice();
  const { upsert: upsertSearch } = useSavedSearches();
  const searchParams = useSearchParams();

  useEffect(() => {
    ensureXlmUsdPrice();
  }, [ensureXlmUsdPrice]);

  useEffect(() => {
    const fromHistory = searchParams.get("addresses");
    if (fromHistory) {
      setAddressesText(fromHistory.split(",").join("\n"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Abort any in-flight scan on unmount — without this, navigating away
  // mid-scan leaves the worker pool running invisibly in the background
  // (no UI to cancel it), which then compounds with whatever scan-heavy
  // module the user opens next.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    scanState.load().then((persisted) => {
      if (cancelled || !persisted || persisted.rows.length === 0) return;
      const wasInterrupted = persisted.rows.some(
        (r) => r.status === "pending" || r.status === "loading",
      );
      const restored = persisted.rows.map((r) =>
        r.status === "pending" || r.status === "loading"
          ? { ...r, status: "error" as AddressRowStatus, error: "Scan was interrupted (page refresh)." }
          : r,
      );
      setRows(restored);
      setInterrupted(wasInterrupted);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateRow = (index: number, patch: Partial<AddressRow>) => {
    setRows((prev) => {
      const next = prev.map((r, i) => (i === index ? { ...r, ...patch } : r));
      scanState.save(next);
      return next;
    });
  };

  const fetchRowInto = async (index: number, address: string, horizonUrl: string, signal: AbortSignal) => {
    updateRow(index, { status: "loading" });
    const result = await fetchAddressBalance(horizonUrl, address, signal);
    if (signal.aborted) return;
    if (result.status === "ok") {
      updateRow(index, {
        status: "done",
        total: result.total,
        available: result.available,
        locked: result.locked,
        lockReason: result.lockReason,
      });
    } else if (result.status === "unfunded") {
      updateRow(index, { status: "unfunded" });
    } else {
      updateRow(index, { status: "error", error: "Failed to fetch balance." });
    }
  };

  const handleRun = async () => {
    const addresses = parseAddresses(addressesText);
    if (addresses.length === 0) {
      setParseError("No valid Stellar addresses found. Enter one per line.");
      return;
    }
    const totalLines = addressesText.split("\n").filter((l) => l.trim().length > 0).length;
    setParseError(
      addresses.length < totalLines
        ? `${totalLines - addresses.length} line(s) skipped (invalid or duplicate).`
        : null,
    );
    setInterrupted(false);
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    upsertSearch({
      type: "address-balances",
      value: addresses.join(","),
      label: `${addresses.length} address${addresses.length === 1 ? "" : "es"}`,
      network: settings.network,
      accountsFound: addresses.length,
    });

    const initial: AddressRow[] = addresses.map((address) => ({
      address,
      status: "pending",
    }));
    setRows(initial);
    scanState.saveImmediate(initial, false);
    setRunning(true);

    const horizonUrl = resolveHorizonUrl(settings);

    await runConcurrent(
      addresses,
      CONCURRENCY,
      (i, address) => fetchRowInto(i, address, horizonUrl, signal),
      signal,
    );

    setRunning(false);
    setRows((currentRows) => {
      scanState.saveImmediate(currentRows, false);
      return currentRows;
    });
  };

  // Re-fetches every currently listed address without re-parsing the
  // textarea — same rows, fresh balance/locked status.
  const handleRecheckAll = async () => {
    if (rows.length === 0 || running) return;
    setInterrupted(false);
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    const addresses = rows.map((r) => r.address);
    setRunning(true);
    const horizonUrl = resolveHorizonUrl(settings);

    await runConcurrent(
      addresses,
      CONCURRENCY,
      (i, address) => fetchRowInto(i, address, horizonUrl, signal),
      signal,
    );

    setRunning(false);
    setRows((currentRows) => {
      scanState.saveImmediate(currentRows, false);
      return currentRows;
    });
  };

  // Re-fetches a single row in place — handy after resolving a locked
  // account or if you suspect its balance just changed.
  const handleRecheckRow = async (address: string) => {
    if (running) return;
    const index = rows.findIndex((r) => r.address === address);
    if (index === -1) return;
    const horizonUrl = resolveHorizonUrl(settings);
    await fetchRowInto(index, address, horizonUrl, new AbortController().signal);
    setRows((currentRows) => {
      scanState.saveImmediate(currentRows, false);
      return currentRows;
    });
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    setRunning(false);
    setRows((prev) => {
      const next = prev.map((r) =>
        r.status === "pending" || r.status === "loading"
          ? { ...r, status: "error" as AddressRowStatus, error: "Cancelled." }
          : r,
      );
      scanState.saveImmediate(next, false);
      return next;
    });
  };

  const handleClear = () => {
    abortRef.current?.abort();
    setRunning(false);
    setRows([]);
    setInterrupted(false);
    scanState.clear();
  };

  const doneCount = rows.filter((r) => r.status === "done" || r.status === "unfunded").length;
  const errorCount = rows.filter((r) => r.status === "error").length;
  const pendingCount = rows.filter((r) => r.status === "pending" || r.status === "loading").length;

  const filteredRows = rows
    .filter((r) => {
      if (lockedFilter === "all") return true;
      if (r.status !== "done") return false;
      return lockedFilter === "locked" ? !!r.locked : !r.locked;
    })
    .filter((r) =>
      minUsdFilter === null || xlmUsdPrice === null
        ? true
        : r.status === "done" && r.total !== undefined && r.total * xlmUsdPrice >= minUsdFilter,
    );

  const totalBalance = filteredRows.reduce(
    (sum, r) => sum + (r.status === "done" && r.total !== undefined ? r.total : 0),
    0,
  );
  const totalAvailable = filteredRows.reduce(
    (sum, r) => sum + (r.status === "done" && r.available !== undefined ? r.available : 0),
    0,
  );
  const filteredDoneCount = filteredRows.filter(
    (r) => r.status === "done" || r.status === "unfunded",
  ).length;

  const sortedRows =
    sortOrder === "none"
      ? filteredRows
      : [...filteredRows].sort((a, b) => {
          const av = a.status === "done" && a.total !== undefined ? a.total : -1;
          const bv = b.status === "done" && b.total !== undefined ? b.total : -1;
          return sortOrder === "desc" ? bv - av : av - bv;
        });

  // Watchdog: if running but all rows reached a terminal state, stop the spinner.
  useEffect(() => {
    if (running && rows.length > 0 && pendingCount === 0) {
      abortRef.current?.abort();
      setRunning(false);
    }
  }, [running, rows.length, pendingCount]);

  return (
    <div className="space-y-6">
      {interrupted && (
        <div className="flex items-start gap-3 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" />
          <div className="flex-1 text-sm">
            <p className="font-medium text-yellow-700 dark:text-yellow-400">
              Previous scan was interrupted
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              The page was refreshed while a scan was running. Completed results
              are shown below. Start a new scan or clear to reset.
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={() => setInterrupted(false)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            Address List
          </CardTitle>
          <CardDescription>
            One Stellar address (<code className="text-xs">G...</code>) per line.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="addresses-input">Addresses</Label>
            <textarea
              id="addresses-input"
              className="w-full min-h-36 rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono"
              placeholder={"GABC...\nGDEF...\nGHIJ..."}
              value={addressesText}
              onChange={(e) => {
                setAddressesText(e.target.value);
                setParseError(null);
              }}
              disabled={running}
            />
            {parseError && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                {parseError}
              </p>
            )}
          </div>
        </CardContent>
        <CardFooter className="flex gap-2 flex-wrap">
          <Button onClick={handleRun} disabled={running}>
            {running ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Search className="mr-2 h-4 w-4" />
            )}
            Check Balances
          </Button>
          <Button variant="outline" onClick={handleCancel} disabled={!running}>
            <X className="mr-2 h-4 w-4" />
            Cancel
          </Button>
          {rows.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleRecheckAll}
              disabled={running}
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Recheck All
            </Button>
          )}
          {rows.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClear}
              disabled={running}
              className="text-muted-foreground"
            >
              <X className="mr-1.5 h-3.5 w-3.5" />
              Clear
            </Button>
          )}
          {rows.length > 0 && !running && (
            <span className="text-xs text-muted-foreground ml-auto self-center">
              {doneCount} done · {errorCount} failed
              {pendingCount > 0 && ` · ${pendingCount} pending`}
            </span>
          )}
        </CardFooter>
      </Card>

      {running && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
          <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
          <div className="flex-1 text-sm">
            <p className="font-medium">
              {pendingCount === 0
                ? "Finalising…"
                : `Checking ${Math.min(doneCount + errorCount + 1, rows.length)} of ${rows.length}…`}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {doneCount} done · {errorCount} failed · results are saved
              automatically if you navigate away
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleCancel}>
            <X className="mr-1.5 h-3.5 w-3.5" />
            Stop
          </Button>
        </div>
      )}

      {doneCount > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">Filter:</span>
          <Button
            variant={minUsdFilter === null ? "default" : "outline"}
            size="sm"
            onClick={() => setMinUsdFilter(null)}
          >
            All
          </Button>
          {MIN_USD_OPTIONS.map((amount) => (
            <Button
              key={amount}
              variant={minUsdFilter === amount ? "default" : "outline"}
              size="sm"
              disabled={xlmUsdPrice === null}
              onClick={() => setMinUsdFilter(amount)}
            >
              ≥ ${amount}
            </Button>
          ))}
          {xlmUsdPrice === null && (
            <span className="text-xs text-muted-foreground">
              (loading USD price…)
            </span>
          )}
          <span className="text-xs text-muted-foreground ml-4">Locked:</span>
          <Button
            variant={lockedFilter === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setLockedFilter("all")}
          >
            All
          </Button>
          <Button
            variant={lockedFilter === "locked" ? "default" : "outline"}
            size="sm"
            onClick={() => setLockedFilter(lockedFilter === "locked" ? "all" : "locked")}
          >
            Locked only
          </Button>
          <Button
            variant={lockedFilter === "unlocked" ? "default" : "outline"}
            size="sm"
            onClick={() => setLockedFilter(lockedFilter === "unlocked" ? "all" : "unlocked")}
          >
            Hide locked
          </Button>
          <span className="text-xs text-muted-foreground ml-4">Sort:</span>
          <Button
            variant={sortOrder === "desc" ? "default" : "outline"}
            size="sm"
            onClick={() => setSortOrder(sortOrder === "desc" ? "none" : "desc")}
          >
            High → Low
          </Button>
          <Button
            variant={sortOrder === "asc" ? "default" : "outline"}
            size="sm"
            onClick={() => setSortOrder(sortOrder === "asc" ? "none" : "asc")}
          >
            Low → High
          </Button>
        </div>
      )}

      {rows.length > 0 && (
        <Card className="overflow-x-auto">
          <Table className="min-w-[720px]">
            <TableHeader>
              <TableRow>
                <TableHead>Address</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Balance (XLM)</TableHead>
                <TableHead className="text-right">Balance (USD)</TableHead>
                <TableHead className="text-right">Available (XLM)</TableHead>
                <TableHead className="text-right">Available (USD)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRows.map((row) => (
                <TableRow key={row.address}>
                  <TableCell>
                    <ShortAddress address={row.address} network={settings.network} />
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5">
                      <StatusBadge status={row.status} />
                      {(row.status === "done" || row.status === "unfunded" || row.status === "error") && (
                        <button
                          type="button"
                          onClick={() => handleRecheckRow(row.address)}
                          disabled={running}
                          title="Recheck this address"
                          className="text-muted-foreground/50 hover:text-foreground transition-colors disabled:opacity-30"
                        >
                          <RefreshCw className="h-3 w-3" />
                        </button>
                      )}
                    </span>
                    {row.status === "error" && row.error && (
                      <p className="text-xs text-destructive mt-1">{row.error}</p>
                    )}
                    {row.status === "done" && row.locked && (
                      <p
                        className="text-xs text-destructive mt-1 flex items-center gap-1"
                        title={row.lockReason ?? undefined}
                      >
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        Locked
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {row.status === "done" && row.total !== undefined
                      ? formatXlm(row.total)
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm text-muted-foreground">
                    {row.status === "done" && row.total !== undefined && xlmUsdPrice !== null
                      ? formatUsd(row.total, xlmUsdPrice)
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {row.status === "done" && row.available !== undefined
                      ? formatXlm(row.available)
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm text-muted-foreground">
                    {row.status === "done" && row.available !== undefined && xlmUsdPrice !== null
                      ? formatUsd(row.available, xlmUsdPrice)
                      : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            {filteredDoneCount > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={2}>Total ({filteredDoneCount})</TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {formatXlm(totalBalance)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {xlmUsdPrice !== null ? formatUsd(totalBalance, xlmUsdPrice) : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {formatXlm(totalAvailable)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {xlmUsdPrice !== null ? formatUsd(totalAvailable, xlmUsdPrice) : "—"}
                  </TableCell>
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </Card>
      )}
    </div>
  );
}
