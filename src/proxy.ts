import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

// UX-level gate only: bounces clearly-unauthenticated visitors to /login.
// It checks cookie *presence*, not validity — the security boundary is the
// server-side session check in every page/handler (see src/lib/session.ts).
export function proxy(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/teach/:path*", "/admin/:path*"],
};
