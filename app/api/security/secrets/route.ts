import { NextRequest, NextResponse } from "next/server";
import { inspectAndMigrateLegacySecrets } from "@/lib/secret-migration";
import { requireAuth } from "@/lib/supabase-server";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ tables: await inspectAndMigrateLegacySecrets(auth.userId, false) });
  } catch (error) {
    console.error("[security/secrets] inspection failed:", error);
    return NextResponse.json({ error: "Unable to inspect signing-key storage" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  try {
    const tables = await inspectAndMigrateLegacySecrets(auth.userId, true);
    return NextResponse.json({ ok: true, tables });
  } catch (error) {
    console.error("[security/secrets] migration failed:", error);
    return NextResponse.json({ error: "Signing-key migration failed; verify the encryption key" }, { status: 500 });
  }
}
