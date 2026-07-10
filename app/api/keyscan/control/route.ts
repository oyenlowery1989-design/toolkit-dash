import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase-server";
import { startKeyScanLoopRun, stopKeyScanLoopRun, updateKeyScanConfig, getKeyScanState } from "@/lib/key-scanner/loop";

// POST — Body: { action: "start" | "stop" | "configure", network?, pacedRps?, concurrency?, resumeOnBoot? }
// Mutates the in-process loop singleton directly and persists via a checkpoint —
// only meaningful on a persistent Node process (local/self-hosted), never on Vercel.
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  if (process.env.VERCEL) {
    return NextResponse.json(
      { ok: false, error: "Key Scanner requires a persistent server process — not available on Vercel." },
      { status: 400 },
    );
  }

  let b: any;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const { action, network, pacedRps, concurrency, resumeOnBoot } = b ?? {};
  if (network !== undefined || pacedRps !== undefined || concurrency !== undefined || resumeOnBoot !== undefined) {
    updateKeyScanConfig({ network, pacedRps, concurrency, resumeOnBoot });
  }

  if (action === "start") startKeyScanLoopRun();
  else if (action === "stop") stopKeyScanLoopRun();
  else if (action !== "configure" && action !== undefined) {
    return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
  }

  return NextResponse.json({ ok: true, state: getKeyScanState() });
}
