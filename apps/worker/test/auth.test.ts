import { describe, expect, it } from "vitest";
import { bearer, call, json, refreshCookie, signIn, uniqueSub } from "./auth-harness.js";

describe("POST /auth/:provider", () => {
  it("creates a User with one Identity on first sign-in and returns a 1-hour access token", async () => {
    const sub = uniqueSub("g");
    const res = await call("/auth/google", json({ idToken: `fake|${sub}|小宇` }));
    expect(res.status).toBe(200);
    const body = await res.json<{ accessToken: string; expiresIn: number; user: { id: string } }>();
    expect(body.expiresIn).toBe(3600);

    const cookie = res.headers.get("Set-Cookie") ?? "";
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    expect(refreshCookie(res)).toBeTruthy();

    const me = await call("/me", { headers: bearer(body.accessToken) });
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({
      id: body.user.id,
      displayName: "小宇",
      pictureUrl: `https://pic/${sub}`,
      preferredCurrency: "TWD",
      language: "zh-TW",
      identities: [{ provider: "google" }],
    });
  });

  it("signs the same Identity back into the same User and refreshes the profile", async () => {
    const sub = uniqueSub("l");
    const first = await signIn("line", sub, "小宇");
    const second = await signIn("line", sub, "宇宇");
    expect(second.userId).toBe(first.userId);
    const me = await call("/me", { headers: bearer(second.accessToken) });
    expect(await me.json()).toMatchObject({ displayName: "宇宇" });
  });

  it("refuses an invalid ID token", async () => {
    const res = await call("/auth/google", json({ idToken: "forged" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "ID_TOKEN_INVALID" } });
  });

  it("answers 404 for an unknown provider", async () => {
    const res = await call("/auth/github", json({ idToken: "fake|x|y" }));
    expect(res.status).toBe(404);
  });
});

describe("GET /me", () => {
  it("requires a valid access token", async () => {
    expect((await call("/me")).status).toBe(401);
    expect((await call("/me", { headers: bearer("not-a-jwt") })).status).toBe(401);
  });
});
