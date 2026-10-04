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
export const config = {
  matcher: ["/((?!api/cron|api/webhooks|_next/static|_next/image|favicon.ico).*)"],
};
