import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  groupRead: vi.fn(),
  childRead: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({
  isSupabaseOnly: () => true,
  getSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          not: () => ({ order: () => ({ range: mocks.groupRead }) }),
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/supabase-read-all", () => ({ readAllChildRows: mocks.childRead }));

import { refreshScheduler, startScheduler } from "@/lib/auto-send/scheduler";

const group = { id: "g1", name: "Scheduled", enabled: 1, interval_minutes: 1440, created_at: 1 };

beforeEach(() => {
  delete process.env.VERCEL;
  global._autoSendStarted = false;
  global._autoSendTasks = undefined;
  mocks.groupRead.mockReset();
  mocks.childRead.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  for (const task of global._autoSendTasks?.values() ?? []) task.stop();
  global._autoSendTasks?.clear();
  global._autoSendStarted = false;
  vi.restoreAllMocks();
});

describe("Auto-Send scheduler reads", () => {
  it("keeps an existing schedule when a later database read fails", async () => {
    mocks.groupRead.mockResolvedValueOnce({ data: [group], count: 1, error: null })
      .mockResolvedValueOnce({ data: null, count: null, error: { message: "offline" } });
    mocks.childRead.mockResolvedValue({ data: [], error: null });
    startScheduler();
    await vi.waitFor(() => expect(global._autoSendTasks?.has("g1")).toBe(true));

    const task = global._autoSendTasks!.get("g1");
    refreshScheduler();
    await vi.waitFor(() => expect(console.error).toHaveBeenCalled());
    expect(global._autoSendTasks!.get("g1")).toBe(task);
  });

  it("does not schedule a group with an incomplete destination read", async () => {
    mocks.groupRead.mockResolvedValue({ data: [group], count: 1, error: null });
    mocks.childRead.mockResolvedValue({ data: null, error: { message: "destination query failed" } });
    startScheduler();
    await vi.waitFor(() => expect(console.error).toHaveBeenCalled());
    expect(global._autoSendTasks?.size).toBe(0);
  });
});
