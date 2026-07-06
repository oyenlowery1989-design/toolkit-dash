"use client";

import { useState } from "react";
import { StrKey } from "stellar-sdk";
import { Loader2, Trash2, ExternalLink, CheckCheck } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ShortAddress } from "@/components/shared/ShortAddress";
import { useSettings } from "@/lib/settings";
import { timeAgo } from "@/lib/stellar-helpers";
import { useTracerWatchlist } from "@/hooks/use-tracer-watchlist";
import { useTracerWatchEvents } from "@/hooks/use-tracer-watch-events";
import { useKnownIntermediaries } from "@/hooks/use-known-intermediaries";

export function WatchlistTab() {
  const { settings } = useSettings();
  const { entries, isLoaded: watchlistLoaded, addWatch, updateWatch, removeWatch } = useTracerWatchlist();
  const { events, isLoaded: eventsLoaded, unseenCount, markSeen, markAllSeen } = useTracerWatchEvents();
  const { entries: knownIntermediaries } = useKnownIntermediaries();

  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [pickerId, setPickerId] = useState("");

  const isLoaded = watchlistLoaded && eventsLoaded;

  const alreadyWatched = (addr: string) =>
    entries.some((e) => e.address === addr && e.network === settings.network);

  const handleAdd = () => {
    const trimmed = address.trim();
    if (!StrKey.isValidEd25519PublicKey(trimmed)) {
      setAddError("Enter a valid Stellar address (G...)");
      return;
    }
    setAddError(null);
    addWatch({ address: trimmed, label: label.trim(), network: settings.network });
    setAddress("");
    setLabel("");
  };

  const handleAddFromPicker = () => {
    const picked = knownIntermediaries.find((k) => k.address === pickerId);
    if (!picked) return;
    addWatch({ address: picked.address, label: picked.name, network: settings.network });
    setPickerId("");
  };

  if (!isLoaded) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Watch an Address</CardTitle>
          <CardDescription>
            Get notified when a watched address funds a new account (`create_account`). Polls every 5 minutes
            (local server only).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              placeholder="G... address to watch"
              value={address}
              onChange={(e) => {
                setAddress(e.target.value);
                setAddError(null);
              }}
              className="font-mono text-xs sm:flex-1"
            />
            <Input
              placeholder="Label (optional)"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="sm:w-56"
            />
            <Button onClick={handleAdd} disabled={!address.trim()}>
              Add
            </Button>
          </div>
          {addError && <p className="text-sm text-destructive">{addError}</p>}

          {knownIntermediaries.length > 0 && (
            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              <Select value={pickerId} onValueChange={setPickerId}>
                <SelectTrigger className="sm:w-72">
                  <SelectValue placeholder="Add from Known Intermediaries…" />
                </SelectTrigger>
                <SelectContent>
                  {knownIntermediaries.map((k) => (
                    <SelectItem key={k.address} value={k.address} disabled={alreadyWatched(k.address)}>
                      {k.name} — {k.address.slice(0, 4)}…{k.address.slice(-4)}
                      {alreadyWatched(k.address) ? " (watched)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={handleAddFromPicker} disabled={!pickerId}>
                Add Selected
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Watched Addresses</CardTitle>
          <CardDescription>Polls every 5 minutes (local server only).</CardDescription>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No addresses watched yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border">
                    <th className="py-2 pr-4 font-medium">Address</th>
                    <th className="py-2 pr-4 font-medium">Label</th>
                    <th className="py-2 pr-4 font-medium">Network</th>
                    <th className="py-2 pr-4 font-medium">Enabled</th>
                    <th className="py-2 pr-4 font-medium">Last Checked</th>
                    <th className="py-2 pr-4 font-medium text-right">Remove</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((w) => (
                    <tr key={w.id} className="border-b border-border/50 last:border-0">
                      <td className="py-2 pr-4">
                        <ShortAddress address={w.address} network={settings.network} />
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">{w.label || "—"}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{w.network}</td>
                      <td className="py-2 pr-4">
                        <Switch
                          checked={w.enabled}
                          onCheckedChange={(checked) => updateWatch(w.id, { enabled: checked })}
                        />
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">
                        {w.lastCheckedAt ? timeAgo(w.lastCheckedAt) : "never"}
                      </td>
                      <td className="py-2 pr-4 text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => removeWatch(w.id)}
                          aria-label="Remove watch"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              Events
              {unseenCount > 0 && (
                <span className="inline-flex items-center justify-center rounded-full bg-primary/15 text-primary text-xs font-semibold h-5 min-w-5 px-1.5">
                  {unseenCount}
                </span>
              )}
            </CardTitle>
            <CardDescription>New accounts created by watched addresses.</CardDescription>
          </div>
          {unseenCount > 0 && (
            <Button variant="outline" size="sm" onClick={() => markAllSeen()}>
              <CheckCheck className="h-3.5 w-3.5 mr-1.5" />
              Mark all seen
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No events yet — new account creations will appear here after the next poll.
            </p>
          ) : (
            <div className="space-y-2">
              {events.map((ev) => (
                <div
                  key={ev.id}
                  onClick={() => !ev.seen && markSeen(ev.id)}
                  className={`flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border px-3 py-2 text-sm ${
                    ev.seen
                      ? "border-border/50"
                      : "border-l-4 border-l-primary border-y-border/50 border-r-border/50 bg-primary/5 cursor-pointer"
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground text-xs">Created</span>
                    <ShortAddress address={ev.accountCreated} network={settings.network} />
                  </div>
                  {ev.funder && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground text-xs">Funder</span>
                      <ShortAddress address={ev.funder} network={settings.network} />
                    </div>
                  )}
                  {ev.amount && (
                    <span className="text-muted-foreground text-xs">{ev.amount} XLM</span>
                  )}
                  <span className="text-muted-foreground text-xs">
                    {ev.ledgerTime ? timeAgo(ev.ledgerTime) : ""}
                  </span>
                  <a
                    href={`/tracer-v2?addresses=${encodeURIComponent(ev.accountCreated)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    Trace <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
