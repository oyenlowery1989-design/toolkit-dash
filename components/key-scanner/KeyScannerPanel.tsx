"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Play,
  Square,
  AlertTriangle,
  Zap,
  Loader2,
  ChevronDown,
  ChevronRight,
  Terminal,
  Search as SearchIcon,
} from "lucide-react";
import { useKeyScan } from "@/hooks/use-key-scan";
import { HitsTable } from "./HitsTable";
import type { KeyScanTailEntry } from "@/lib/key-scanner/types";

function StatCard({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-xl font-bold font-mono ${accent ?? ""}`}>{value}</div>
    </div>
  );
}

function formatUptime(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

const TAIL_STYLES: Record<KeyScanTailEntry["result"], string> = {
  found: "text-green-400",
  "not-found": "text-slate-400",
  error: "text-red-400",
};

function LiveTail({ tail, running }: { tail: KeyScanTailEntry[]; running: boolean }) {
  const [open, setOpen] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    userScrolledUp.current = el.scrollTop + el.clientHeight < el.scrollHeight - 20;
  };

  useEffect(() => {
    if (open && !userScrolledUp.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [tail, open]);

  return (
    <div className="rounded-md border border-border overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 bg-muted/40 hover:bg-muted/60 transition-colors text-xs font-medium text-muted-foreground"
        onClick={() => setOpen((v) => !v)}
      >
        <Terminal className="h-3.5 w-3.5" />
        Live Tail ({tail.length})
        {running && <span className="text-primary animate-pulse ml-1">●</span>}
        {open ? <ChevronDown className="h-3.5 w-3.5 ml-auto" /> : <ChevronRight className="h-3.5 w-3.5 ml-auto" />}
      </button>
      {open && (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="max-h-52 overflow-y-auto bg-black/60 px-3 py-2 space-y-0.5 font-mono text-xs"
        >
          {tail.length === 0 ? (
            <span className="text-muted-foreground">No activity yet.</span>
          ) : (
            tail.map((entry, i) => (
              <div key={`${entry.publicKey}-${i}`} className={TAIL_STYLES[entry.result]}>
                [{new Date(entry.at).toLocaleTimeString()}] {entry.publicKey} — {entry.result}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}

export function KeyScannerPanel() {
  const { state, hits, loaded, disabled, start, stop, configure, purgeHit } = useKeyScan();
  const [pacedRps, setPacedRps] = useState(5);
  const [concurrency, setConcurrency] = useState(3);
  const [resumeOnBoot, setResumeOnBoot] = useState(true);
  const [throughput, setThroughput] = useState(0);
  const prevSampleRef = useRef<{ count: number; at: number } | null>(null);
  const configDebounceRef = useRef<{ timer: ReturnType<typeof setTimeout>; patch: Record<string, unknown> } | null>(null);

  // Seed local controls from persisted server config whenever the running
  // state flips (covers first load and an auto-resume-on-boot) without
  // fighting the user's in-progress edits on every poll tick.
  useEffect(() => {
    if (!state) return;
    setPacedRps(state.pacedRps);
    setConcurrency(state.concurrency);
    setResumeOnBoot(state.resumeOnBoot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.running]);

  useEffect(() => {
    if (!state) return;
    const now = Date.now();
    if (prevSampleRef.current) {
      const dt = (now - prevSampleRef.current.at) / 1000;
      const dCount = state.totalGenerated - prevSampleRef.current.count;
      if (dt > 0.5) setThroughput(Math.max(0, dCount / dt));
    }
    prevSampleRef.current = { count: state.totalGenerated, at: now };
  }, [state?.totalGenerated]);

  const pushConfig = (patch: Record<string, unknown>) => {
    if (configDebounceRef.current) clearTimeout(configDebounceRef.current.timer);
    const merged = { ...(configDebounceRef.current?.patch ?? {}), ...patch };
    const timer = setTimeout(() => {
      configure(merged);
      configDebounceRef.current = null;
    }, 500);
    configDebounceRef.current = { timer, patch: merged };
  };

  if (!loaded) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  }

  if (disabled) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-muted-foreground text-center">
          Key Scanner requires a persistent local server process and is disabled in this deployment mode.
        </CardContent>
      </Card>
    );
  }

  const running = !!state?.running;
  const throttled = !!state?.lastError?.startsWith("Throttled");
  const uptimeSec = state?.startedAt ? Math.floor((Date.now() - state.startedAt) / 1000) : 0;

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-yellow-500/40 bg-yellow-500/5 p-3 text-xs text-muted-foreground flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" />
        <span>
          Random ed25519 keys are drawn from a ~1.1×10<sup>76</sup> keyspace against roughly 8 million funded Stellar
          accounts — a chance collision is not realistically expected on any human timescale. This demonstrates the
          mechanic; treat any real-world &quot;hit&quot; as a near-impossible event, not a strategy.
        </span>
      </div>

      {state?.autoResumed && (
        <div className="rounded-md border border-blue-500/40 bg-blue-500/5 p-3 text-xs text-blue-400 flex items-center gap-2">
          <Zap className="h-4 w-4" />
          Auto-resumed a previous run after a server restart.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 flex-wrap">
            <SearchIcon className="h-5 w-5" />
            Key Scanner
            <span
              className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${
                throttled
                  ? "bg-yellow-500/10 text-yellow-500 border-yellow-500/30"
                  : running
                    ? "bg-green-500/10 text-green-500 border-green-500/30"
                    : "bg-muted text-muted-foreground border-border"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${running ? "bg-green-500 animate-pulse" : "bg-slate-500"}`} />
              {throttled ? "Throttled" : running ? "Running" : "Stopped"}
            </span>
          </CardTitle>
          <CardDescription>Continuously generates random keypairs and checks each for an existing on-ledger balance on Public (mainnet).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Throughput" value={`${throughput.toFixed(1)}/s`} />
            <StatCard label="Generated" value={(state?.totalGenerated ?? 0).toLocaleString()} />
            <StatCard label="No balance" value={(state?.totalNotFound ?? 0).toLocaleString()} />
            <StatCard
              label="Has balance"
              value={(state?.totalFound ?? 0).toLocaleString()}
              accent={state && state.totalFound > 0 ? "text-green-500" : undefined}
            />
            <StatCard
              label="Errors"
              value={(state?.totalErrors ?? 0).toLocaleString()}
              accent={state && state.totalErrors > 0 ? "text-yellow-500" : undefined}
            />
            <StatCard label="Uptime" value={formatUptime(uptimeSec)} />
            <StatCard label="Pace" value={`${(state?.pacedRps ?? pacedRps).toString()}/s`} />
            <StatCard label="Concurrency" value={state?.concurrency ?? concurrency} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Pace (req/s)</Label>
              <Input
                type="number"
                min={0.5}
                max={10}
                step={0.5}
                value={pacedRps}
                onChange={(e) => {
                  const v = Math.max(0.5, parseFloat(e.target.value) || 0.5);
                  setPacedRps(v);
                  if (running) pushConfig({ pacedRps: v });
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>Concurrency</Label>
              <Input
                type="number"
                min={1}
                max={10}
                value={concurrency}
                onChange={(e) => {
                  const v = Math.max(1, parseInt(e.target.value, 10) || 1);
                  setConcurrency(v);
                  if (running) pushConfig({ concurrency: v });
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>Resume on boot</Label>
              <div className="flex items-center h-9 gap-2">
                <Switch
                  checked={resumeOnBoot}
                  onCheckedChange={(v) => {
                    setResumeOnBoot(v);
                    configure({ resumeOnBoot: v });
                  }}
                />
                <span className="text-xs text-muted-foreground">Auto-continue after a server restart</span>
              </div>
            </div>
          </div>

          {state?.lastError && (
            <p className="text-xs text-yellow-500 flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" />
              {state.lastError}
            </p>
          )}

          <div className="flex gap-3">
            {!running ? (
              <Button onClick={() => start({ pacedRps, concurrency, resumeOnBoot })} className="flex-1">
                <Play className="mr-2 h-4 w-4" />
                Start
              </Button>
            ) : (
              <Button onClick={() => stop()} variant="destructive" className="flex-1">
                <Square className="mr-2 h-4 w-4" />
                Stop
              </Button>
            )}
          </div>

          <LiveTail tail={state?.recentTail ?? []} running={running} />
        </CardContent>
      </Card>

      <HitsTable hits={hits} onPurge={purgeHit} />
    </div>
  );
}
