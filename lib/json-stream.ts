/** Stream JSON in bounded chunks, preserving the complete backup/detail payload. */
export function streamJson(value: unknown): Response {
  const encoder = new TextEncoder();
  function* parts(current: unknown): Generator<string> {
    if (Array.isArray(current)) {
      yield "[";
      for (let i = 0; i < current.length; i++) {
        if (i) yield ",";
        yield JSON.stringify(current[i] ?? null) ?? "null";
      }
      yield "]";
    } else if (current && typeof current === "object" && !(current instanceof Date)) {
      yield "{";
      let first = true;
      for (const [key, item] of Object.entries(current)) {
        if (item === undefined) continue;
        if (!first) yield ",";
        first = false;
        yield `${JSON.stringify(key)}:`;
        if (Array.isArray(item)) yield* parts(item);
        else yield JSON.stringify(item) ?? "null";
      }
      yield "}";
    } else {
      const encoded = JSON.stringify(current) ?? "null";
      // Slicing encoded bytes avoids splitting a UTF-16 surrogate pair.
      yield encoded;
    }
  }
  const iterator = parts(value);
  let bytes: Uint8Array | undefined;
  let offset = 0;
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!bytes || offset >= bytes.length) {
        const next = iterator.next();
        if (next.done) { controller.close(); return; }
        bytes = encoder.encode(next.value);
        offset = 0;
      }
      controller.enqueue(bytes.subarray(offset, offset + 64 * 1024));
      offset += 64 * 1024;
    },
    cancel() { iterator.return(undefined); },
  }), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
