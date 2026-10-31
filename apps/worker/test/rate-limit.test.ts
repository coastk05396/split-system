import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/db/client.js";
import { ApiError } from "../src/errors.js";
import { newApi } from "../src/api.js";
import { requireUser } from "../src/auth/require-user.js";
import { consumeRateLimit, RATE_LIMITS, rateLimit } from "../src/rate-limit.js";
import { bearer, signIn, uniqueSub } from "./auth-harness.js";

const db = createDb(env.DB);
const MINUTE_START = 1_750_000_020_000; // a whole minute
const HOUR_START = 1_749_999_600_000; // a whole hour

async function caught(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("expected RATE_LIMITED");
}

describe("consumeRateLimit", () => {
  it("allows 30 Expense writes a minute per User, then answers 429 with Retry-After", async () => {
    const { userId } = await signIn("google", uniqueSub("rl"));
    for (let i = 0; i < 30; i += 1) {
      await consumeRateLimit(db, userId, "expense_write", MINUTE_START + 1000);
    }
    const error = await caught(
      consumeRateLimit(db, userId, "expense_write", MINUTE_START + 15_000),
    );
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.status).toBe(429);
    expect(error.headers).toEqual({ "Retry-After": "45" });

    // A new minute starts a new count; another User has their own.
    await consumeRateLimit(db, userId, "expense_write", MINUTE_START + 60_000);
    const other = await signIn("google", uniqueSub("rl-other"));
    await consumeRateLimit(db, other.userId, "expense_write", MINUTE_START + 15_000);
  });

  it("counts route groups separately and caps Group creation at 5 an hour", async () => {
    const { userId } = await signIn("line", uniqueSub("groups"));
    for (let i = 0; i < 5; i += 1) {
      await consumeRateLimit(db, userId, "group_create", HOUR_START + i * 600_000);
    }
    await consumeRateLimit(db, userId, "invite_join", HOUR_START);
    const error = await caught(
      consumeRateLimit(db, userId, "group_create", HOUR_START + 3_000_000),
    );
    expect(error.headers).toEqual({ "Retry-After": "600" });
    await consumeRateLimit(db, userId, "group_create", HOUR_START + 3_600_000);
  });

  it("answers a blocked request with 429 RATE_LIMITED and Retry-After", async () => {
    const now = () => MINUTE_START + 50_000;
    const api = newApi().post("/probe", requireUser(now), rateLimit("receipt_upload", now), (c) =>
      c.body(null, 204),
    );
    const session = await signIn("google", uniqueSub("http"));
    const send = () =>
      api.request(
        "https://split.test/api/v1/probe",
        { method: "POST", headers: bearer(session.accessToken) },
        env,
      );
    for (let i = 0; i < 10; i += 1) expect((await send()).status).toBe(204);
    const res = await send();
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("10");
    expect(await res.json()).toEqual({ error: { code: "RATE_LIMITED" } });
  });

  it("matches the limits of decision 27", () => {
    expect(RATE_LIMITS).toEqual({
      expense_write: { limit: 30, windowMs: 60_000 },
      receipt_upload: { limit: 10, windowMs: 60_000 },
      invite_join: { limit: 10, windowMs: 60_000 },
      group_create: { limit: 5, windowMs: 3_600_000 },
      membership_lookup: { limit: 30, windowMs: 60_000 },
    });
  });
});
