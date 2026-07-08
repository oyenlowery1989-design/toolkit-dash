# Telegram Channel Clustering View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `TelegramChannelClusters` component to `/persons` that aggregates asset groups sharing a Telegram channel, flagging channels attributed to more than one distinct Person.

**Architecture:** Single new read-only component mirroring `CrossAssetDestinations`'s shape exactly (collapsed card, toggle, table, shared-style badge). No schema/API changes — pure aggregation over `useAssetGroups()` + `usePersons()`.

**Tech Stack:** React, existing `components/ui/card` primitives, `next/link`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-08-persons-clustering-view-design.md`
- No new tables, routes, or fields.
- Channel normalization: `.trim().toLowerCase().replace(/^[@/]+/, "")`.

---

### Task 1: `TelegramChannelClusters` component + wire into PersonsPanel

**Files:**
- Create: `components/persons/TelegramChannelClusters.tsx`
- Modify: `components/persons/PersonsPanel.tsx`

**Interfaces:**
- Consumes: `useAssetGroups()` (`groups: AssetGroup[]`, each with `telegramChannel?: string`, `personId?: string`, `id`, `name`), `usePersons()` (`persons: Person[]`, each with `id`, `name`).
- Produces: `<TelegramChannelClusters />` — no props, self-contained.

- [ ] **Step 1: Write the component**

```tsx
// components/persons/TelegramChannelClusters.tsx
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAssetGroups } from "@/hooks/use-asset-groups";
import { usePersons } from "@/hooks/use-persons";

function normalizeChannel(raw: string): string {
  return raw.trim().toLowerCase().replace(/^[@/]+/, "");
}

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
```

- [ ] **Step 2: Wire it into `PersonsPanel.tsx`**

Add the import — replace:

```typescript
import { usePersons } from "@/hooks/use-persons";
```

with:

```typescript
import { usePersons } from "@/hooks/use-persons";
import { TelegramChannelClusters } from "@/components/persons/TelegramChannelClusters";
```

Render it below the persons grid — replace:

```tsx
      {persons.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No persons yet — add one above.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {persons.map((p) => (
            <PersonCard key={p.id} person={p} />
          ))}
        </div>
      )}
    </div>
  );
}
```

with:

```tsx
      {persons.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No persons yet — add one above.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {persons.map((p) => (
            <PersonCard key={p.id} person={p} />
          ))}
        </div>
      )}
      <TelegramChannelClusters />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual browser verification**

Run the same protocol as the prior Persons rounds: check no enabled auto-send/tiered-reward groups, `DB_PROVIDER="" npm run dev`, set `sb-logged-in` cookie.

1. Create 2 persons (A, B). Set the same `telegramChannel` (e.g. `testchannel`) on two different asset groups, attributing one to Person A and the other to Person B.
2. Open `/persons`, expand "Groups by Telegram Channel". Confirm one row for `@testchannel` listing both groups, "mixed persons" badge shown, "Attributed To" shows both names.
3. Set a third group's channel to the same value but leave it unattributed (no person). Confirm it appears in the same cluster's group list, and "Attributed To" still shows only A and B (not affected by the unattributed group).
4. Set a channel on a single group only, no other group sharing it. Confirm it appears as its own row, no badge.
5. Clean up all test values (groups, persons) afterward — this is real user data.

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: 165/166 (same pre-existing unrelated failure).

- [ ] **Step 6: Commit**

```bash
git add components/persons/TelegramChannelClusters.tsx components/persons/PersonsPanel.tsx
git commit -m "feat(persons): add Telegram-channel clustering view with mixed-persons anomaly badge"
```

---

## Post-implementation

Add a one-line note to CLAUDE.md's `persons` Module Inventory row: Telegram-channel clustering view added (`TelegramChannelClusters.tsx`), person-based clustering covered by each Person card's existing group list — no separate view needed.
