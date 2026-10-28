import type { Context } from "hono";
import { ApiError } from "./errors.js";

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
