import { describe, it, expect } from "vitest";
import { normalizeExternalUrl, resolveTelegramUrl } from "@/lib/asset-groups/links";

describe("normalizeExternalUrl", () => {
  it("prefixes https:// when no scheme is present", () => {
    expect(normalizeExternalUrl("example.com")).toBe("https://example.com");
  });

  it("leaves an existing https:// scheme untouched", () => {
    expect(normalizeExternalUrl("https://example.com")).toBe("https://example.com");
  });

  it("leaves an existing http:// scheme untouched", () => {
    expect(normalizeExternalUrl("http://example.com")).toBe("http://example.com");
  });

  it("trims whitespace before checking for a scheme", () => {
    expect(normalizeExternalUrl("  example.com  ")).toBe("https://example.com");
  });
});

describe("resolveTelegramUrl", () => {
  it("returns undefined when both channel and link are unset", () => {
    expect(resolveTelegramUrl(undefined, undefined)).toBeUndefined();
  });

  it("returns undefined when both are empty strings", () => {
    expect(resolveTelegramUrl("", "")).toBeUndefined();
  });

  it("derives a t.me URL from the channel name alone", () => {
    expect(resolveTelegramUrl("mychannel", undefined)).toBe("https://t.me/mychannel");
  });

  it("strips a leading @ from the channel name", () => {
    expect(resolveTelegramUrl("@mychannel", undefined)).toBe("https://t.me/mychannel");
  });

  it("prefers the explicit link over a derived channel URL", () => {
    expect(resolveTelegramUrl("ignored", "https://t.me/real")).toBe("https://t.me/real");
  });

  it("normalizes a scheme-less explicit link", () => {
    expect(resolveTelegramUrl(undefined, "t.me/mychannel")).toBe("https://t.me/mychannel");
  });
});
