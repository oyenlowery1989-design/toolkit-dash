import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ recipient: "GAMMBVZRMZE33O46HKLXOTOV5GOL5Y5RRC4SCMR53SSNQJXLJ6LNVCNJ" }));
vi.mock("@/lib/settings", () => ({ useSettings: () => ({ settings: { adPaymentRecipient: mocks.recipient } }) }));

import { AdPaymentsPanel } from "@/components/ad-payments/AdPaymentsPanel";

describe("AdPaymentsPanel", () => {
  it("loads compact payment reviews instead of the saved-analysis cache", () => {
    const html = renderToStaticMarkup(React.createElement(AdPaymentsPanel));
    expect(html).toContain("Loading payment review…");
  });
});
