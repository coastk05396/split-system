import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { z } from "zod";
import { ApiError } from "./errors.js";

/** Parses a JSON body with a shared Zod schema; a bad body is 400 VALIDATION_FAILED. */
export async function parseBody<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  // A form on another site can post text/plain without a CORS preflight; JSON cannot be.
  if (!/^application\/json\s*(;|$)/i.test(c.req.header("Content-Type") ?? "")) {
    throw new ApiError("VALIDATION_FAILED");
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new ApiError("VALIDATION_FAILED");
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ApiError("VALIDATION_FAILED", {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.map(String),
        message: issue.message,
      })),
    });
  }
  return result.data;
}

const IDEMPOTENCY_KEY = /^[\x21-\x7e]{1,128}$/;
const UPDATED_AT = /^\d{1,16}$/;

/**
 * Reads the `Idempotency-Key` header that Expense and Settlement creates must carry.
 * The key is stored on the row under a UNIQUE index, so a repeat cannot insert twice.
 */
export function requireIdempotencyKey(c: Context): string {
  const key = c.req.header("Idempotency-Key");
  if (key === undefined || !IDEMPOTENCY_KEY.test(key)) {
    throw new ApiError("IDEMPOTENCY_KEY_REQUIRED");
  }
  return key;
}

/** Reads `If-Match: <updated_at>` (milliseconds since the epoch) that every edit sends. */
export function requireIfMatch(c: Context): number {
  const value = c.req.header("If-Match");
  if (value === undefined || !UPDATED_AT.test(value)) {
    throw new ApiError("IF_MATCH_REQUIRED");
  }
  return Number(value);
}

/** Throws 409 EDIT_CONFLICT carrying the current row when someone else changed it first. */
export function assertIfMatch(expected: number, current: { updatedAt: number }): void {
  if (current.updatedAt !== expected) {
    throw new ApiError("EDIT_CONFLICT", { current });
  }
}

/**
 * Refuses a browser write that another site started. The browser's own `Sec-Fetch-Site` wins
 * (a dev proxy or tunnel can make the Worker's URL differ from the page's); without it the
 * Origin must match. A request with neither (a script or tool, not a browser form) is left to
 * the token checks.
 */
export const sameOriginWrites = createMiddleware(async (c, next) => {
  const safe = c.req.method === "GET" || c.req.method === "HEAD" || c.req.method === "OPTIONS";
  const site = c.req.header("Sec-Fetch-Site");
  const origin = c.req.header("Origin");
  const foreign =
    site === undefined
      ? origin !== undefined && origin !== new URL(c.req.url).origin
      : site !== "same-origin" && site !== "none";
  if (!safe && foreign) throw new ApiError("FORBIDDEN");
  await next();
});
