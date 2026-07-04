import { NextRequest, NextResponse } from "next/server";

/**
 * Auth gate middleware.
 *
 * Only active when NEXT_PUBLIC_SUPABASE_URL is set (deployed / Supabase mode).
 * Local dev (no env var) → passes through everything, no auth required.
 *
 * Gate: pages redirect to /login if the `sb-logged-in` cookie is absent.
 * API routes return 401 (they verify the JWT themselves via requireAuth).
 * The cookie is a lightweight presence indicator — actual data security
 * comes from the JWT verification in each API route.
 */
export function middleware(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return NextResponse.next(); // local dev, no auth

  const { pathname } = req.nextUrl;

  // Always allow auth page and static assets
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const isLoggedIn = req.cookies.get("sb-logged-in")?.value === "1";
  if (!isLoggedIn) {
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
