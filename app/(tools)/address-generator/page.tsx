"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useSyncExternalStore,
} from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Play,
  Square,
  Trash2,
  Copy,
  Check,
  CheckCircle2,
  AlertTriangle,
  Eye,
  ShieldAlert,
  X,
  ClipboardCheck,
  Trash,
  Cpu,
  QrCode,
  Loader2,
  Droplets,
  AlertCircle,
  History,
  DatabaseZap,
} from "lucide-react";
import { useSettings } from "@/lib/settings";
import QRCodeLib from "qrcode";
import { toast } from "sonner";

type MatchType = "starts" | "ends" | "contains" | "starts_and_ends";

interface FoundKey {
  publicKey: string;
  secret: string;
  attempts: number;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Address Generation History — localStorage persistence
// Stores found keypairs (including secret) locally so they survive page reloads.
// ---------------------------------------------------------------------------

interface HistoryEntry {
  publicKey: string;
  secret: string;
  pattern: string;
  attempts: number;
  timestamp: number;
}

const HISTORY_KEY = "stellar-toolkit-address-pattern-history";
const LEGACY_HISTORY_KEY = "stellar-toolkit-vanity-history";
const HISTORY_EVENT = "stellar-toolkit-address-pattern-history-changed";

function parseHistory(raw: string | null): HistoryEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function saveHistory(entries: HistoryEntry[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
    localStorage.removeItem(LEGACY_HISTORY_KEY);
  } catch {
    // Quota exceeded — silently continue.
  }
}

let historyCachedRaw: string | null | undefined = undefined;
let historyCachedSnapshot: HistoryEntry[] = [];

function historyGetSnapshot(): HistoryEntry[] {
  const raw = localStorage.getItem(HISTORY_KEY);
  const legacyRaw = raw ? null : localStorage.getItem(LEGACY_HISTORY_KEY);
  const resolvedRaw = raw ?? legacyRaw;

  if (resolvedRaw === historyCachedRaw) return historyCachedSnapshot;

  historyCachedRaw = resolvedRaw;
  historyCachedSnapshot = parseHistory(resolvedRaw);

  if (!raw && legacyRaw) {
    saveHistory(historyCachedSnapshot);
    historyCachedRaw = localStorage.getItem(HISTORY_KEY);
  }

  return historyCachedSnapshot;
}

function historyGetServerSnapshot(): HistoryEntry[] {
  return [];
}

function historySubscribe(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  window.addEventListener(HISTORY_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(HISTORY_EVENT, callback);
  };
}

function useAddressPatternHistory() {
  const history = useSyncExternalStore(
    historySubscribe,
    historyGetSnapshot,
    historyGetServerSnapshot,
  );

  const setHistory = useCallback((next: HistoryEntry[]) => {
    saveHistory(next);
    historyCachedRaw = undefined;
    window.dispatchEvent(new Event(HISTORY_EVENT));
  }, []);

  const addEntry = useCallback(
    (entry: HistoryEntry) => {
      const current = historyGetSnapshot();
      // Deduplicate by public key
      if (current.some((e) => e.publicKey === entry.publicKey)) return;
      setHistory([entry, ...current]);
    },
    [setHistory],
  );

  const removeEntry = useCallback(
    (publicKey: string) => {
      setHistory(historyGetSnapshot().filter((e) => e.publicKey !== publicKey));
    },
    [setHistory],
  );

  const clearAll = useCallback(() => {
    setHistory([]);
  }, [setHistory]);

  return { history, addEntry, removeEntry, clearAll };
}

// ---------------------------------------------------------------------------
// Secret Key Modal
// Renders the secret key ONLY while this modal is mounted.
// Provides clipboard copy with a 30-second auto-clear countdown.
// ---------------------------------------------------------------------------
const CLIPBOARD_TTL = 30; // seconds

function SecretKeyModal({
  secret,
  onClose,
  onDiscard,
}: {
  secret: string;
  onClose: () => void;
  onDiscard: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clear clipboard and timer on unmount no matter how the modal closes
  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
      navigator.clipboard.writeText("").catch(() => {});
    };
  }, []);

  const handleCopy = () => {
    navigator.clipboard
      .writeText(secret)
      .then(() => {
        setCopied(true);
        setCountdown(CLIPBOARD_TTL);
        toast.success("Copied to clipboard");

        if (countdownRef.current) clearInterval(countdownRef.current);
        countdownRef.current = setInterval(() => {
          setCountdown((prev) => {
            if (prev === null || prev <= 1) {
              clearInterval(countdownRef.current!);
              countdownRef.current = null;
              navigator.clipboard.writeText("").catch(() => {});
              setCopied(false);
              return null;
            }
            return prev - 1;
          });
        }, 1000);
      })
      .catch(() => {
        toast.error("Clipboard access was denied");
      });
  };

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    // Backdrop — click outside to close
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg rounded-xl border border-yellow-500/40 bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border p-4">
          <div className="flex items-center gap-2 text-yellow-500">
            <ShieldAlert className="h-5 w-5" />
            <span className="font-semibold">Secret Key — Handle With Care</span>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Security checklist */}
        <div className="px-4 pt-4 pb-2 space-y-1 text-xs text-muted-foreground">
          <p className="font-medium text-foreground mb-2">
            Before copying, confirm:
          </p>
          {[
            "You are on a private, trusted network",
            "Your screen is not visible to others or cameras",
            "You have a password manager or secure storage ready",
            "You will never share this key with anyone",
          ].map((item) => (
            <div key={item} className="flex items-start gap-2">
              <AlertTriangle className="h-3 w-3 mt-0.5 text-yellow-500 shrink-0" />
              <span>{item}</span>
            </div>
          ))}
        </div>

        {/* The key itself */}
        <div className="px-4 py-3">
          <Label className="text-xs text-muted-foreground uppercase">
            Secret Key
          </Label>
          <code className="mt-1 block w-full rounded-md border border-border bg-muted p-3 text-xs font-mono break-all leading-relaxed select-all">
            {secret}
          </code>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 px-4 pb-4">
          <Button
            onClick={handleCopy}
            variant={copied ? "outline" : "default"}
            className="w-full"
          >
            {copied ? (
              <>
                <ClipboardCheck className="mr-2 h-4 w-4 text-green-500" />
                Copied — clipboard clears in {countdown ?? CLIPBOARD_TTL}s
              </>
            ) : (
              <>
                <Copy className="mr-2 h-4 w-4" />
                Copy to Clipboard
              </>
            )}
          </Button>

          <Button onClick={onDiscard} variant="destructive" className="w-full">
            <Trash className="mr-2 h-4 w-4" />
            Done — Discard Key From Memory
          </Button>

          <p className="text-center text-xs text-muted-foreground pt-1">
            Closing this modal removes the key from the page. The clipboard is
            cleared automatically when the countdown ends or when you discard
            the key.
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vanity pattern validation
// Stellar addresses are base32-encoded (RFC 4648): valid chars are A-Z and 2-7.
// Case-insensitive mode uppercases before matching, so lowercase input is fine
// to type but we normalize to uppercase immediately.
// ---------------------------------------------------------------------------
const STELLAR_BASE32_RE = /^[A-Z2-7]+$/;

function validatePattern(value: string): string | null {
  if (!value) return null; // empty is handled by the disabled button
  if (!STELLAR_BASE32_RE.test(value)) {
    const invalid = [...new Set(value.replace(/[A-Z2-7]/g, ""))].join(" ");
    return `Invalid character(s): ${invalid} — Stellar addresses only contain A–Z and 2–7.`;
  }
  return null;
}

function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

// ---------------------------------------------------------------------------
// QR code image — renders on mount, no external network requests
// ---------------------------------------------------------------------------
function QRImg({ value }: { value: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCodeLib.toDataURL(value, {
      width: 200,
      margin: 2,
      color: { dark: "#ffffff", light: "#00000000" },
    })
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [value]);

  if (!src)
    return (
      <div className="h-[200px] w-[200px] animate-pulse bg-muted rounded" />
    );
  // alt intentionally empty — the address is already visible as text above
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" width={200} height={200} className="rounded" />;
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function AddressPatternGeneratorPage() {
  const { settings } = useSettings();
  const { history, addEntry, removeEntry, clearAll } =
    useAddressPatternHistory();

  const [pattern, setPattern] = useState("");
  const [patternError, setPatternError] = useState<string | null>(null);
  const [matchType, setMatchType] = useState<MatchType>("starts");
  const [advancedMode, setAdvancedMode] = useState(false);
  const [suffixPattern, setSuffixPattern] = useState("");
  const [suffixError, setSuffixError] = useState<string | null>(null);
  const [maxAttempts, setMaxAttempts] = useState(200000);
  const [targetCount, setTargetCount] = useState(1);
  const [isRunning, setIsRunning] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [foundKeys, setFoundKeys] = useState<FoundKey[]>([]);
  const [status, setStatus] = useState<
    "idle" | "running" | "found" | "limit_reached" | "stopped"
  >("idle");
  const [revealIdx, setRevealIdx] = useState<number | null>(null);
  const [copiedPubIdx, setCopiedPubIdx] = useState<number | null>(null);
  const [showQrIdx, setShowQrIdx] = useState<number | null>(null);
  const [friendbotStatuses, setFriendbotStatuses] = useState<
    Record<number, "idle" | "loading" | "ok" | "error">
  >({});
  // History panel state
  const [historyRevealKey, setHistoryRevealKey] = useState<string | null>(null);
  const [historyCopiedKey, setHistoryCopiedKey] = useState<string | null>(null);

  const workersRef = useRef<Worker[]>([]);
  const startTimeRef = useRef<number>(0);
  const patternRef = useRef<string>("");
  // Refs to safely track multi-match progress across worker closures without
  // hitting React stale-state issues.
  const foundCountRef = useRef<number>(0);
  const targetCountRef = useRef<number>(1);
  const seenPublicKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    return () => {
      workersRef.current.forEach((w) => w.terminate());
    };
  }, []);

  const handlePatternChange = (value: string) => {
    const upper = value.toUpperCase();
    setPattern(upper);
    setPatternError(validatePattern(upper));
  };

  const handleSuffixChange = (value: string) => {
    const upper = value.toUpperCase();
    setSuffixPattern(upper);
    setSuffixError(validatePattern(upper));
  };

  const handleStart = () => {
    if (advancedMode) {
      if ((!pattern && !suffixPattern) || patternError || suffixError) return;
    } else {
      if (!pattern || patternError) return;
    }

    // Terminate any previous run.
    workersRef.current.forEach((w) => w.terminate());
    workersRef.current = [];

    // Capture current pattern for history labelling.
    patternRef.current = advancedMode
      ? [pattern, suffixPattern].filter(Boolean).join("…")
      : pattern;

    // Clamp targetCount to a sane range.
    const resolvedTarget = Math.max(1, Math.floor(targetCount) || 1);
    targetCountRef.current = resolvedTarget;
    foundCountRef.current = 0;
    seenPublicKeysRef.current = new Set();

    setAttempts(0);
    setSpeed(0);
    setStatus("running");
    setIsRunning(true);
    setFoundKeys([]);
    startTimeRef.current = Date.now();

    const configuredThreads = Math.max(
      1,
      Math.floor(settings.workerThreads || 1),
    );
    const hardwareThreads =
      typeof navigator !== "undefined" && navigator.hardwareConcurrency > 0
        ? navigator.hardwareConcurrency
        : configuredThreads;
    const threadCount = Math.min(configuredThreads, hardwareThreads);
    // Each worker searches independently. Divide the attempt budget evenly.
    const attemptsPerWorker = Math.ceil(maxAttempts / threadCount);

    // Shared mutable state across worker closures (not React state — intentional).
    const workerAttempts = new Array<number>(threadCount).fill(0);
    let finished = false;
    let exhaustedCount = 0;

    const stopAll = () => {
      finished = true;
      workersRef.current.forEach((w) => w.terminate());
      workersRef.current = [];
    };

    for (let i = 0; i < threadCount; i++) {
      const worker = new Worker(
        new URL("./address-pattern.worker.ts", import.meta.url),
      );
      workersRef.current.push(worker);

      worker.onmessage = (e) => {
        if (finished) return;
        const { type, attempts: wa, key, message } = e.data;

        if (type === "progress") {
          workerAttempts[i] = wa;
          const total = workerAttempts.reduce((a, b) => a + b, 0);
          setAttempts(total);
          const elapsed = (Date.now() - startTimeRef.current) / 1000;
          if (elapsed > 0) setSpeed(Math.round(total / elapsed));
        } else if (type === "found") {
          // Deduplicate across workers (practically rare but possible).
          if (seenPublicKeysRef.current.has(key.publicKey)) return;
          seenPublicKeysRef.current.add(key.publicKey);

          workerAttempts[i] = wa;
          const total = workerAttempts.reduce((a, b) => a + b, 0);
          foundCountRef.current += 1;

          const foundEntry: FoundKey = {
            ...key,
            attempts: total,
            timestamp: Date.now(),
          };
          setFoundKeys((prev) => [...prev, foundEntry]);
          addEntry({
            publicKey: key.publicKey,
            secret: key.secret,
            pattern: patternRef.current,
            attempts: total,
            timestamp: foundEntry.timestamp,
          });
          setAttempts(total);

          // Fire browser notification for each match.
          if (settings.notifications && Notification.permission === "granted") {
            new Notification(
              `Address match found! (${foundCountRef.current}/${targetCountRef.current})`,
              { body: `Public key: ${key.publicKey}`, icon: "/favicon.ico" },
            );
          }

          // Stop once the target is reached.
          if (foundCountRef.current >= targetCountRef.current) {
            stopAll();
            setStatus("found");
            setIsRunning(false);
          }
        } else if (type === "limit_reached") {
          workerAttempts[i] = wa;
          exhaustedCount++;
          if (exhaustedCount === threadCount) {
            stopAll();
            const total = workerAttempts.reduce((a, b) => a + b, 0);
            // If we found some but not all, still surface what we got.
            setStatus(foundCountRef.current > 0 ? "found" : "limit_reached");
            setIsRunning(false);
            setAttempts(total);
          }
        } else if (type === "error") {
          stopAll();
          setStatus("stopped");
          setIsRunning(false);
          toast.error(message || "Address generation worker failed");
        }
      };

      worker.postMessage({
        pattern,
        matchType: advancedMode ? ("starts_and_ends" as const) : matchType,
        maxAttempts: attemptsPerWorker,
        ...(advancedMode && { suffixPattern }),
      });
    }
  };

  const handleStop = () => {
    workersRef.current.forEach((w) => w.terminate());
    workersRef.current = [];
    setIsRunning(false);
    setStatus("stopped");
  };

  const handleClear = () => {
    setFoundKeys([]);
    setAttempts(0);
    setSpeed(0);
    setStatus("idle");
    setPattern("");
    setPatternError(null);
    setSuffixPattern("");
    setSuffixError(null);
    setRevealIdx(null);
  };

  const handleDiscard = (idx: number) => {
    setRevealIdx(null);
    setFoundKeys((prev) => prev.filter((_, i) => i !== idx));
  };

  const copyPublicKey = (pub: string, idx: number) => {
    navigator.clipboard
      .writeText(pub)
      .then(() => {
        setCopiedPubIdx(idx);
        toast.success("Copied to clipboard");
        setTimeout(
          () => setCopiedPubIdx((prev) => (prev === idx ? null : prev)),
          2000,
        );
      })
      .catch(() => {
        toast.error("Clipboard access was denied");
      });
  };

  const configuredThreads = Math.max(
    1,
    Math.floor(settings.workerThreads || 1),
  );
  const hardwareThreads =
    typeof navigator !== "undefined" && navigator.hardwareConcurrency > 0
      ? navigator.hardwareConcurrency
      : configuredThreads;
  const effectiveThreads = Math.min(configuredThreads, hardwareThreads);

  const prefixLen = pattern.length;
  const suffixLen = advancedMode ? suffixPattern.length : 0;
  const totalLen = advancedMode
    ? prefixLen + suffixLen
    : matchType === "contains"
      ? Math.max(prefixLen - 1, 0)
      : prefixLen;
  const difficulty = totalLen > 0 ? Math.pow(32, totalLen) : 0;
  const estimatedKeysPerSecond =
    speed > 0 ? speed : Math.max(1, effectiveThreads * 25000);
  const etaPerMatchSeconds =
    difficulty > 0 ? difficulty / estimatedKeysPerSecond : 0;
  const budgetPerTarget = maxAttempts / Math.max(1, targetCount);

  const warnings: string[] = [];
  if (
    (advancedMode && pattern && !pattern.startsWith("G")) ||
    (!advancedMode &&
      matchType === "starts" &&
      pattern &&
      !pattern.startsWith("G"))
  ) {
    warnings.push(
      "Prefix searches should start with G. Stellar public keys always begin with G.",
    );
  }
  if (difficulty > 0 && budgetPerTarget < difficulty * 0.25) {
    warnings.push(
      "Max attempts is very low for this pattern difficulty; a match is unlikely within the current budget.",
    );
  }
  if (configuredThreads > hardwareThreads) {
    warnings.push(
      `Configured threads (${configuredThreads}) exceed available logical cores (${hardwareThreads}); effective workers are capped.`,
    );
  }
  if (advancedMode && !pattern && !suffixPattern) {
    warnings.push(
      "Advanced mode needs at least a prefix or suffix pattern to search.",
    );
  }
  if (!advancedMode && matchType === "contains" && pattern.length === 1) {
    warnings.push(
      "Single-character contains search is very broad and may return many trivial matches.",
    );
  }

  const handleFriendbot = async (publicKey: string, idx: number) => {
    setFriendbotStatuses((prev) => ({ ...prev, [idx]: "loading" }));
    try {
      const base =
        settings.network === "futurenet"
          ? "https://friendbot-futurenet.stellar.org"
          : "https://friendbot.stellar.org";
      const res = await fetch(`${base}?addr=${encodeURIComponent(publicKey)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setFriendbotStatuses((prev) => ({ ...prev, [idx]: "ok" }));
    } catch {
      setFriendbotStatuses((prev) => ({ ...prev, [idx]: "error" }));
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Address Generator</h1>
        <p className="text-muted-foreground mt-2">
          Generate vanity Stellar keypairs — find addresses that start with, end with, or contain a custom pattern. Uses parallel Web Workers for speed.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Configuration Panel */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Configuration</CardTitle>
            <CardDescription>
              Set your desired pattern and parameters.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Advanced mode toggle */}
            <div className="flex items-center justify-end">
              <button
                onClick={() => setAdvancedMode(!advancedMode)}
                disabled={isRunning}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                {advancedMode
                  ? "Simple Search"
                  : "Advanced Search (prefix + suffix)"}
              </button>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pattern">
                {advancedMode ? "Starts with" : "Desired Pattern"}
              </Label>
              <Input
                id="pattern"
                placeholder="e.g. GMOON"
                value={pattern}
                onChange={(e) => handlePatternChange(e.target.value)}
                disabled={isRunning}
                className="font-mono"
                aria-invalid={!!patternError}
                aria-describedby={
                  patternError ? "pattern-error" : "pattern-hint"
                }
              />
              {patternError ? (
                <p
                  id="pattern-error"
                  className="text-xs text-destructive flex items-center gap-1"
                >
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  {patternError}
                </p>
              ) : (
                <p id="pattern-hint" className="text-xs text-muted-foreground">
                  Valid characters: A–Z and 2–7. All Stellar addresses start
                  with G.
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {advancedMode ? (
                <div className="space-y-2">
                  <Label htmlFor="suffix-pattern">Ends with</Label>
                  <Input
                    id="suffix-pattern"
                    placeholder="e.g. XLM"
                    value={suffixPattern}
                    onChange={(e) => handleSuffixChange(e.target.value)}
                    disabled={isRunning}
                    className="font-mono"
                    aria-invalid={!!suffixError}
                  />
                  {suffixError && (
                    <p className="text-xs text-destructive flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      {suffixError}
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>Match Type</Label>
                  <Select
                    value={matchType}
                    onValueChange={(v: MatchType) => setMatchType(v)}
                    disabled={isRunning}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="starts">Starts with</SelectItem>
                      <SelectItem value="ends">Ends with</SelectItem>
                      <SelectItem value="contains">Contains</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="rounded-md border p-3 text-xs text-muted-foreground">
                Matching is normalized to uppercase. Stellar public keys use
                uppercase base32 characters.
              </div>
            </div>

            {warnings.length > 0 && (
              <div className="rounded-md border border-yellow-500/40 bg-yellow-500/5 p-3 space-y-1.5">
                <div className="text-xs font-medium text-yellow-500 flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Search Warnings
                </div>
                <ul className="text-xs text-muted-foreground space-y-1">
                  {warnings.map((warning) => (
                    <li key={warning}>• {warning}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Difficulty estimate */}
            {totalLen > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  Estimated difficulty: ~1 in{" "}
                  <span className="font-mono font-semibold">
                    {difficulty.toLocaleString()}
                  </span>{" "}
                  keys
                </p>
                <p className="text-xs text-muted-foreground">
                  Estimated time per match at current speed: ~
                  <span className="font-mono font-semibold">
                    {" "}
                    {formatEta(etaPerMatchSeconds)}
                  </span>
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="max-attempts">Max Attempts</Label>
                <Input
                  id="max-attempts"
                  type="number"
                  min={1}
                  value={maxAttempts}
                  onChange={(e) =>
                    setMaxAttempts(Math.max(1, parseInt(e.target.value) || 1))
                  }
                  disabled={isRunning}
                />
                <p className="text-xs text-muted-foreground">
                  Search budget shared across all threads.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="target-count">Count (addresses to find)</Label>
                <Input
                  id="target-count"
                  type="number"
                  min={1}
                  max={100}
                  value={targetCount}
                  onChange={(e) =>
                    setTargetCount(Math.max(1, parseInt(e.target.value) || 1))
                  }
                  disabled={isRunning}
                />
                <p className="text-xs text-muted-foreground">
                  Auto-stops when this many matches are found. Default: 1.
                </p>
              </div>
            </div>

            <div className="flex gap-4 pt-4">
              {!isRunning ? (
                <Button
                  onClick={handleStart}
                  className="flex-1"
                  disabled={
                    advancedMode
                      ? (!pattern && !suffixPattern) ||
                        !!patternError ||
                        !!suffixError
                      : !pattern || !!patternError
                  }
                >
                  <Play className="mr-2 h-4 w-4" /> Start
                </Button>
              ) : (
                <Button
                  onClick={handleStop}
                  variant="destructive"
                  className="flex-1"
                >
                  <Square className="mr-2 h-4 w-4" /> Stop
                </Button>
              )}
              <Button
                onClick={handleClear}
                variant="outline"
                disabled={isRunning}
              >
                <Trash2 className="mr-2 h-4 w-4" /> Clear
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Status Panel */}
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>Status</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 space-y-6">
            <div className="space-y-1">
              <div className="text-sm font-medium text-muted-foreground">
                Attempts
              </div>
              <div className="text-3xl font-bold font-mono">
                {attempts.toLocaleString()}
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-sm font-medium text-muted-foreground">
                Speed
              </div>
              <div className="text-2xl font-bold font-mono">
                {speed.toLocaleString()}{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  keys/sec
                </span>
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-sm font-medium text-muted-foreground">
                Found / Target
              </div>
              <div className="text-2xl font-bold font-mono">
                {foundKeys.length}
                <span className="text-sm font-normal text-muted-foreground">
                  {" "}
                  / {targetCount}
                </span>
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-sm font-medium text-muted-foreground">
                Threads
              </div>
              <div className="flex items-center gap-2">
                <Cpu className="h-4 w-4 text-muted-foreground" />
                <span className="text-2xl font-bold font-mono">
                  {effectiveThreads}
                </span>
              </div>
              {configuredThreads > effectiveThreads && (
                <p className="text-[11px] text-muted-foreground">
                  Capped from {configuredThreads} by device limits.
                </p>
              )}
            </div>

            <div className="space-y-1">
              <div className="text-sm font-medium text-muted-foreground">
                State
              </div>
              <div className="flex items-center gap-2">
                {status === "running" && (
                  <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                )}
                {status === "idle" && (
                  <div className="h-2 w-2 rounded-full bg-slate-500" />
                )}
                {status === "found" && (
                  <div className="h-2 w-2 rounded-full bg-blue-500" />
                )}
                {status === "limit_reached" && (
                  <div className="h-2 w-2 rounded-full bg-yellow-500" />
                )}
                {status === "stopped" && (
                  <div className="h-2 w-2 rounded-full bg-red-500" />
                )}
                <span className="font-medium uppercase text-sm">
                  {status.replace("_", " ")}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Results */}
      {foundKeys.length > 0 && (
        <Card className="border-green-500/50 bg-green-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-500">
              <CheckCircle2 className="h-5 w-5" />
              {foundKeys.length === 1
                ? "Match Found!"
                : `${foundKeys.length} of ${targetCount} Matches Found`}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {foundKeys.map((key, idx) => (
              <div
                key={idx}
                className="space-y-4 p-4 bg-background rounded-lg border"
              >
                {/* Public key — safe to display in DOM */}
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground uppercase">
                    Public Key
                  </Label>
                  <div className="flex gap-2">
                    <code className="flex-1 p-2 bg-muted rounded text-xs font-mono break-all">
                      {key.publicKey}
                    </code>
                    <Button
                      size="icon"
                      variant={copiedPubIdx === idx ? "secondary" : "ghost"}
                      onClick={() => copyPublicKey(key.publicKey, idx)}
                      aria-label={
                        copiedPubIdx === idx ? "Copied" : "Copy public key"
                      }
                    >
                      {copiedPubIdx === idx ? (
                        <Check className="h-4 w-4 text-green-500" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      size="icon"
                      variant={showQrIdx === idx ? "secondary" : "ghost"}
                      onClick={() =>
                        setShowQrIdx(showQrIdx === idx ? null : idx)
                      }
                      aria-label={
                        showQrIdx === idx ? "Hide QR code" : "Show QR code"
                      }
                    >
                      <QrCode className="h-4 w-4" />
                    </Button>
                  </div>
                  {showQrIdx === idx && (
                    <div className="flex justify-center pt-2">
                      <QRImg value={key.publicKey} />
                    </div>
                  )}
                </div>

                {/* Secret key — NEVER rendered as DOM text; open modal to access */}
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground uppercase">
                    Secret Key
                  </Label>
                  <div className="flex items-center gap-3 rounded-md border border-dashed border-yellow-500/40 bg-yellow-500/5 p-3">
                    <ShieldAlert className="h-4 w-4 text-yellow-500 shrink-0" />
                    <span className="flex-1 text-xs text-muted-foreground font-mono tracking-widest select-none">
                      {"S" + "•".repeat(55)}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0 border-yellow-500/40 text-yellow-600 hover:text-yellow-500"
                      onClick={() => setRevealIdx(idx)}
                    >
                      <Eye className="mr-1.5 h-3.5 w-3.5" />
                      Reveal
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Secret key is not shown on this page. Use Reveal to open a
                    secure modal.
                  </p>
                </div>

                {/* Friendbot — only visible on testnet / futurenet */}
                {(settings.network === "testnet" ||
                  settings.network === "futurenet") && (
                  <div className="flex items-center justify-between rounded-md border border-blue-500/20 bg-blue-500/5 px-3 py-2">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Droplets className="h-4 w-4 text-blue-400 shrink-0" />
                      <span>
                        Fund this address with Friendbot (
                        {settings.network === "futurenet"
                          ? "Futurenet"
                          : "Testnet"}
                        ).
                      </span>
                    </div>
                    {friendbotStatuses[idx] === "ok" ? (
                      <span className="flex items-center gap-1 text-xs text-green-500">
                        <Check className="h-3.5 w-3.5" /> Funded
                      </span>
                    ) : friendbotStatuses[idx] === "error" ? (
                      <span className="flex items-center gap-1 text-xs text-destructive">
                        <AlertCircle className="h-3.5 w-3.5" /> Failed
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0 text-xs h-7"
                        disabled={friendbotStatuses[idx] === "loading"}
                        onClick={() => handleFriendbot(key.publicKey, idx)}
                      >
                        {friendbotStatuses[idx] === "loading" ? (
                          <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                        ) : (
                          <Droplets className="mr-1.5 h-3 w-3" />
                        )}
                        Fund
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Secret key modal — mounts only when a key is being revealed */}
      {revealIdx !== null && foundKeys[revealIdx] && (
        <SecretKeyModal
          secret={foundKeys[revealIdx].secret}
          onClose={() => setRevealIdx(null)}
          onDiscard={() => handleDiscard(revealIdx)}
        />
      )}

      {/* History modal — for keys retrieved from localStorage */}
      {historyRevealKey !== null &&
        history.find((e) => e.publicKey === historyRevealKey) && (
          <SecretKeyModal
            secret={
              history.find((e) => e.publicKey === historyRevealKey)!.secret
            }
            onClose={() => setHistoryRevealKey(null)}
            onDiscard={() => {
              removeEntry(historyRevealKey);
              setHistoryRevealKey(null);
            }}
          />
        )}

      {/* Saved History */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Saved History ({history.length})
            </CardTitle>
            {history.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-destructive text-xs"
                onClick={() => {
                  clearAll();
                  toast("History cleared");
                }}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Clear All
              </Button>
            )}
          </div>
          <CardDescription>
            Found addresses are automatically saved here.{" "}
            <span className="text-yellow-500/80">
              Secrets are stored in your browser&apos;s localStorage — do not
              use this as your only backup.
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-sm text-muted-foreground">
              <DatabaseZap className="h-8 w-8 opacity-30" />
              <span>
                No addresses saved yet. Generated keys will appear here.
              </span>
            </div>
          ) : (
            <div className="space-y-3">
              {history.map((entry) => (
                <div
                  key={entry.publicKey}
                  className="flex flex-col md:flex-row md:items-center gap-3 rounded-lg border border-border p-4"
                >
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono font-semibold text-foreground">
                        {entry.pattern}
                      </span>
                      <span>·</span>
                      <span>{new Date(entry.timestamp).toLocaleString()}</span>
                      <span>·</span>
                      <span>{entry.attempts.toLocaleString()} attempts</span>
                    </div>
                    <p
                      className="font-mono text-xs text-muted-foreground truncate"
                      title={entry.publicKey}
                    >
                      {entry.publicKey}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-xs h-7 px-2"
                      onClick={() => {
                        navigator.clipboard
                          .writeText(entry.publicKey)
                          .then(() => {
                            setHistoryCopiedKey(entry.publicKey);
                            toast.success("Copied to clipboard");
                            setTimeout(
                              () =>
                                setHistoryCopiedKey((prev) =>
                                  prev === entry.publicKey ? null : prev,
                                ),
                              2000,
                            );
                          });
                      }}
                    >
                      {historyCopiedKey === entry.publicKey ? (
                        <Check className="h-3.5 w-3.5 text-green-500" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-7 border-yellow-500/40 text-yellow-600 hover:text-yellow-500"
                      onClick={() => setHistoryRevealKey(entry.publicKey)}
                    >
                      <Eye className="mr-1.5 h-3.5 w-3.5" />
                      Secret
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-xs h-7 px-2 text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        removeEntry(entry.publicKey);
                        toast("Entry removed");
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
