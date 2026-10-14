import { expect, it } from "vitest";
import { streamJson } from "@/lib/json-stream";

it("streams backups larger than the function payload cap without dropping rows or Unicode", async () => {
  const payload = { source: "sqlite", saved_analyses: [{ id: "one", result: "🪐".repeat(1_300_000) }, { id: "two", result: { code: "wUSDC" } }], absent: undefined };
  const response = streamJson(payload);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.has("content-length")).toBe(false);
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    expect(next.value.byteLength).toBeLessThanOrEqual(64 * 1024);
    chunks.push(next.value);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  expect(parsed).toEqual(JSON.parse(JSON.stringify(payload)));
});
