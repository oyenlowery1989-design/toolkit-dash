"use client";

import { useState } from "react";
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
import { Save } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import {
  useSettings,
  HORIZON_URLS,
  type Network,
} from "@/lib/settings";

export default function SettingsPage() {
  const { settings, updateSettings } = useSettings();
  const { theme, setTheme } = useTheme();

  const [network, setNetwork] = useState<Network>(settings.network);
  const [workerThreads, setWorkerThreads] = useState(String(settings.workerThreads));
  const [notifications, setNotifications] = useState(settings.notifications);

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
