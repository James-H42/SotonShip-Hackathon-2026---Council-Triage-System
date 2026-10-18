import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic gates: no officer cookie, no console; no resident cookie, no "My reports".
 * Pages, Server Actions and API routes still verify the signed session themselves.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const council = pathname === "/council" || pathname.startsWith("/council/");
  if (pathname === "/council/login") return NextResponse.next();
  const [cookie, login] = council ? ["st_officer", "/council/login"] : ["st_resident", "/resident/login"];
  if (!request.cookies.get(cookie)?.value) {
    const url = new URL(login, request.url);
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/council", "/council/:path*", "/my-reports", "/my-reports/:path*"],
};
