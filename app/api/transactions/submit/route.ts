import { readBoundedText } from "@/lib/http-body";
import { NextRequest, NextResponse } from "next/server";
import { Networks, TransactionBuilder } from "stellar-sdk";
import { requireAuth } from "@/lib/supabase-server";
import { executeMainnetTransaction } from "@/lib/mainnet-execution";
import { getErrorMessage } from "@/lib/stellar-helpers";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  try {
    const raw = await readBoundedText(new Response(req.body, { headers: req.headers }), 256_000);
    if (raw.length > 256_000) return NextResponse.json({ error: "Transaction too large" }, { status: 413 });
    const { xdr } = JSON.parse(raw);
    if (typeof xdr !== "string" || !xdr || xdr.length > 200_000) return NextResponse.json({ error: "Invalid transaction" }, { status: 400 });
    const tx = TransactionBuilder.fromXDR(xdr, Networks.PUBLIC);
    const result = await executeMainnetTransaction(tx);
    return NextResponse.json(result);
  } catch (error) {
    const upstream = (error as { response?: { status?: number; data?: { extras?: unknown } } })?.response;
    return NextResponse.json({ error: getErrorMessage(error), upstreamStatus: upstream?.status, extras: upstream?.data?.extras }, { status: 400 });
  }
}
