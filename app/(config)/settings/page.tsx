"use client";

import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Save, Download, Upload, RefreshCw, Database, CheckCircle2, XCircle } from "lucide-react";
import { authHeaders } from "@/lib/db-client";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import {
  useSettings,
  HORIZON_URLS,
  type Network,
} from "@/lib/settings";

interface DbStatus {
  supabaseConfigured: boolean;
  supabaseOnly: boolean;
  provider: string;
}

export default function SettingsPage() {
  const { settings, updateSettings } = useSettings();
  const { theme, setTheme } = useTheme();

  const [network, setNetwork] = useState<Network>(settings.network);
  const [workerThreads, setWorkerThreads] = useState(String(settings.workerThreads));
  const [notifications, setNotifications] = useState(settings.notifications);

  const [dbStatus, setDbStatus] = useState<DbStatus | null>(null);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    fetch("/api/db/status")
      .then((r) => r.json())
      .then(setDbStatus)
      .catch(() => null);
  }, []);

  const handleNotificationsChange = async (enabled: boolean) => {
    if (enabled && "Notification" in window) {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return;
    }
    setNotifications(enabled);
  };

  const handleSaveNetwork = () => {
    updateSettings({ network });
    toast.success("Network settings saved");
  };

  const handleSaveDeveloper = () => {
    updateSettings({ workerThreads: parseInt(workerThreads) });
    toast.success("Developer settings saved");
  };

  const handleSaveNotifications = (enabled: boolean) => {
    updateSettings({ notifications: enabled });
  };

  const handlePushToSupabase = async () => {
    setSyncing(true);
    setSyncStatus(null);
    try {
      const r = await fetch("/api/db/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ source: "local" }),
      });
      const data = await r.json();
      if (data.ok) {
        setSyncStatus("success");
        toast.success("Local data pushed to Supabase");
      } else {
        setSyncStatus("error");
        toast.error("Push failed: " + (data.errors?.join(", ") ?? "unknown error"));
      }
    } catch {
      setSyncStatus("error");
      toast.error("Push failed — network error");
    } finally {
      setSyncing(false);
    }
  };

  const handleRestoreFromSupabase = async () => {
    setRestoring(true);
    setSyncStatus(null);
    try {
      const r = await fetch("/api/db/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ source: "supabase" }),
      });
      const data = await r.json();
      if (data.ok) {
        setSyncStatus("success");
        toast.success("Restored from Supabase to local SQLite");
      } else {
        setSyncStatus("error");
        toast.error("Restore failed");
      }
    } catch {
      setSyncStatus("error");
      toast.error("Restore failed — network error");
    } finally {
      setRestoring(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const r = await fetch("/api/db/export", { headers: authHeaders() });
      const data = await r.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `stellar-toolkit-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Backup downloaded");
    } catch {
      toast.error("Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-2">
          Manage your dashboard preferences and network connections.
        </p>
      </div>

      <div className="grid gap-6">
        {/* General */}
        <Card>
          <CardHeader>
            <CardTitle>General</CardTitle>
            <CardDescription>
              Configure general application behavior.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Dark Mode</Label>
                <p className="text-xs text-muted-foreground">
                  Toggle between dark and light theme.
                </p>
              </div>
              <Switch
                checked={theme === "dark"}
                onCheckedChange={(checked) =>
                  setTheme(checked ? "dark" : "light")
                }
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="notifications-switch">Notifications</Label>
                <p className="text-xs text-muted-foreground">
                  Browser notifications when the address generator finds a
                  match.
                </p>
              </div>
              <Switch
                id="notifications-switch"
                checked={notifications}
                onCheckedChange={async (v) => {
                  await handleNotificationsChange(v);
                  handleSaveNotifications(v);
                }}
              />
            </div>
          </CardContent>
        </Card>

        {/* Network */}
        <Card>
          <CardHeader>
            <CardTitle>Network</CardTitle>
            <CardDescription>
              Stellar network connection settings.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Default Network</Label>
                <Select
                  value={network}
                  onValueChange={(v: Network) => setNetwork(v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="public">Public Network</SelectItem>
                    <SelectItem value="testnet">Testnet</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="horizon-url">Horizon URL</Label>
                <Input
                  id="horizon-url"
                  value={HORIZON_URLS[network as "public" | "testnet"]}
                  readOnly
                  disabled
                  className="font-mono text-xs"
                  title="URL is determined by the selected network"
                />
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <Button onClick={handleSaveNetwork}>
              <Save className="mr-2 h-4 w-4" /> Save Changes
            </Button>
          </CardFooter>
        </Card>

        {/* Data & Backup */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Data & Backup
            </CardTitle>
            <CardDescription>
              Manage your local database and Supabase cloud backup.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Status */}
            <div className="flex items-center justify-between rounded-lg border px-4 py-3">
              <div className="space-y-0.5">
                <Label>Active database</Label>
                <p className="text-xs text-muted-foreground">
                  {dbStatus?.supabaseOnly
                    ? "Supabase (cloud — serverless mode)"
                    : "SQLite (local file)"}
                </p>
              </div>
              <span className="text-xs font-mono bg-muted px-2 py-1 rounded">
                {dbStatus?.provider ?? "…"}
              </span>
            </div>

            <div className="flex items-center justify-between rounded-lg border px-4 py-3">
              <div className="space-y-0.5">
                <Label>Supabase backup</Label>
                <p className="text-xs text-muted-foreground">
                  {dbStatus?.supabaseConfigured
                    ? "Connected — writes are synced automatically"
                    : "Not configured — add SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to .env.local"}
                </p>
              </div>
              {dbStatus === null ? (
                <span className="text-xs text-muted-foreground">…</span>
              ) : dbStatus.supabaseConfigured ? (
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              ) : (
                <XCircle className="h-5 w-5 text-muted-foreground" />
              )}
            </div>

            {/* Actions */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Button
                variant="outline"
                onClick={handlePushToSupabase}
                disabled={syncing || !dbStatus?.supabaseConfigured || dbStatus?.supabaseOnly}
                title={
                  !dbStatus?.supabaseConfigured
                    ? "Supabase not configured"
                    : dbStatus?.supabaseOnly
                    ? "Already running on Supabase"
                    : "Push all local SQLite data to Supabase"
                }
              >
                {syncing ? (
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                Push to Supabase
              </Button>

              <Button
                variant="outline"
                onClick={handleRestoreFromSupabase}
                disabled={restoring || !dbStatus?.supabaseConfigured || dbStatus?.supabaseOnly}
                title={
                  !dbStatus?.supabaseConfigured
                    ? "Supabase not configured"
                    : dbStatus?.supabaseOnly
                    ? "Already running on Supabase"
                    : "Restore all data from Supabase into local SQLite"
                }
              >
                {restoring ? (
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                Restore from Supabase
              </Button>

              <Button
                variant="outline"
                onClick={handleExport}
                disabled={exporting}
                title="Download a full JSON backup of your data"
              >
                {exporting ? (
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                Download Backup
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              <strong>Push to Supabase</strong> — one-time migration of local data to cloud.<br />
              <strong>Restore from Supabase</strong> — recover local DB if you lost your{" "}
              <code className="font-mono">stellar-toolkit.db</code> file.<br />
              <strong>Download Backup</strong> — save a JSON copy of all your data anywhere.
            </p>
          </CardContent>
        </Card>

        {/* Developer */}
        <Card>
          <CardHeader>
            <CardTitle>Developer</CardTitle>
            <CardDescription>Advanced settings for developers.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Max Worker Threads</Label>
              <Select value={workerThreads} onValueChange={setWorkerThreads}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1</SelectItem>
                  <SelectItem value="2">2</SelectItem>
                  <SelectItem value="4">4</SelectItem>
                  <SelectItem value="8">8</SelectItem>
                  <SelectItem value="16">16</SelectItem>
                  <SelectItem value="32">32</SelectItem>
                  <SelectItem value="64">64</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Parallel workers used for address generation. Your device has{" "}
                {typeof navigator !== "undefined"
                  ? (navigator.hardwareConcurrency ?? "?")
                  : "?"}{" "}
                logical CPU cores.
              </p>
            </div>
          </CardContent>
          <CardFooter>
            <Button onClick={handleSaveDeveloper}>
              <Save className="mr-2 h-4 w-4" /> Save Changes
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
