import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: state.lookup }));
vi.mock("node:https", () => ({ request: state.request }));
import { fetchPinnedToml } from "@/lib/safe-toml-fetch";
afterEach(() => { state.lookup.mockReset(); state.request.mockReset(); vi.useRealTimers(); });
it("pins the socket to the validated DNS answer and preserves HTTPS hostname validation", async () => {
  state.lookup.mockResolvedValue([{ address: "1.1.1.1", family: 4 }]);
  state.request.mockImplementation((url, options) => {
    expect(url.hostname).toBe("public.example"); expect(options.rejectUnauthorized).not.toBe(false); expect(options.agent).toBe(false);
    options.lookup("public.example", {}, (error: unknown, address: string) => { expect(error).toBeNull(); expect(address).toBe("1.1.1.1"); });
    const req = new EventEmitter() as any;
    req.end = () => {
      const response = new EventEmitter() as any; response.statusCode = 200; response.headers = {}; response.destroy = () => {};
      req.emit("response", response); response.emit("data", Buffer.from("VERSION=\"2.0.0\"")); response.emit("end"); req.emit("close");
    };
    return req;
  });
  expect((await fetchPinnedToml(new URL("https://public.example/.well-known/stellar.toml"))).body).toContain("VERSION");
  expect(state.lookup).toHaveBeenCalledOnce(); // socket uses the pinned callback, not another DNS lookup
});
it("rejects mixed public/private answers before creating a connection", async () => {
  state.lookup.mockResolvedValue([{ address: "1.1.1.1", family: 4 }, { address: "127.0.0.1", family: 4 }]);
  await expect(fetchPinnedToml(new URL("https://public.example/"))).rejects.toThrow("non-public"); expect(state.request).not.toHaveBeenCalled();
});
it("bounds stalled DNS resolution before any socket is opened", async () => {
  vi.useFakeTimers();
  state.lookup.mockReturnValue(new Promise(() => {}));
  const rejection = expect(fetchPinnedToml(new URL("https://public.example/"))).rejects.toThrow("DNS lookup timed out");
  await vi.advanceTimersByTimeAsync(8000);
  await rejection;
  expect(state.request).not.toHaveBeenCalled();
});
