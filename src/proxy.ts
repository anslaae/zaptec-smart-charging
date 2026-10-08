import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { decryptSession } from "@/lib/auth/session";

const PUBLIC_ROUTES = ["/login"];

export default async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isPublicRoute = PUBLIC_ROUTES.includes(path);

  const token = request.cookies.get("session")?.value;
  const session = await decryptSession(token);
  const isAuthenticated = Boolean(session?.userId);

  if (!isPublicRoute && !isAuthenticated) {
    return NextResponse.redirect(new URL("/login", request.nextUrl));
  }

  if (isPublicRoute && isAuthenticated) {
    return NextResponse.redirect(new URL("/", request.nextUrl));
  }

  return NextResponse.next();
}

// This is an optimistic, cookie-only check. Real authorization still happens
// server-side in the DAL (src/lib/auth/dal.ts) for every page, action, and route.
//
// Also excludes the file-based metadata routes (manifest, icons) -- without
// this, an unauthenticated request for e.g. /manifest.webmanifest got
// redirected to /login, and the browser choked trying to parse the login
// page's HTML as the manifest's JSON.
//
// api/health is deliberately public too -- it's meant to be hit by an
// external uptime monitor with no way to log in, and it exposes nothing
// sensitive (build SHA, scheduler tick staleness, DB reachability).
export const config = {
  matcher: [
    "/((?!api/cron|api/webhooks|api/health|_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|manifest.webmanifest).*)",
  ],
};
