import type { AutoSendGroup } from "./types";

type Row = Record<string, unknown>;

/** Maps a raw `auto_send_groups` row + its `auto_send_destinations` rows to an `AutoSendGroup`.
 *  Shared by the run route (SQLite + Supabase) and the scheduler (SQLite + Supabase) so the
 *  row-shape mapping never drifts between the two. `dests` may be pre-filtered to this group
 *  or the full destinations table — either works since this filters by `group_id` itself. */
export function rowToGroup(g: Row, dests: Row[]): AutoSendGroup {
  return {
    id: g.id as string,
    name: g.name as string,
    network: (g.network as string) ?? "public",
    secretKey: (g.secret_key as string) ?? "",
    intervalMinutes: (g.interval_minutes as number) ?? null,
    enabled: Number(g.enabled) === 1,
    batchSend: Number(g.batch_send) === 1,
    batchMemo: (g.batch_memo as string) ?? undefined,
    minReserve: (g.min_reserve as number) ?? 10.0,
    minSenderThreshold: (g.min_sender_threshold as number) ?? 0,
    previewOnly: Number(g.preview_only) === 1,
    lastFailureAt: (g.last_failure_at as number) ?? undefined,
    createdAt: g.created_at as number,
    destinations: dests
      .filter((d) => d.group_id === g.id)
      .sort((a, b) => (a.position as number) - (b.position as number))
      .map((d) => ({
        id: d.id as string,
        groupId: d.group_id as string,
        destination: d.destination as string,
        percentage: (d.percentage as number) ?? 0,
        isRemainder: Number(d.is_remainder) === 1,
        paused: Number(d.is_paused) === 1,
        label: (d.label as string) ?? undefined,
        memo: (d.memo as string) ?? undefined,
        minThreshold: (d.min_threshold as number) ?? 0,
        maxCap: (d.max_cap as number) ?? 0,
        position: (d.position as number) ?? 0,
      })),
  };
}
