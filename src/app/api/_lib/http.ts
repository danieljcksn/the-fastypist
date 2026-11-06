import { auth, clerkClient } from "@clerk/nextjs/server";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import type { z } from "zod";
import { DatabaseNotConfigured } from "@/db/client";
import { TicketConfigError } from "@/server/tickets";
import { readCapped } from "@/server/verify";
import { ACCOUNTS } from "@/lib/accounts-flag";

const RETRY_AFTER_SECONDS = 30;
const JSON_BODY_MAX_BYTES = 16 * 1024;

const NO_STORE = { "Cache-Control": "no-store" };

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

export const problem = (error: string, status: number): Response => json({ error }, status);

/** A null user is a stale token as often as a signed-out one, so this is never read as a guest: the client retries with a fresh one. */
export const signInAgain = (): Response => json({ error: "signed-out", retry: true }, 401);

export const unavailable = (): Response => json({ error: "unavailable" }, 503, { "Retry-After": String(RETRY_AFTER_SECONDS) });

// Connection errors, and Postgres's classes 08 (connection), 53 (resources) and 57P (shutting down).
const DOWN_CODES = /^(ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|08|53|57P)/;
const DOWN_MESSAGE = /timeout exceeded when trying to connect|connection terminated|connection timeout/i;

export function isDatabaseDown(error: unknown): boolean {
  for (let e: unknown = error; e instanceof Error; e = e.cause) {
    if (e instanceof DatabaseNotConfigured) return true;
    const code = (e as Error & { code?: unknown }).code;
    if (typeof code === "string" && DOWN_CODES.test(code)) return true;
    if (DOWN_MESSAGE.test(e.message)) return true;
  }
  return false;
}

/** Answers every failure itself: nothing a handler throws reaches the platform's error page, or a client's parser. */
export function route<C>(handler: (request: Request, context: C) => Promise<Response>) {
  return async (request: Request, context: C): Promise<Response> => {
    try {
      // Cache Components prerenders any GET that reads nothing at run time, and these must never become a static answer.
      await connection();
      return await handler(request, context);
    } catch (error) {
      unstable_rethrow(error);
      if (isDatabaseDown(error) || error instanceof TicketConfigError) {
        console.error("api unavailable", new URL(request.url).pathname, error instanceof TicketConfigError ? error.message : "database");
        return unavailable();
      }
      // Drizzle's own message lists the bound parameters, which are personal data. Its cause is what actually went wrong.
      const reason = error instanceof Error && error.cause instanceof Error ? error.cause : error;
      console.error("api failed", new URL(request.url).pathname, reason instanceof Error ? reason.message : "unknown");
      return problem("failed", 500);
    }
  };
}

export type AuthRoute<C> = (request: Request, context: C & { userId: string }) => Promise<Response>;

/** Reads the session or the Bearer token, whichever the request carries: the proxy authenticated it and auth() reads the result. */
export function authed<C>(handler: AuthRoute<C>) {
  return route<C>(async (request, context) => {
    if (!ACCOUNTS) return problem("accounts-off", 404);
    const { userId } = await auth();
    if (!userId) return signInAgain();
    return handler(request, { ...context, userId });
  });
}

/** In every admin handler, from Clerk rather than from the token, so a removed role stops working at the next request. */
export function adminOnly<C>(handler: AuthRoute<C>) {
  return authed<C>(async (request, context) => {
    const client = await clerkClient();
    const user = await client.users.getUser(context.userId);
    if (user.publicMetadata.role !== "admin") return problem("forbidden", 403);
    return handler(request, context);
  });
}

export async function readJson<T extends z.ZodType>(request: Request, schema: T, cap = JSON_BODY_MAX_BYTES): Promise<z.infer<T> | null> {
  const bytes = await readCapped(request.body, cap);
  if (bytes === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
