import { expect, it } from "vitest";
import { readBoundedText } from "@/lib/http-body";
it.each([undefined, "1"])("enforces actual bytes for chunked/understated body (length=%s)", async (length) => {
  const response = new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("12345")); c.enqueue(new TextEncoder().encode("67890")); c.close(); } }), { headers: length ? { "content-length": length } : {} });
  await expect(readBoundedText(response, 8)).rejects.toThrow("too large");
});
it("accepts an exactly bounded body", async () => expect(await readBoundedText(new Response("12345678"), 8)).toBe("12345678"));
