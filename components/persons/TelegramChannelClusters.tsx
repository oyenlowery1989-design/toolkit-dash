// components/persons/TelegramChannelClusters.tsx
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAssetGroups } from "@/hooks/use-asset-groups";
import { usePersons } from "@/hooks/use-persons";
import { normalizeChannel } from "@/lib/asset-groups/links";

export function TelegramChannelClusters() {
  const [show, setShow] = useState(false);
  const { groups } = useAssetGroups();
  const { persons } = usePersons();

  const clusters = useMemo(() => {
    const map = new Map<string, { raw: string; groupIds: { id: string; name: string }[]; personIds: Set<string> }>();
    for (const g of groups) {
      if (!g.telegramChannel) continue;
      const key = normalizeChannel(g.telegramChannel);
      if (!key) continue;
      const existing = map.get(key);
      if (existing) {
        existing.groupIds.push({ id: g.id, name: g.name });
        if (g.personId) existing.personIds.add(g.personId);
      } else {
        map.set(key, {
          raw: g.telegramChannel,
          groupIds: [{ id: g.id, name: g.name }],
          personIds: new Set(g.personId ? [g.personId] : []),
        });
      }
    }
    return [...map.entries()]
      .map(([key, v]) => ({
        key,
        raw: v.raw,
        groups: v.groupIds,
        personNames: [...v.personIds].map((pid) => persons.find((p) => p.id === pid)?.name ?? "Unknown person"),
      }))
      .sort((a, b) => b.groups.length - a.groups.length || b.personNames.length - a.personNames.length);
  }, [groups, persons]);

  if (clusters.length === 0) return null;

  const mixed = clusters.filter((c) => c.personNames.length > 1);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Groups by Telegram Channel</CardTitle>
            <CardDescription className="text-xs mt-0.5">
              Asset groups sharing a Telegram channel — possibly the same operator.
              {mixed.length > 0 && (
                <span className="ml-1 font-semibold text-yellow-500">
                  {mixed.length} channel{mixed.length > 1 ? "s" : ""} with mixed persons found.
                </span>
              )}
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setShow((v) => !v)}>
            {show ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>
      {show && (
        <CardContent className="pt-0">
          <div className="overflow-x-auto border rounded-md">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/40 text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">Channel</th>
                  <th className="px-3 py-2 text-right font-medium">Groups</th>
                  <th className="px-3 py-2 text-left font-medium">Attributed To</th>
                </tr>
              </thead>
              <tbody>
                {clusters.map((c) => (
                  <tr key={c.key} className={`border-b last:border-0 ${c.personNames.length > 1 ? "bg-yellow-500/5" : ""}`}>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span>@{c.key}</span>
                        {c.personNames.length > 1 && (
                          <span className="text-[9px] uppercase tracking-wide font-semibold px-1 py-px rounded border border-yellow-400/40 bg-yellow-400/10 text-yellow-400">
                            mixed persons
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">
                      <div className="flex flex-col items-end gap-0.5">
                        {c.groups.map((g) => (
                          <Link key={g.id} href={`/groups?open=${g.id}`} className="hover:underline">
                            {g.name}
                          </Link>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {c.personNames.length > 0 ? c.personNames.join(", ") : <span className="text-muted-foreground italic">none</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
