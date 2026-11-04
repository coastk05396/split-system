import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  bearer,
  call,
  clock,
  json,
  refreshCookie,
  signIn,
  uniqueSub,
  withCookie,
} from "./auth-harness.js";

const DAY = 24 * 3600 * 1000;

async function refresh(token: string) {
  const res = await call("/auth/refresh", withCookie(token));
  return { res, next: refreshCookie(res) };
}

describe("POST /auth/refresh", () => {
  it("rotates the refresh token and issues a fresh access token", async () => {
    const session = await signIn("google", uniqueSub("r"));
    const { res, next } = await refresh(session.refresh);
    expect(res.status).toBe(200);
    expect(next).toBeTruthy();
    expect(next).not.toBe(session.refresh);
    const body = await res.json<{ accessToken: string; user: { id: string } }>();
    expect(body.user.id).toBe(session.userId);
    expect((await call("/me", { headers: bearer(body.accessToken) })).status).toBe(200);
  });

  it("detects reuse of a rotated token and revokes the session for both holders", async () => {
    const session = await signIn("line", uniqueSub("reuse"));
    const { next } = await refresh(session.refresh);
    if (next === undefined) throw new Error("no rotated token");

    const replay = await refresh(session.refresh);
    expect(replay.res.status).toBe(401);
    expect(await replay.res.json()).toEqual({ error: { code: "UNAUTHORIZED" } });

    // The legitimate newer token is revoked too, so a thief cannot keep the session.
    expect((await refresh(next)).res.status).toBe(401);
  });

  it("refuses a missing, malformed or expired refresh token", async () => {
    expect((await call("/auth/refresh", { method: "POST" })).status).toBe(401);
    expect((await refresh("garbage")).res.status).toBe(401);

    const session = await signIn("google", uniqueSub("exp"));
    const started = clock.now;
    clock.now = started + 31 * DAY;
    try {
      expect((await refresh(session.refresh)).res.status).toBe(401);
    } finally {
      clock.now = started;
    }
  });

  it("refuses a refresh token at the very moment its 15 days since sign-in end", async () => {
    const justBefore = await signIn("google", uniqueSub("edge-before"));
    const atTheLimit = await signIn("google", uniqueSub("edge-at"));
    const started = clock.now;
    try {
      clock.now = started + 15 * DAY - 1;
      expect((await refresh(justBefore.refresh)).res.status).toBe(200);
      clock.now = started + 15 * DAY;
      expect((await refresh(atTheLimit.refresh)).res.status).toBe(401);
    } finally {
      clock.now = started;
    }
  });

  it("ends a session signed in before the 15-day limit existed, even with its old expiry still ahead", async () => {
    const session = await signIn("google", uniqueSub("legacy"));
    // The old rule gave 30 days from the last use, so this row looks valid to an expiry check.
    await env.DB.prepare("UPDATE sessions SET created_at=?, expires_at=? WHERE user_id=?")
      .bind(clock.now - 20 * DAY, clock.now + 10 * DAY, session.userId)
      .run();

    expect((await refresh(session.refresh)).res.status).toBe(401);
  });

  it("keeps a session alive while it rotates, but only for 15 days after sign-in", async () => {
    const session = await signIn("google", uniqueSub("cap"));
    const started = clock.now;
    try {
      let cookie = session.refresh;
      for (const day of [5, 10, 14]) {
        clock.now = started + day * DAY;
        const rotated = await refresh(cookie);
        expect(rotated.res.status).toBe(200);
        cookie = rotated.next ?? "";
      }
      clock.now = started + 15 * DAY;
      expect((await refresh(cookie)).res.status).toBe(401);
    } finally {
      clock.now = started;
    }
  });
});

describe("POST /auth/logout", () => {
  it("logout ends only this device's session", async () => {
    const sub = uniqueSub("out");
    const phone = await signIn("google", sub);
    const laptop = await signIn("google", sub);

    const res = await call("/auth/logout", withCookie(phone.refresh));
    expect(res.status).toBe(204);
    expect(res.headers.get("Set-Cookie")).toMatch(/refresh=;/);
    expect((await refresh(phone.refresh)).res.status).toBe(401);
    expect((await refresh(laptop.refresh)).res.status).toBe(200);
  });
});

describe("the refresh cookie", () => {
  it("lasts as long as a session may, 15 days, not longer", async () => {
    const res = await call("/auth/google", json({ idToken: `fake|${uniqueSub("age")}|小宇` }));

    expect(res.headers.get("Set-Cookie")).toContain(`Max-Age=${String(15 * 24 * 3600)}`);
  });
});
