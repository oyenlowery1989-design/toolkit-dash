import { describe, expect, it } from "vitest";
import { Keypair } from "stellar-sdk";
import { parseGhostSenders } from "@/lib/bulk-payments/ghost-senders";

describe("ghost multi-sender wallet selection", () => {
  it("accepts manual keys and saved signing addresses, never watch-only or unknown addresses", () => {
    const manual = Keypair.random().secret();
    const saved = Keypair.random().publicKey();
    const watch = Keypair.random().publicKey();
    const unknown = Keypair.random().publicKey();
    const wallets = [
      { publicKey: saved, hasKey: true, secretKey: "" },
      { publicKey: watch, hasKey: false, secretKey: "" },
    ];
    expect(parseGhostSenders(`${manual}\n${saved}\n${watch}\n${unknown}`, wallets)).toEqual([manual, saved]);
  });
});
