import { describe, expect, it } from "vitest";
import {
  bearer,
  call,
  clock,
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

  it("keeps a session alive past 30 days while it keeps rotating", async () => {
    const session = await signIn("google", uniqueSub("slide"));
    const started = clock.now;
    try {
      clock.now = started + 20 * DAY;
      const first = await refresh(session.refresh);
      expect(first.res.status).toBe(200);
      clock.now = started + 40 * DAY;
      expect((await refresh(first.next ?? "")).res.status).toBe(200);
    } finally {
      clock.now = started;
    }
  });
});

describe("POST /auth/logout and /auth/logout-all", () => {
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

  it("logout-all ends every session of the User", async () => {
    const sub = uniqueSub("all");
    const phone = await signIn("line", sub);
    const laptop = await signIn("line", sub);

    expect((await call("/auth/logout-all", { method: "POST" })).status).toBe(401);
    const res = await call("/auth/logout-all", {
      method: "POST",
      headers: bearer(phone.accessToken),
    });
    expect(res.status).toBe(204);
    expect((await refresh(phone.refresh)).res.status).toBe(401);
    expect((await refresh(laptop.refresh)).res.status).toBe(401);
  });
});
