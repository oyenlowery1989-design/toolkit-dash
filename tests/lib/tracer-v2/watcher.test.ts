import { describe, it, expect, vi } from "vitest";
import { pollWatch } from "@/lib/tracer-v2/watcher";

const HORIZON = "https://horizon-testnet.stellar.org";
const ADDR = "GADDRESS";

function page(records: any[]) {
  return { _embedded: { records } };
}

describe("pollWatch", () => {
  it("seed (cursor null) returns no events and nextCursor from the single desc record", async () => {
    const fetchPage = vi.fn(async (url: string) => {
      expect(url).toContain(`/accounts/${ADDR}/operations`);
      expect(url).toContain("order=desc");
      expect(url).toContain("limit=1");
      return page([{ paging_token: "1000", account: "GX", funder: ADDR }]);
    });
    const result = await pollWatch(fetchPage, HORIZON, ADDR, null);
    expect(result.events).toEqual([]);
    expect(result.nextCursor).toBe("1000");
  });

  it("seed with an empty page returns nextCursor null", async () => {
    const fetchPage = vi.fn(async () => page([]));
    const result = await pollWatch(fetchPage, HORIZON, ADDR, null);
    expect(result.events).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });

  it("poll emits events only for records where record.funder === address", async () => {
    const fetchPage = vi.fn(async (url: string) => {
      expect(url).toContain("order=asc");
      expect(url).toContain("cursor=1000");
      return page([
        { paging_token: "1001", account: "GMATCH1", funder: ADDR, starting_balance: "5", transaction_hash: "tx1", created_at: "2026-01-01T00:00:00Z" },
        { paging_token: "1002", account: "GOTHER", funder: "GSOMEONE_ELSE", starting_balance: "9", transaction_hash: "tx2", created_at: "2026-01-01T00:01:00Z" },
        { paging_token: "1003", account: "GMATCH2", funder: ADDR, starting_balance: "3", transaction_hash: "tx3", created_at: "2026-01-01T00:02:00Z" },
      ]);
    });
    const result = await pollWatch(fetchPage, HORIZON, ADDR, "1000");
    expect(result.events).toHaveLength(2);
    expect(result.events.map((e) => e.accountCreated)).toEqual(["GMATCH1", "GMATCH2"]);
    expect(result.events[0]).toMatchObject({
      eventType: "create_account",
      accountCreated: "GMATCH1",
      funder: ADDR,
      amount: "5",
      txHash: "tx1",
      ledgerTime: "2026-01-01T00:00:00Z",
    });
  });

  it("poll advances nextCursor to the last record's paging_token even when unmatched", async () => {
    const fetchPage = vi.fn(async () =>
      page([
        { paging_token: "2001", account: "GA", funder: "GOTHER" },
        { paging_token: "2002", account: "GB", funder: ADDR },
      ]),
    );
    const result = await pollWatch(fetchPage, HORIZON, ADDR, "2000");
    expect(result.nextCursor).toBe("2002");
  });

  it("poll on an empty page keeps the cursor unchanged", async () => {
    const fetchPage = vi.fn(async () => page([]));
    const result = await pollWatch(fetchPage, HORIZON, ADDR, "3000");
    expect(result.events).toEqual([]);
    expect(result.nextCursor).toBe("3000");
  });
});
