"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ChevronDown,
  ChevronRight,
  Play,
  Plus,
  Trash2,
  RefreshCw,
  Clock,
  Key,
  Eye,
  CheckCircle,
  Layers,
  History,
  Pencil,
  ExternalLink,
  PlayCircle,
  PauseCircle,
  Bell,
  Save,
  Copy,
  FlaskConical,
  GripVertical,
  Wallet,
  X,
  AlertTriangle,
} from "lucide-react";
import { Keypair } from "stellar-sdk";
import { useAutoSendGroups } from "@/hooks/use-auto-send-groups";
import { WalletSelect } from "@/components/ui/wallet-select";
import { useSettings } from "@/lib/settings";
import { shortAddr } from "@/lib/format";
import { timeAgo } from "@/lib/stellar-helpers";
import { authHeaders, waitForAuth } from "@/lib/db-client";
import type { GroupRunResult, DestinationRunResult, GroupPreview, RunLogEntry, AutoSendDestination, AutoSendGroup } from "@/lib/auto-send/types";
import type { AutoSendStats } from "@/app/api/auto-send/stats/route";

// ── Module-level result caches (persist across card collapse/expand) ─────────
const _runResults = new Map<string, GroupRunResult>();
const _testResults = new Map<string, GroupRunResult>();

// ── Notification helper ───────────────────────────────────────────────────────

function notify(title: string, body: string) {
  if (typeof window === "undefined") return;
  if (!("Notification" in window)) return;
  const send = () => new Notification(title, { body, icon: "/favicon.ico" });
  if (Notification.permission === "granted") {
    send();
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission().then((p) => { if (p === "granted") send(); });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function derivePublicKey(secretKey: string): string | null {
  try {
    return Keypair.fromSecret(secretKey.trim()).publicKey();
  } catch {
    return null;
  }
}

function intervalLabel(minutes: number | null): string {
  if (!minutes) return "Manual";
  if (minutes < 60) return `Every ${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `Every ${h}h ${m}m` : `Every ${h}h`;
}

function nextRunLabel(lastRunAt: number | undefined, intervalMinutes: number | null): string | null {
  if (!intervalMinutes) return null;
  if (!lastRunAt) return "pending";
  const nextAt = lastRunAt + intervalMinutes * 60000;
  const diff = nextAt - Date.now();
  if (diff <= 0) return "due now";
  const totalSec = Math.ceil(diff / 1000);
  if (totalSec < 120) return `next in ${totalSec}s`;
  const min = Math.ceil(diff / 60000);
  if (min < 60) return `next in ${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `next in ${h}h ${m}m` : `next in ${h}h`;
}


function expertTxUrl(network: string, txHash: string): string {
  const net = network === "testnet" ? "testnet" : network === "futurenet" ? "futurenet" : "public";
  return `https://stellar.expert/explorer/${net}/tx/${txHash}`;
}

const NETWORKS = ["public", "testnet", "futurenet"] as const;
const NETWORK_LABELS: Record<string, string> = {
  public: "Mainnet",
  testnet: "Testnet",
  futurenet: "Futurenet",
};

const INTERVAL_OPTIONS: { label: string; minutes: number | null }[] = [
  { label: "Manual", minutes: null },
  { label: "1m", minutes: 1 },
  { label: "15m", minutes: 15 },
  { label: "30m", minutes: 30 },
  { label: "1h", minutes: 60 },
  { label: "3h", minutes: 180 },
  { label: "6h", minutes: 360 },
  { label: "12h", minutes: 720 },
  { label: "24h", minutes: 1440 },
];

// ── Status chip ──────────────────────────────────────────────────────────────

function StatusChip({ result, network }: { result: DestinationRunResult; network?: string }) {
  const colors: Record<string, string> = {
    sent: "bg-green-500/20 text-green-400 border border-green-500/30",
    skipped: "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30",
    failed: "bg-red-500/20 text-red-400 border border-red-500/30",
    preview: "bg-blue-500/20 text-blue-300 border border-blue-500/30",
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono ${colors[result.status] ?? ""}`}>
      {result.status === "sent" && `+${result.amountSent?.toFixed(7)} XLM`}
      {result.status === "sent" && result.txHash && network && (
        <a href={expertTxUrl(network, result.txHash)} target="_blank" rel="noopener noreferrer" className="hover:opacity-80" title="View on Stellar.Expert">
          <ExternalLink size={10} />
        </a>
      )}
      {result.status === "skipped" && "skipped"}
      {result.status === "failed" && "failed"}
      {result.status === "preview" && `~${result.amountSent?.toFixed(7)} XLM`}
    </span>
  );
}


// ── Destination form (shared by Add + Edit) ──────────────────────────────────

function DestinationForm({
  groupId,
  initial,
  currentTotal,
  ownPercentage,
  hasExistingRemainder,
  onDone,
}: {
  groupId: string;
  initial?: AutoSendDestination;
  currentTotal: number;
  ownPercentage: number;
  hasExistingRemainder: boolean; // another destination already claims remainder
  onDone: () => void;
}) {
  const { upsertDestination } = useAutoSendGroups();
  const [destination, setDestination] = useState(initial?.destination ?? "");
  const [percentageStr, setPercentageStr] = useState(initial && !initial.isRemainder ? String(initial.percentage) : "");
  const [isRemainder, setIsRemainder] = useState(initial?.isRemainder ?? false);
  const [label, setLabel] = useState(initial?.label ?? "");
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const [minThresholdStr, setMinThresholdStr] = useState(initial?.minThreshold ? String(initial.minThreshold) : "");
  const [maxCapStr, setMaxCapStr] = useState(initial?.maxCap ? String(initial.maxCap) : "");

  const pctNum = parseFloat(percentageStr);
  const validPct = isRemainder || (!isNaN(pctNum) && pctNum > 0 && pctNum <= 100);
  const newTotal = currentTotal - ownPercentage + (!isRemainder && validPct ? pctNum : 0);
  const wouldExceed = !isRemainder && newTotal > 100;
  const canSubmit = destination.trim().length > 0 && validPct && !wouldExceed;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    const minThreshold = parseFloat(minThresholdStr);
    const maxCap = parseFloat(maxCapStr);
    upsertDestination(groupId, {
      id: initial?.id,
      destination: destination.trim(),
      percentage: isRemainder ? 0 : pctNum,
      isRemainder,
      paused: initial?.paused ?? false,
      label: label.trim() || undefined,
      memo: memo.trim() || undefined,
      minThreshold: !isNaN(minThreshold) && minThreshold > 0 ? minThreshold : 0,
      maxCap: !isNaN(maxCap) && maxCap > 0 ? maxCap : 0,
      position: initial?.position ?? 0,
    });
    onDone();
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white/5 border border-white/10 rounded-lg p-3 flex flex-col gap-2">
      <p className="text-xs text-white/50 font-medium uppercase tracking-wide">
        {initial ? "Edit Destination" : "Add Destination"}
      </p>
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          placeholder="Destination address (G…)"
          className="flex-1 bg-black/30 border border-white/10 rounded px-3 py-1.5 text-sm text-white font-mono placeholder:text-white/30 outline-none focus:border-white/30"
        />
        <WalletSelect onPick={(w) => setDestination(w.publicKey)} align="end" />
      </div>
      <div className="flex gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <input
            value={isRemainder ? "" : percentageStr}
            onChange={(e) => setPercentageStr(e.target.value)}
            placeholder="%"
            type="number"
            min={0.01}
            max={100}
            step={0.01}
            disabled={isRemainder}
            className="w-24 bg-black/30 border border-white/10 rounded px-3 py-1.5 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/30 disabled:opacity-30"
          />
          <span className="text-white/40 text-sm">% of spendable</span>
        </div>
        <label className={`flex items-center gap-1.5 select-none ${hasExistingRemainder && !isRemainder ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}>
          <input
            type="checkbox"
            checked={isRemainder}
            onChange={(e) => setIsRemainder(e.target.checked)}
            disabled={hasExistingRemainder && !isRemainder}
            className="accent-violet-500"
          />
          <span className="text-xs text-white/50">
            {hasExistingRemainder && !isRemainder ? "Remainder already set" : "Send remainder"}
          </span>
        </label>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (optional)"
          className="flex-1 min-w-[120px] bg-black/30 border border-white/10 rounded px-3 py-1.5 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/30"
        />
      </div>
      <div className="flex gap-2 flex-wrap">
        <input
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="Memo (optional, max 28 chars)"
          maxLength={28}
          className="flex-1 bg-black/30 border border-white/10 rounded px-3 py-1.5 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/30"
        />
        <div className="flex items-center gap-2">
          <input
            value={minThresholdStr}
            onChange={(e) => setMinThresholdStr(e.target.value)}
            placeholder="Min XLM"
            type="number"
            min={0}
            step={0.01}
            className="w-28 bg-black/30 border border-white/10 rounded px-3 py-1.5 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/30"
          />
          <span className="text-white/40 text-sm">min XLM</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={maxCapStr}
            onChange={(e) => setMaxCapStr(e.target.value)}
            placeholder="Max cap"
            type="number"
            min={0}
            step={0.01}
            className="w-28 bg-black/30 border border-white/10 rounded px-3 py-1.5 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/30"
          />
          <span className="text-white/40 text-sm">max XLM</span>
        </div>
      </div>
      {wouldExceed && (
        <p className="text-xs text-yellow-400 px-1">Total would be {newTotal.toFixed(1)}% -- exceeds 100%</p>
      )}
      {isRemainder && parseFloat(maxCapStr) > 0 && (
        <p className="text-xs text-yellow-400 px-1">Max cap on a remainder destination limits what &apos;REST&apos; receives -- surplus is not redistributed further.</p>
      )}
      <p className="text-xs text-white/30 px-1">Spendable = balance − "keep in wallet". % splits are calculated on the spendable amount. Min threshold skips dust payments.</p>
      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={!canSubmit}
          className="px-3 py-1.5 rounded bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-sm font-medium"
        >
          {initial ? "Save" : "Add"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="px-3 py-1.5 rounded bg-white/10 hover:bg-white/15 text-white/50 text-sm"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── Add Group form ────────────────────────────────────────────────────────────

function AddGroupForm({ onDone }: { onDone: () => void }) {
  const { createGroup } = useAutoSendGroups();
  const { settings } = useSettings();
  const [name, setName] = useState("");
  const [network, setNetwork] = useState<string>(settings.network);
  const [secretKey, setSecretKey] = useState("");
  const [intervalMinutes, setIntervalMinutes] = useState<number | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);

  const pubkey = derivePublicKey(secretKey);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      Keypair.fromSecret(secretKey.trim());
    } catch {
      setKeyError("Invalid secret key");
      return;
    }
    setKeyError(null);
    createGroup({ name: name.trim(), network, secretKey: secretKey.trim(), intervalMinutes });
    onDone();
  }

  return (
    <form onSubmit={handleSubmit} className="border border-white/10 rounded-lg p-4 bg-white/5 flex flex-col gap-3">
      <p className="text-sm font-medium text-white/70">New Auto-Send Group</p>

      <div className="flex gap-3 flex-wrap">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Group name"
          className="flex-1 min-w-[160px] bg-white/5 border border-white/10 rounded px-3 py-1.5 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/30"
        />
        <select
          value={network}
          onChange={(e) => setNetwork(e.target.value)}
          className="bg-white/5 border border-white/10 rounded px-3 py-1.5 text-sm text-white outline-none focus:border-white/30"
        >
          {NETWORKS.map((n) => (
            <option key={n} value={n}>{NETWORK_LABELS[n]}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <label className="text-xs text-white/50">Source wallet secret key</label>
          <WalletSelect onPick={(w) => setSecretKey(w.secretKey)} align="start" />
        </div>
        <input
          value={secretKey}
          onChange={(e) => setSecretKey(e.target.value)}
          placeholder="S… (secret key)"
          className="bg-black/30 border border-white/10 rounded px-3 py-1.5 text-sm text-white font-mono placeholder:text-white/30 outline-none focus:border-white/30"
        />
        {secretKey.trim() && (
          <p className={`text-xs px-1 font-mono ${pubkey ? "text-white/40" : "text-red-400"}`}>
            {pubkey ? `Public key: ${shortAddr(pubkey)}` : "Invalid secret key"}
          </p>
        )}
        {keyError && <p className="text-xs text-red-400 px-1">{keyError}</p>}
      </div>

      <div>
        <p className="text-xs text-white/50 mb-1.5">Schedule</p>
        <div className="flex flex-wrap gap-2">
          {INTERVAL_OPTIONS.map((opt) => (
            <button
              key={String(opt.minutes)}
              type="button"
              onClick={() => setIntervalMinutes(opt.minutes)}
              className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                intervalMinutes === opt.minutes
                  ? "bg-violet-600 border-violet-500 text-white"
                  : "bg-white/5 border-white/10 text-white/50 hover:border-white/20 hover:text-white/80"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!name.trim() || !pubkey}
          className="px-4 py-1.5 rounded bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-sm font-medium"
        >
          Create Group
        </button>
        <button type="button" onClick={onDone} className="px-4 py-1.5 rounded bg-white/10 hover:bg-white/15 text-white/60 text-sm">
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── Edit Group form (inline settings edit) ───────────────────────────────────

function EditGroupForm({ group, onDone }: { group: { id: string; name: string; network: string; secretKey: string; hasKey?: boolean; intervalMinutes: number | null }; onDone: () => void }) {
  const { updateGroup } = useAutoSendGroups();
  const [name, setName] = useState(group.name);
  const [network, setNetwork] = useState(group.network);
  const [secretKey, setSecretKey] = useState("");
  const [intervalMinutes, setIntervalMinutes] = useState<number | null>(group.intervalMinutes);

  const pubkey = derivePublicKey(secretKey);
  const keyValid = !secretKey.trim() ? group.hasKey : !!pubkey;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !keyValid) return;
    updateGroup(group.id, { name: name.trim(), network, secretKey: secretKey.trim(), intervalMinutes });
    onDone();
  }

  return (
    <form onSubmit={handleSubmit} className="border border-white/10 rounded-lg p-3 bg-white/[0.03] flex flex-col gap-3">
      <p className="text-xs font-medium text-white/50 uppercase tracking-wide">Edit Group Settings</p>
      <div className="flex gap-2 flex-wrap">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Group name"
          className="flex-1 min-w-[140px] bg-black/30 border border-white/10 rounded px-3 py-1.5 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/30"
        />
        <select
          value={network}
          onChange={(e) => setNetwork(e.target.value)}
          className="bg-black/30 border border-white/10 rounded px-3 py-1.5 text-sm text-white outline-none focus:border-white/30"
        >
          {NETWORKS.map((n) => <option key={n} value={n}>{NETWORK_LABELS[n]}</option>)}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <label className="text-xs text-white/40">Source wallet secret key</label>
          <WalletSelect onPick={(w) => setSecretKey(w.secretKey)} align="start" />
        </div>
        <input
          value={secretKey}
          onChange={(e) => setSecretKey(e.target.value)}
          placeholder={group.hasKey ? "Leave blank to keep existing key" : "S… (secret key)"}
          className="bg-black/30 border border-white/10 rounded px-3 py-1.5 text-sm text-white font-mono placeholder:text-white/30 outline-none focus:border-white/30"
        />
        {!secretKey.trim() && group.hasKey && (
          <p className="text-xs px-1 text-emerald-400/70">Key saved — leave blank to keep</p>
        )}
        {secretKey.trim() && (
          <p className={`text-xs px-1 font-mono ${pubkey ? "text-white/40" : "text-red-400"}`}>
            {pubkey ? `Public key: ${shortAddr(pubkey)}` : "Invalid secret key"}
          </p>
        )}
      </div>
      <div>
        <p className="text-xs text-white/40 mb-1.5">Schedule</p>
        <div className="flex flex-wrap gap-2">
          {INTERVAL_OPTIONS.map((opt) => (
            <button
              key={String(opt.minutes)}
              type="button"
              onClick={() => setIntervalMinutes(opt.minutes)}
              className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                intervalMinutes === opt.minutes
                  ? "bg-violet-600 border-violet-500 text-white"
                  : "bg-white/5 border-white/10 text-white/50 hover:border-white/20 hover:text-white/80"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={!name.trim() || !pubkey} className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-sm font-medium">
          <Save size={12} /> Save
        </button>
        <button type="button" onClick={onDone} className="px-3 py-1.5 rounded bg-white/10 hover:bg-white/15 text-white/60 text-sm">Cancel</button>
      </div>
    </form>
  );
}

// ── Preview table ─────────────────────────────────────────────────────────────

function PreviewTable({
  preview,
  onApprove,
  onCancel,
  approving,
}: {
  preview: GroupPreview;
  onApprove: () => void;
  onCancel: () => void;
  approving: boolean;
}) {
  const sendCount = preview.items.filter((i) => !i.wouldSkip).length;
  const totalXlm = preview.items.reduce((s, i) => s + (i.wouldSkip ? 0 : i.amountXlm), 0);
  const feeWarning = totalXlm > 0 && preview.estimatedFees / totalXlm > 0.01;

  return (
    <div className="flex flex-col gap-3 border border-blue-500/30 rounded-lg p-3 bg-blue-500/5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs font-medium text-blue-300 uppercase tracking-wide">
          Preview — <span className="font-mono normal-case text-white/60">{shortAddr(preview.walletAddress)}</span>
        </p>
        <div className="flex items-center gap-2 text-xs text-white/40">
          <span>Balance: <span className="text-white/70 font-mono">{preview.xlmBalance.toFixed(7)} XLM</span></span>
          <span>·</span>
          <span>Spendable: <span className="text-white/70 font-mono">{preview.spendable.toFixed(7)} XLM</span></span>
        </div>
      </div>

      <div className="rounded border border-white/10 overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              <th className="text-left px-3 py-2 text-white/40 font-medium">Destination</th>
              <th className="text-left px-3 py-2 text-white/40 font-medium">Label</th>
              <th className="text-left px-3 py-2 text-white/40 font-medium">Memo</th>
              <th className="text-right px-3 py-2 text-white/40 font-medium">%</th>
              <th className="text-right px-3 py-2 text-white/40 font-medium">XLM</th>
              <th className="text-right px-3 py-2 text-white/40 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {preview.items.map((item, i) => (
              <tr key={i} className={`border-b border-white/5 last:border-0 ${item.wouldSkip ? "opacity-40" : ""}`}>
                <td className="px-3 py-2 font-mono text-white/70">{shortAddr(item.destination)}</td>
                <td className="px-3 py-2 text-white/50">{item.label ?? "—"}</td>
                <td className="px-3 py-2 text-white/40 italic">{item.memo ?? "—"}</td>
                <td className="px-3 py-2 text-right">
                  {item.isRemainder
                    ? <span className="text-violet-400 text-xs uppercase tracking-wide">REST</span>
                    : <span className="text-white/60">{item.percentage}%</span>}
                </td>
                <td className="px-3 py-2 text-right font-mono text-white/80">
                  {item.wouldSkip ? "—" : item.amountXlm.toFixed(7)}
                </td>
                <td className="px-3 py-2 text-right">
                  {item.wouldSkip
                    ? <span className="text-yellow-400 text-xs" title={item.skipReason}>skip</span>
                    : <span className="text-green-400 text-xs">send</span>}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-white/10 bg-white/5">
              <td colSpan={4} className="px-3 py-1.5 text-xs text-white/30">
                {sendCount} sending · {preview.items.length - sendCount} skipped
                {preview.batchSend ? " · 1 transaction" : ` · ${sendCount} transaction${sendCount !== 1 ? "s" : ""}`}
                {" · "}
                <span className={feeWarning ? "text-yellow-400" : ""}>
                  est. fee {preview.estimatedFees.toFixed(7)} XLM
                  {feeWarning && " ⚠ >1% of amount"}
                </span>
              </td>
              <td className="px-3 py-1.5 text-right text-xs font-mono text-white/60">{totalXlm.toFixed(7)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex gap-2 items-center">
        <button
          onClick={onApprove}
          disabled={approving || sendCount === 0}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white text-sm font-medium"
        >
          {approving ? <RefreshCw size={12} className="animate-spin" /> : <CheckCircle size={12} />}
          {approving ? "Sending…" : "Approve & Send"}
        </button>
        <button onClick={onCancel} disabled={approving} className="px-4 py-1.5 rounded bg-white/10 hover:bg-white/15 text-white/50 text-sm">
          Cancel
        </button>
        {sendCount === 0 && (
          <span className="text-xs text-yellow-400">
            {preview.items.length === 0
              ? "No destinations configured"
              : preview.spendable <= 0
              ? "Nothing to send — balance too low"
              : "All destinations skipped"}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Run history panel ─────────────────────────────────────────────────────────

function RunHistory({ groupId, network, onReRun }: { groupId: string; network: string; onReRun: () => void }) {
  const [runs, setRuns] = useState<RunLogEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await waitForAuth();
      const res = await fetch(`/api/auto-send/history?groupId=${groupId}`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      setRuns(Array.isArray(data) ? data : []);
    } catch {
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <p className="text-xs text-white/30 animate-pulse">Loading history…</p>;
  if (!runs || runs.length === 0) return <p className="text-xs text-white/30">No runs recorded yet.</p>;

  return (
    <div className="flex flex-col gap-1">
      {runs.map((run, i) => (
        <div key={run.ranAt} className="border border-white/10 rounded overflow-hidden">
          <button
            onClick={() => setExpanded(expanded === i ? null : i)}
            className="w-full flex items-center gap-3 px-3 py-2 bg-white/5 hover:bg-white/[0.08] transition-colors text-left"
          >
            <span className="text-xs text-white/50 font-mono">{new Date(run.ranAt).toLocaleString()}</span>
            <span className="text-xs text-white/30">·</span>
            <span className="text-xs text-white/40">{timeAgo(run.ranAt)}</span>
            <span className="flex-1" />
            <button
              onClick={(e) => { e.stopPropagation(); onReRun(); }}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/5 hover:bg-violet-600/30 border border-white/10 hover:border-violet-500/30 text-white/40 hover:text-white/80 text-xs transition-colors"
              title="Re-run this group now"
            >
              <Play size={9} />
              Re-run
            </button>
            {run.sentCount > 0 && <span className="text-xs text-green-400">{run.sentCount} sent</span>}
            {run.skippedCount > 0 && <span className="text-xs text-yellow-400 ml-1">{run.skippedCount} skipped</span>}
            {run.failedCount > 0 && <span className="text-xs text-red-400 ml-1">{run.failedCount} failed</span>}
            {(run.previewCount ?? 0) > 0 && <span className="text-xs text-blue-300 ml-1">{run.previewCount} preview</span>}
            {run.totalXlm > 0 && <span className="text-xs text-white/60 font-mono ml-2">{run.totalXlm.toFixed(7)} XLM</span>}
            <ChevronDown size={12} className={`text-white/30 transition-transform ${expanded === i ? "" : "-rotate-90"}`} />
          </button>
          {expanded === i && (
            <div className="px-3 py-2 border-t border-white/5 flex flex-col gap-1">
              {run.results.map((r, j) => (
                <div key={j} className="flex items-center gap-2 text-xs font-mono text-white/50">
                  <span className="text-white/70">{shortAddr(r.destination)}</span>
                  <StatusChip result={r as DestinationRunResult} network={network} />
                  {r.error && <span className="text-red-400/70 truncate max-w-xs" title={r.error}>{r.error}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Group card ────────────────────────────────────────────────────────────────

function GroupCard({ groupId, runAllStatus }: { groupId: string; runAllStatus?: RunAllStatus }) {
  const { groups, createGroup, updateGroup, deleteGroup, deleteDestination, upsertDestination } = useAutoSendGroups();
  const group = groups.find((g) => g.id === groupId);
  const [expanded, setExpanded] = useState(false);
  const [addingDest, setAddingDest] = useState(false);
  const [editingDestId, setEditingDestId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [running, setRunning] = useState(false);
  const [checking, setChecking] = useState(false);
  const [, forceRender] = useState(0);
  const runResult = _runResults.get(groupId) ?? null;
  const setRunResult = useCallback((r: GroupRunResult | null) => { if (r) _runResults.set(groupId, r); else _runResults.delete(groupId); forceRender((n) => n + 1); }, [groupId]);
  const [preview, setPreview] = useState<GroupPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<RunLogEntry | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingBatchMemo, setEditingBatchMemo] = useState(false);
  const [batchMemoInput, setBatchMemoInput] = useState("");
  const [editingReserve, setEditingReserve] = useState(false);
  const [reserveInput, setReserveInput] = useState("");
  const [destTotals, setDestTotals] = useState<Record<string, { totalXlm: number; sentCount: number }>>({});
  const [editingGroup, setEditingGroup] = useState(false);
  const [, forceCountdownRefresh] = useState(0);
  const [editingSenderThreshold, setEditingSenderThreshold] = useState(false);
  const [senderThresholdInput, setSenderThresholdInput] = useState("");
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceAddr, setBalanceAddr] = useState<string | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [testRunning, setTestRunning] = useState(false);
  const testResult = _testResults.get(groupId) ?? null;
  const setTestResult = useCallback((r: GroupRunResult | null) => { if (r) _testResults.set(groupId, r); else _testResults.delete(groupId); forceRender((n) => n + 1); }, [groupId]);
  const [dismissedFailure, setDismissedFailure] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // Load last run on mount
  useEffect(() => {
    waitForAuth().then(() =>
      fetch(`/api/auto-send/history?groupId=${groupId}`, { headers: authHeaders() })
        .then((r) => r.json())
        .then((data: RunLogEntry[]) => { if (data?.[0]) setLastRun(data[0]); })
        .catch(() => {})
    );
  }, [groupId]);

  // Load per-destination totals when expanded
  useEffect(() => {
    if (!expanded) return;
    waitForAuth().then(() =>
      fetch(`/api/auto-send/history?groupId=${groupId}&totals=1`, { headers: authHeaders() })
        .then((r) => r.json())
        .then((data) => { if (data && !data.error) setDestTotals(data); })
        .catch(() => {})
    );
  }, [expanded, groupId]);

  // Fetch balance when expanded
  const fetchBalance = useCallback(async () => {
    setLoadingBalance(true);
    try {
      await waitForAuth();
      const res = await fetch(`/api/auto-send/balance?groupId=${groupId}`, { headers: authHeaders() });
      const data = await res.json();
      if (data.balance !== undefined) {
        setBalance(data.balance);
        setBalanceAddr(data.address);
      }
    } catch { /* ignore */ } finally {
      setLoadingBalance(false);
    }
  }, [groupId]);

  useEffect(() => {
    if (expanded && balance === null) fetchBalance();
  }, [expanded, balance, fetchBalance]);

  // Auto-refresh countdown every 10s (shows seconds when < 2m remaining)
  useEffect(() => {
    if (!group?.intervalMinutes) return;
    const t = setInterval(() => forceCountdownRefresh((n) => n + 1), 10000);
    return () => clearInterval(t);
  }, [group?.intervalMinutes]);

  if (!group) return null;

  const pubkey = group.secretKey ? derivePublicKey(group.secretKey) : null;
  const destinations = group.destinations ?? [];
  const destCount = destinations.length;
  const totalPct = destinations.filter((d) => !d.isRemainder).reduce((sum, d) => sum + d.percentage, 0);
  const hasRemainder = destinations.some((d) => d.isRemainder);
  const overBudget = totalPct > 100;
  const nextRun = nextRunLabel(lastRun?.ranAt, group.intervalMinutes);

  async function handleCheck() {
    setChecking(true);
    setPreview(null);
    setPreviewError(null);
    setRunResult(null);
    setExpanded(true);
    try {
      await waitForAuth();
      const res = await fetch("/api/auto-send/run", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ groupId: group!.id, dryRun: true }),
      });
      const data = await res.json();
      if (data.error) setPreviewError(data.error);
      else setPreview(data as GroupPreview);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Failed to load preview");
    } finally {
      setChecking(false);
    }
  }

  async function handleRun() {
    setRunning(true);
    setPreview(null);
    setPreviewError(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      await waitForAuth();
      const res = await fetch("/api/auto-send/run", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ groupId: group!.id }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (data && Array.isArray(data.results)) {
        const result = data as GroupRunResult;
        setRunResult(result);
        const sentCount = result.results.filter((r) => r.status === "sent").length;
        const totalXlm = result.results.reduce((s, r) => s + (r.amountSent ?? 0), 0);
        notify(
          `Auto-send: ${group!.name}`,
          sentCount > 0
            ? `Sent ${sentCount} payment${sentCount !== 1 ? "s" : ""} · ${totalXlm.toFixed(2)} XLM`
            : "Run complete — nothing sent"
        );
        // Refresh last run + totals
        waitForAuth().then(async () => {
          const [histRes, totalsRes] = await Promise.all([
            fetch(`/api/auto-send/history?groupId=${group!.id}`, { headers: authHeaders() }),
            fetch(`/api/auto-send/history?groupId=${group!.id}&totals=1`, { headers: authHeaders() }),
          ]);
          const d: RunLogEntry[] = await histRes.json();
          if (d?.[0]) setLastRun(d[0]);
          const t = await totalsRes.json();
          if (t && !t.error) setDestTotals(t);
        }).catch(() => {});
      }
      setExpanded(true);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setRunResult({ groupId: group!.id, walletAddress: "", ranAt: Date.now(), results: [{ destination: "", status: "failed", error: "Request timed out after 60s" }] });
      }
    } finally {
      clearTimeout(timeout);
      setRunning(false);
    }
  }

  async function handleTestRun() {
    setTestRunning(true);
    setTestResult(null);
    setExpanded(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      await waitForAuth();
      const res = await fetch("/api/auto-send/run", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ groupId: group!.id, testRun: true }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (data && Array.isArray(data.results)) {
        setTestResult(data as GroupRunResult);
        notify(`Test run: ${group!.name}`, `Test complete — ${data.results.filter((r: DestinationRunResult) => r.status === "sent").length} reached`);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setTestResult({ groupId: group!.id, walletAddress: "", ranAt: Date.now(), results: [{ destination: "", status: "failed", error: "Request timed out after 60s" }] });
      }
    } finally {
      clearTimeout(timeout);
      setTestRunning(false);
    }
  }

  function handleDuplicate() {
    const newId = crypto.randomUUID();
    const newName = `${group!.name} (copy)`;
    createGroup({
      id: newId,
      name: newName,
      network: group!.network,
      secretKey: group!.secretKey,
      intervalMinutes: group!.intervalMinutes,
    });
    // Disable the copy so it doesn't auto-run
    updateGroup(newId, { enabled: false });
    for (const d of group!.destinations) {
      upsertDestination(newId, {
        destination: d.destination,
        percentage: d.percentage,
        isRemainder: d.isRemainder,
        paused: d.paused,
        label: d.label,
        memo: d.memo,
        minThreshold: d.minThreshold,
        maxCap: d.maxCap,
        position: d.position,
      });
    }
  }

  function handleDragDrop(fromIdx: number, toIdx: number) {
    if (fromIdx === toIdx) return;
    const normalized = destinations.map((d, i) => ({ ...d, position: i }));
    const a = normalized[fromIdx];
    const b = normalized[toIdx];
    upsertDestination(groupId, { ...a, position: b.position });
    upsertDestination(groupId, { ...b, position: a.position });
  }

  function startEditBatchMemo() {
    setBatchMemoInput(group!.batchMemo ?? "");
    setEditingBatchMemo(true);
  }

  function saveBatchMemo() {
    updateGroup(group!.id, { batchMemo: batchMemoInput.trim() || undefined });
    setEditingBatchMemo(false);
  }

  return (
    <div className="border border-white/10 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white/5 hover:bg-white/[0.08] transition-colors">
        <button onClick={() => setExpanded((v) => !v)} className="text-white/40 hover:text-white/70">
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-white truncate">{group.name}</p>
            {/* Last run status badge */}
            {lastRun && (() => {
              const hasSent = lastRun.sentCount > 0;
              const hasFailed = lastRun.failedCount > 0;
              if (hasFailed) return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/20 text-red-400 border border-red-500/30 flex-shrink-0">&#x2717; failed</span>;
              if (hasSent) return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-500/20 text-green-400 border border-green-500/30 flex-shrink-0">&#x2713; sent</span>;
              return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 flex-shrink-0">~ skipped</span>;
            })()}
            <button
              onClick={(e) => { e.stopPropagation(); setEditingGroup(true); setExpanded(true); }}
              className="text-white/20 hover:text-white/60 transition-colors flex-shrink-0"
              title="Edit group settings"
            >
              <Pencil size={11} />
            </button>
            {runAllStatus === "running" && <RefreshCw size={11} className="animate-spin text-violet-400 flex-shrink-0" />}
            {runAllStatus === "done" && <CheckCircle size={11} className="text-green-400 flex-shrink-0" />}
            {runAllStatus === "failed" && <span className="text-xs text-red-400 flex-shrink-0">failed</span>}
            {runAllStatus === "pending" && <span className="text-xs text-white/30 flex-shrink-0">queued</span>}
          </div>
          <p className="text-xs text-white/40 mt-0.5 flex items-center gap-2 flex-wrap">
            <Key size={10} className="inline" />
            <span className="font-mono">{pubkey ? shortAddr(pubkey) : <span className="text-red-400">invalid key</span>}</span>
            <span>·</span>
            <span>{NETWORK_LABELS[group.network] ?? group.network}</span>
            <span>·</span>
            <Clock size={10} className="inline" />
            <span>{intervalLabel(group.intervalMinutes)}</span>
            <span>·</span>
            {/* Batch/Separate toggle */}
            <button
              onClick={(e) => { e.stopPropagation(); updateGroup(group.id, { batchSend: !group.batchSend }); }}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-xs transition-colors ${
                group.batchSend
                  ? "bg-blue-500/15 border-blue-500/30 text-blue-300"
                  : "bg-white/5 border-white/10 text-white/40 hover:border-white/20"
              }`}
              title={group.batchSend ? "Batch: one transaction — click to switch to separate" : "Separate: one tx per dest — click to switch to batch"}
            >
              <Layers size={9} />
              {group.batchSend ? "Batch" : "Separate"}
            </button>
            <span>·</span>
            <span>{destCount} dest{destCount !== 1 ? "s" : ""}</span>
            {destCount > 0 && (
              <>
                <span>·</span>
                {overBudget
                  ? <span className="text-red-400 font-medium">⚠ {totalPct.toFixed(0)}%</span>
                  : <span>{totalPct.toFixed(0)}%{hasRemainder ? " + REST" : " total"}</span>}
              </>
            )}
            {lastRun && (
              <>
                <span>·</span>
                <span title={new Date(lastRun.ranAt).toLocaleString()} className="flex items-center gap-1.5">
                  <span>ran {timeAgo(lastRun.ranAt)}</span>
                  <span className="text-white/20">·</span>
                  <span className="font-mono text-white/50">{shortAddr(lastRun.walletAddress)}</span>
                  {lastRun.sentCount > 0 && <span className="text-green-400">{lastRun.sentCount} sent · {lastRun.totalXlm.toFixed(2)} XLM</span>}
                  {lastRun.failedCount > 0 && <span className="text-red-400">{lastRun.failedCount} failed</span>}
                  {(lastRun.previewCount ?? 0) > 0 && <span className="text-blue-300">{lastRun.previewCount} preview</span>}
                  {lastRun.sentCount === 0 && lastRun.failedCount === 0 && (lastRun.previewCount ?? 0) === 0 && <span className="text-yellow-400">all skipped</span>}
                </span>
              </>
            )}
            {nextRun && (
              <>
                <span>·</span>
                <span className="text-white/30">{nextRun}</span>
              </>
            )}
          </p>
        </div>
        {/* Enabled toggle */}
        <button
          onClick={() => updateGroup(group.id, { enabled: !group.enabled })}
          className={`text-xs px-2 py-0.5 rounded border font-medium transition-colors ${
            group.enabled
              ? "bg-green-500/15 border-green-500/30 text-green-400"
              : "bg-white/5 border-white/10 text-white/30"
          }`}
        >
          {group.enabled ? "On" : "Off"}
        </button>
        {/* Check */}
        <button
          onClick={handleCheck}
          disabled={checking || running || destCount === 0 || !pubkey || destinations.every(d => d.paused)}
          className="flex items-center gap-1 px-3 py-1.5 rounded bg-white/10 hover:bg-white/15 disabled:opacity-50 text-white/70 hover:text-white text-xs font-medium border border-white/10 hover:border-white/20"
        >
          {checking ? <RefreshCw size={12} className="animate-spin" /> : <Eye size={12} />}
          {checking ? "Checking…" : "Check"}
        </button>
        {/* Test run */}
        <button
          onClick={handleTestRun}
          disabled={testRunning || running || checking || destCount === 0 || !pubkey}
          className="flex items-center gap-1 px-3 py-1.5 rounded bg-white/10 hover:bg-white/15 disabled:opacity-50 text-white/70 hover:text-white text-xs font-medium border border-white/10 hover:border-white/20"
          title="Send 0.0000001 XLM to each destination to verify reachability"
        >
          {testRunning ? <RefreshCw size={12} className="animate-spin" /> : <FlaskConical size={12} />}
          {testRunning ? "Testing…" : "Test"}
        </button>
        {/* Run now */}
        <button
          onClick={handleRun}
          disabled={running || checking || destCount === 0 || !pubkey || group.previewOnly || destinations.every(d => d.paused)}
          className="flex items-center gap-1 px-3 py-1.5 rounded bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-xs font-medium"
          title={group.previewOnly ? "Group is in preview-only mode — disable to send real transactions" : undefined}
        >
          {running ? <RefreshCw size={12} className="animate-spin" /> : <Play size={12} />}
          {running ? "Running…" : "Run Now"}
        </button>
        {/* Duplicate */}
        <button
          onClick={(e) => { e.stopPropagation(); handleDuplicate(); }}
          className="text-white/20 hover:text-white/60 transition-colors"
          title="Duplicate group"
        >
          <Copy size={14} />
        </button>
        {/* Delete */}
        {confirmDelete ? (
          <div className="flex items-center gap-1">
            <button onClick={() => deleteGroup(group.id)} className="px-2 py-1 rounded bg-red-600 hover:bg-red-500 text-white text-xs">Confirm</button>
            <button onClick={() => setConfirmDelete(false)} className="px-2 py-1 rounded bg-white/10 text-white/50 text-xs">Cancel</button>
          </div>
        ) : (
          <button onClick={() => setConfirmDelete(true)} className="text-white/20 hover:text-red-400 transition-colors">
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {/* Expanded body */}
      {expanded && (
        <div className="px-4 py-3 flex flex-col gap-3 border-t border-white/10">
          {/* No destinations warning */}
          {group.intervalMinutes && destinations.length === 0 && (
            <div className="flex items-center gap-2 px-3 py-2 rounded bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-400">
              <AlertTriangle size={12} className="flex-shrink-0" />
              <span>Schedule is active but no destinations are configured — nothing will be sent.</span>
            </div>
          )}

          {/* Failure alert banner */}
          {group.lastFailureAt && !dismissedFailure && (
            <div className="flex items-center gap-2 px-3 py-2 rounded bg-red-500/10 border border-red-500/20 text-xs text-red-400">
              <AlertTriangle size={12} className="flex-shrink-0" />
              <span className="flex-1">
                Scheduled run failed on {new Date(group.lastFailureAt).toLocaleString()}. Check history for details.
              </span>
              <button
                onClick={() => {
                  updateGroup(group.id, { lastFailureAt: undefined });
                  setDismissedFailure(true);
                }}
                className="text-red-400/60 hover:text-red-400 transition-colors"
              >
                <X size={12} />
              </button>
            </div>
          )}

          {/* Balance display */}
          <div className="flex items-center gap-2">
            <Wallet size={12} className="text-white/30" />
            <span className="text-xs text-white/40">Balance:</span>
            {loadingBalance ? (
              <span className="text-xs text-white/30 animate-pulse">loading...</span>
            ) : balance !== null ? (
              <span className="text-xs font-mono text-white/70">{balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 7 })} XLM</span>
            ) : (
              <span className="text-xs text-white/20">--</span>
            )}
            <button onClick={() => { setBalance(null); fetchBalance(); }} className="text-white/20 hover:text-white/50 transition-colors" title="Refresh balance">
              <RefreshCw size={10} />
            </button>
          </div>

          {/* Inline group editor */}
          {editingGroup && (
            <EditGroupForm group={group} onDone={() => setEditingGroup(false)} />
          )}

          {/* Preview error */}
          {previewError && (
            <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">{previewError}</div>
          )}

          {/* Preview table */}
          {preview && (
            <PreviewTable preview={preview} approving={running} onApprove={handleRun} onCancel={() => setPreview(null)} />
          )}

          {/* Run results */}
          {runResult && !preview && (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs text-white/50 uppercase tracking-wide font-medium">
                Last Run — source: <span className="font-mono normal-case">{shortAddr(runResult.walletAddress)}</span>
              </p>
              {runResult.results.map((r, i) => (
                <div key={i} className="flex items-center gap-3 text-xs font-mono text-white/60">
                  <span className="text-white/80">
                    {r.label ? <span>{r.label} <span className="text-white/40">({shortAddr(r.destination)})</span></span> : shortAddr(r.destination)}
                  </span>
                  <StatusChip result={r} network={group.network} />
                  {r.txHash && (
                    <a href={expertTxUrl(group.network, r.txHash)} target="_blank" rel="noopener noreferrer" className="text-white/30 hover:text-white/60"><ExternalLink size={10} /></a>
                  )}
                  {r.error && <span className="text-red-400/70 truncate max-w-xs" title={r.error}>{r.error}</span>}
                </div>
              ))}
            </div>
          )}

          {/* Test run results */}
          {testResult && (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs text-white/50 uppercase tracking-wide font-medium">
                Test Run (0.0000001 XLM each) — <span className="font-mono normal-case">{shortAddr(testResult.walletAddress)}</span>
              </p>
              {testResult.results.map((r, i) => (
                <div key={i} className="flex items-center gap-3 text-xs font-mono text-white/60">
                  <span className="text-white/80">
                    {r.label ? <span>{r.label} <span className="text-white/40">({shortAddr(r.destination)})</span></span> : shortAddr(r.destination)}
                  </span>
                  <StatusChip result={r} network={group.network} />
                  {r.error && <span className="text-red-400/70 truncate max-w-xs" title={r.error}>{r.error}</span>}
                </div>
              ))}
            </div>
          )}

          {/* Reserve setting */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/40">Keep in wallet:</span>
            {editingReserve ? (
              <>
                <input
                  autoFocus
                  value={reserveInput}
                  onChange={(e) => setReserveInput(e.target.value)}
                  type="number"
                  min={0}
                  step={0.1}
                  placeholder="1.0"
                  className="w-24 bg-black/30 border border-white/15 rounded px-2 py-1 text-xs text-white font-mono placeholder:text-white/25 outline-none focus:border-white/30"
                />
                <span className="text-xs text-white/40">XLM</span>
                <button
                  onClick={() => {
                    const v = parseFloat(reserveInput);
                    updateGroup(group!.id, { minReserve: !isNaN(v) && v >= 0 ? v : 10.0 });
                    setEditingReserve(false);
                  }}
                  className="px-2 py-1 rounded bg-violet-600 hover:bg-violet-500 text-white text-xs"
                >Save</button>
                <button onClick={() => setEditingReserve(false)} className="px-2 py-1 rounded bg-white/10 text-white/50 text-xs">Cancel</button>
              </>
            ) : (
              <>
                <span className="text-xs font-mono text-white/60">{group.minReserve ?? 10.0} XLM</span>
                <button onClick={() => { setReserveInput(String(group!.minReserve ?? 1.0)); setEditingReserve(true); }} className="text-white/25 hover:text-white/60 transition-colors">
                  <Pencil size={11} />
                </button>
              </>
            )}
          </div>

          {/* Min sender threshold setting */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/40">Min sender balance:</span>
            {editingSenderThreshold ? (
              <>
                <input
                  autoFocus
                  value={senderThresholdInput}
                  onChange={(e) => setSenderThresholdInput(e.target.value)}
                  type="number"
                  min={0}
                  step={0.1}
                  placeholder="0"
                  className="w-24 bg-black/30 border border-white/15 rounded px-2 py-1 text-xs text-white font-mono placeholder:text-white/25 outline-none focus:border-white/30"
                />
                <span className="text-xs text-white/40">XLM</span>
                <button
                  onClick={() => {
                    const v = parseFloat(senderThresholdInput);
                    updateGroup(group!.id, { minSenderThreshold: !isNaN(v) && v >= 0 ? v : 0 });
                    setEditingSenderThreshold(false);
                  }}
                  className="px-2 py-1 rounded bg-violet-600 hover:bg-violet-500 text-white text-xs"
                >Save</button>
                <button onClick={() => setEditingSenderThreshold(false)} className="px-2 py-1 rounded bg-white/10 text-white/50 text-xs">Cancel</button>
              </>
            ) : (
              <>
                <span className="text-xs font-mono text-white/60">{group.minSenderThreshold > 0 ? `${group.minSenderThreshold} XLM` : "disabled"}</span>
                <button onClick={() => { setSenderThresholdInput(String(group!.minSenderThreshold ?? 0)); setEditingSenderThreshold(true); }} className="text-white/25 hover:text-white/60 transition-colors">
                  <Pencil size={11} />
                </button>
                {group.minSenderThreshold > 0 && (
                  <span className="text-xs text-white/30">Skips entire group if balance is below this</span>
                )}
              </>
            )}
          </div>

          {/* Batch memo field (shown when batchSend) */}
          {group.batchSend && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/40">Batch memo:</span>
              {editingBatchMemo ? (
                <>
                  <input
                    autoFocus
                    value={batchMemoInput}
                    onChange={(e) => setBatchMemoInput(e.target.value)}
                    maxLength={28}
                    placeholder="Transaction memo (max 28 chars)"
                    className="flex-1 bg-black/30 border border-white/15 rounded px-2 py-1 text-xs text-white font-mono placeholder:text-white/25 outline-none focus:border-white/30"
                  />
                  <button onClick={saveBatchMemo} className="px-2 py-1 rounded bg-violet-600 hover:bg-violet-500 text-white text-xs">Save</button>
                  <button onClick={() => setEditingBatchMemo(false)} className="px-2 py-1 rounded bg-white/10 text-white/50 text-xs">Cancel</button>
                </>
              ) : (
                <>
                  <span className="text-xs font-mono text-white/60 italic">{group.batchMemo || "none"}</span>
                  <button onClick={startEditBatchMemo} className="text-white/25 hover:text-white/60 transition-colors">
                    <Pencil size={11} />
                  </button>
                </>
              )}
            </div>
          )}

          {/* Dry-run toggle */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => updateGroup(group.id, { previewOnly: !group.previewOnly })}
              className={`flex items-center gap-1.5 px-2 py-1 rounded border text-xs transition-colors ${
                group.previewOnly
                  ? "bg-blue-500/15 border-blue-500/30 text-blue-300"
                  : "bg-white/5 border-white/10 text-white/40 hover:border-white/20"
              }`}
            >
              <Eye size={10} />
              {group.previewOnly ? "Dry-run on schedule" : "Live on schedule"}
            </button>
            {group.previewOnly && (
              <span className="text-xs text-white/30">Scheduler will preview only — no real transactions</span>
            )}
          </div>

          {/* Destinations table */}
          {destinations.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-xs text-white/50 uppercase tracking-wide font-medium">Destinations</p>
              <div className="rounded border border-white/10 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/5">
                      <th className="px-2 py-2 w-10"></th>
                      <th className="text-left px-3 py-2 text-white/40 font-medium">Destination</th>
                      <th className="text-left px-3 py-2 text-white/40 font-medium">Label</th>
                      <th className="text-left px-3 py-2 text-white/40 font-medium">Memo</th>
                      <th className="text-right px-3 py-2 text-white/40 font-medium">%</th>
                      <th className="text-right px-3 py-2 text-white/40 font-medium">Min XLM</th>
                      <th className="text-right px-3 py-2 text-white/40 font-medium">Max cap</th>
                      <th className="text-right px-3 py-2 text-white/40 font-medium">Total sent</th>
                      <th className="px-3 py-2 w-12"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {destinations.map((d, idx) =>
                      editingDestId === d.id ? (
                        <tr key={d.id}>
                          <td colSpan={9} className="p-2">
                            <DestinationForm
                              groupId={group.id}
                              initial={d}
                              currentTotal={totalPct}
                              ownPercentage={d.isRemainder ? 0 : d.percentage}
                              hasExistingRemainder={hasRemainder && !d.isRemainder}
                              onDone={() => setEditingDestId(null)}
                            />
                          </td>
                        </tr>
                      ) : (
                        <tr
                          key={d.id}
                          draggable
                          onDragStart={() => setDragIdx(idx)}
                          onDragOver={(e) => { e.preventDefault(); setDragOverIdx(idx); }}
                          onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
                          onDrop={() => { if (dragIdx !== null && dragIdx !== idx) handleDragDrop(dragIdx, idx); setDragIdx(null); setDragOverIdx(null); }}
                          className={`border-b border-white/5 last:border-0 group/row ${d.paused ? "opacity-50" : ""} ${dragOverIdx === idx ? "bg-violet-500/10" : ""}`}
                        >
                          <td className="px-2 py-2 cursor-grab active:cursor-grabbing">
                            <GripVertical size={12} className="text-white/20" />
                          </td>
                          <td className="px-3 py-2 font-mono text-white/70">{shortAddr(d.destination)}</td>
                          <td className="px-3 py-2 text-white/50">{d.label ?? "—"}</td>
                          <td className="px-3 py-2 text-white/40 italic">{d.memo ?? "—"}</td>
                          <td className="px-3 py-2 text-right font-medium">
                            {d.paused
                              ? <span className="text-yellow-400/70 text-xs uppercase tracking-wide">paused</span>
                              : d.isRemainder
                              ? <span className="text-violet-400 text-xs uppercase tracking-wide">REST</span>
                              : <span className="text-white/80">{d.percentage}%</span>}
                          </td>
                          <td className="px-3 py-2 text-right text-white/40">{d.minThreshold > 0 ? `${d.minThreshold} XLM` : "—"}</td>
                          <td className="px-3 py-2 text-right text-white/40">{d.maxCap > 0 ? `${d.maxCap} XLM` : "—"}</td>
                          <td className="px-3 py-2 text-right">
                            {destTotals[d.destination] ? (
                              <span className="text-green-400/70 font-mono text-xs" title={`${destTotals[d.destination].sentCount} payments`}>
                                {destTotals[d.destination].totalXlm.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} XLM
                              </span>
                            ) : (
                              <span className="text-white/20">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1 justify-end">
                              <button
                                onClick={() => upsertDestination(group.id, { ...d, paused: !d.paused })}
                                className={`transition-colors ${d.paused ? "text-yellow-400 hover:text-yellow-300" : "text-white/20 hover:text-yellow-400 opacity-0 group-hover/row:opacity-100"}`}
                                title={d.paused ? "Resume destination" : "Pause destination"}
                              >
                                <PauseCircle size={12} />
                              </button>
                              <button
                                onClick={() => setEditingDestId(d.id)}
                                className="text-white/20 hover:text-white/60 transition-colors opacity-0 group-hover/row:opacity-100"
                              >
                                <Pencil size={11} />
                              </button>
                              <button
                                onClick={() => deleteDestination(group.id, d.id)}
                                className="text-white/20 hover:text-red-400 transition-colors"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                  {destCount > 1 && (
                    <tfoot>
                      <tr className="border-t border-white/10 bg-white/5">
                        <td colSpan={4} className="px-3 py-1.5 text-xs text-white/30">Total</td>
                        <td className={`px-3 py-1.5 text-right text-xs font-medium ${overBudget ? "text-red-400" : "text-white/60"}`}>
                          {totalPct.toFixed(2)}%{hasRemainder ? " + REST" : ""}
                          {overBudget && <span className="ml-1">⚠ exceeds 100%</span>}
                        </td>
                        <td />
                        <td className="px-3 py-1.5 text-right text-xs font-mono text-green-400/60">
                          {Object.values(destTotals).reduce((s, t) => s + t.totalXlm, 0) > 0
                            ? `${Object.values(destTotals).reduce((s, t) => s + t.totalXlm, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} XLM`
                            : ""}
                        </td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}

          {/* Stranded XLM warning */}
          {destCount > 0 && !hasRemainder && !overBudget && totalPct < 100 && (
            <div className="flex items-center gap-2 px-3 py-2 rounded bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-400">
              <AlertTriangle size={12} className="flex-shrink-0" />
              <span>
                {(100 - totalPct).toFixed(0)}% of spendable XLM has no destination — add a <strong>REST</strong> destination to collect the remainder, or raise percentages to 100%.
              </span>
            </div>
          )}

          {/* Add destination */}
          {addingDest ? (
            <DestinationForm
              groupId={group.id}
              currentTotal={totalPct}
              ownPercentage={0}
              hasExistingRemainder={hasRemainder}
              onDone={() => setAddingDest(false)}
            />
          ) : (
            <button
              onClick={() => setAddingDest(true)}
              className="self-start flex items-center gap-1.5 px-3 py-1.5 rounded border border-white/10 hover:border-white/20 text-white/50 hover:text-white/80 text-xs transition-colors"
            >
              <Plus size={12} />
              Add Destination
            </button>
          )}

          {/* History toggle */}
          <div>
            <button
              onClick={() => setShowHistory((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-white/30 hover:text-white/60 transition-colors"
            >
              <History size={12} />
              {showHistory ? "Hide history" : "Show run history"}
            </button>
            {showHistory && (
              <div className="mt-2">
                <RunHistory groupId={group.id} network={group.network} onReRun={handleRun} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

type RunAllStatus = "pending" | "running" | "done" | "failed";

export function AutoSendGroupsPanel() {
  const { groups, isLoaded } = useAutoSendGroups();
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [stats, setStats] = useState<AutoSendStats | null>(null);
  const [runAllStatus, setRunAllStatus] = useState<Map<string, RunAllStatus>>(new Map());
  const runAllActive = Array.from(runAllStatus.values()).some((s) => s === "running" || s === "pending");
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | null>(null);
  const [isServerless, setIsServerless] = useState(false);

  useEffect(() => {
    if ("Notification" in window) setNotifPermission(Notification.permission);
  }, []);

  // Check if running on serverless (Vercel)
  useEffect(() => {
    waitForAuth().then(() =>
      fetch("/api/auto-send/scheduler-status", { headers: authHeaders() })
        .then((r) => r.json())
        .then((d: { serverless: boolean }) => { if (d.serverless) setIsServerless(true); })
        .catch(() => {})
    );
  }, []);

  useEffect(() => {
    waitForAuth().then(() =>
      fetch("/api/auto-send/stats", { headers: authHeaders() })
        .then((r) => r.json())
        .then((d: AutoSendStats) => setStats(d))
        .catch(() => {})
    );
  }, []);

  async function handleRunAll() {
    const eligible = groups.filter((g) => g.destinations.length > 0 && (g.hasKey || !!g.secretKey) && !g.previewOnly);
    if (eligible.length === 0) return;
    const updates = new Map<string, RunAllStatus>();
    for (const g of eligible) updates.set(g.id, "pending");
    setRunAllStatus(updates);
    await waitForAuth();

    await Promise.allSettled(
      eligible.map(async (g) => {
        setRunAllStatus((prev) => new Map(prev).set(g.id, "running"));
        try {
          const res = await fetch("/api/auto-send/run", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify({ groupId: g.id }),
          });
          const data = await res.json();
          setRunAllStatus((prev) => new Map(prev).set(g.id,
            data.results?.some((r: DestinationRunResult) => r.status === "failed") ? "failed" : "done"
          ));
        } catch {
          setRunAllStatus((prev) => new Map(prev).set(g.id, "failed"));
        }
      })
    );
    // Clear status after short delay so indicators fade
    setTimeout(() => setRunAllStatus(new Map()), 3000);
  }

  if (!isLoaded) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-white/30">
        <RefreshCw size={22} className="animate-spin" />
        <span className="text-sm">Loading auto-send groups…</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {isServerless && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-400">
          <AlertTriangle size={12} className="flex-shrink-0" />
          <span>Running on a serverless platform — scheduled auto-sends are disabled. Use manual &quot;Run Now&quot; instead.</span>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Auto-Send Groups</h2>
          <p className="text-sm text-white/40 mt-0.5">
            Each group has one source wallet and multiple destinations, each receiving a % of the XLM balance.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {notifPermission === "default" && (
            <button
              onClick={() => Notification.requestPermission().then((p) => setNotifPermission(p))}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/40 hover:text-white/70 text-sm"
              title="Enable desktop notifications for run results"
            >
              <Bell size={13} />
            </button>
          )}
          {groups.filter((g) => g.destinations.length > 0).length > 1 && (
            <button
              onClick={handleRunAll}
              disabled={runAllActive}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 disabled:opacity-50 text-white/70 hover:text-white text-sm font-medium border border-white/10"
            >
              {runAllActive ? <RefreshCw size={14} className="animate-spin" /> : <PlayCircle size={14} />}
              Run All
            </button>
          )}
          <button
            onClick={() => setShowNewGroup((v) => !v)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium"
          >
            <Plus size={14} />
            New Group
          </button>
        </div>
      </div>

      {showNewGroup && <AddGroupForm onDone={() => setShowNewGroup(false)} />}

      {/* Overall stats bar */}
      {stats && (stats.totalRuns > 0 || stats.activeGroups > 0) && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 px-4 py-2.5 rounded-lg border border-white/8 bg-white/[0.03] text-xs text-white/40">
          {stats.activeGroups > 0 && (
            <span><span className="text-white/70 font-medium">{stats.activeGroups}</span> scheduled</span>
          )}
          {stats.totalRuns > 0 && (
            <span><span className="text-white/70 font-medium">{stats.totalRuns}</span> runs</span>
          )}
          {stats.totalSent > 0 && (
            <span><span className="text-green-400 font-medium">{stats.totalSent}</span> payments sent</span>
          )}
          {stats.totalFailed > 0 && (
            <span><span className="text-red-400 font-medium">{stats.totalFailed}</span> failed</span>
          )}
          {stats.totalXlm > 0 && (
            <span><span className="text-white/70 font-mono font-medium">{stats.totalXlm.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span> XLM total sent</span>
          )}
          {stats.lastRunAt && (
            <span>last activity <span className="text-white/60">{timeAgo(stats.lastRunAt)}</span></span>
          )}
        </div>
      )}

      {groups.length === 0 && !showNewGroup ? (
        <div className="text-center py-16 text-white/30">
          <p className="text-base">No auto-send groups yet.</p>
          <p className="text-sm mt-1">Create a group with a source wallet, add destinations with percentages, and schedule automatic sweeps.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {groups.map((g) => (
            <GroupCard key={g.id} groupId={g.id} runAllStatus={runAllStatus.get(g.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
