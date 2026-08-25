import { describe, expect, it } from "vitest";
import { isBlockedIp } from "@/lib/safe-toml-fetch";

describe("isBlockedIp", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "::1",
    "fd00::1",
    "fe80::1",
  ])("blocks private or special address %s", (address) => {
    expect(isBlockedIp(address)).toBe(true);
  });

  it.each(["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])("allows public address %s", (address) => {
    expect(isBlockedIp(address)).toBe(false);
  });
});
