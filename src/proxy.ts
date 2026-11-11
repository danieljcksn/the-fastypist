import { clerkClient, clerkMiddleware } from "@clerk/nextjs/server";
import { type NextFetchEvent, type NextRequest, NextResponse } from "next/server";

// The flag is fixed at build and the secret is read at run: a deploy that lost its secret must degrade, not answer 500.
const enabled = process.env.NEXT_PUBLIC_ACCOUNTS === "1" && Boolean(process.env.CLERK_SECRET_KEY);

const parties = (process.env.CLERK_AUTHORIZED_PARTIES ?? "")
  .split(",")
  .map((party) => party.trim())
  .filter(Boolean);

const ADMIN_PAGE = /^\/(pt-br\/)?admin(\/|$)/;

async function isAdmin(userId: string): Promise<boolean> {
  try {
    const user = await (await clerkClient()).users.getUser(userId);
    return user.publicMetadata.role === "admin";
  } catch {
    return false;
  }
}

// The page streams, so a notFound() inside it can only answer 200. Anyone who isn't an admin is sent to the
// catch-all route, which 404s before the first byte, and never learns the page exists.
const clerk = enabled
  ? clerkMiddleware(
      async (auth, request) => {
        const admin = ADMIN_PAGE.exec(request.nextUrl.pathname);
        if (!admin) return;
        const { userId } = await auth();
        if (userId && (await isAdmin(userId))) return;
        return NextResponse.rewrite(new URL(admin[1] ? "/pt-br/admin-missing" : "/en/admin-missing", request.url));
      },
      parties.length > 0 ? { authorizedParties: parties } : {},
    )
  : null;

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
