import { clerkMiddleware } from "@clerk/nextjs/server";
import { type NextFetchEvent, type NextRequest, NextResponse } from "next/server";

// The flag is fixed at build and the secret is read at run: a deploy that lost its secret must degrade, not answer 500.
const enabled = process.env.NEXT_PUBLIC_ACCOUNTS === "1" && Boolean(process.env.CLERK_SECRET_KEY);

const parties = (process.env.CLERK_AUTHORIZED_PARTIES ?? "")
  .split(",")
  .map((party) => party.trim())
  .filter(Boolean);

const clerk = enabled ? clerkMiddleware(parties.length > 0 ? { authorizedParties: parties } : {}) : null;

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  return clerk ? clerk(request, event) : NextResponse.next();
}

// "/" and "/pt-br" stay out, because a matched route pays a function invocation and can take a Clerk redirect on a document load.
export const config = {
  matcher: [
    "/api/:path*",
    "/me/:path*",
    "/settings/:path*",
    "/welcome/:path*",
    "/admin/:path*",
    "/sign-in/:path*",
    "/sign-up/:path*",
    "/__clerk/:path*",
    "/pt-br/:section(me|settings|welcome|admin|sign-in|sign-up)/:path*",
  ],
};
