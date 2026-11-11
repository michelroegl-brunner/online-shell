import NextAuth from "next-auth";
import { NextResponse } from "next/server";

import { homeFor, isStaff } from "~/lib/roles";
import { authConfigEdge } from "~/server/auth/config.edge";

const { auth } = NextAuth(authConfigEdge);

export default auth((req) => {
  const { nextUrl } = req;
  const user = req.auth?.user;

  if (!user) {
    const url = new URL("/auth/signin", nextUrl);
    url.searchParams.set("callbackUrl", nextUrl.pathname + nextUrl.search);
    return NextResponse.redirect(url);
  }

  // /admin is staff-only; students get bounced to their home.
  if (nextUrl.pathname.startsWith("/admin") && !isStaff(user.role)) {
    return NextResponse.redirect(new URL(homeFor(user.role), nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/learn/:path*", "/admin/:path*"],
};
