import { describe, expect, it } from "vitest";
import { cancelActiveRows } from "@/components/asset-sales/state";

describe("cancelActiveRows", () => {
  it("marks active rows cancelled without changing terminal rows", () => {
    const done = { id: 1, status: "done" as const };
    const failed = { id: 2, status: "error" as const, error: "Horizon failed" };

    expect(
      cancelActiveRows([
        { id: 0, status: "scanning" as const },
        done,
        failed,
      ]),
    ).toEqual([
      { id: 0, status: "error", error: "Scan cancelled." },
      done,
      failed,
    ]);
  });
});
