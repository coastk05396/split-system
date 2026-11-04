import { describe, expect, it } from "vitest";
import { bearer, call, clock, json, signIn, uniqueSub, withCookie } from "./auth-harness.js";

function link(provider: string, accessToken: string, sub: string) {
  return call(`/auth/link/${provider}`, json({ idToken: `fake|${sub}|小宇` }, bearer(accessToken)));
}

function meOf(accessToken: string) {
  return call("/me", { headers: bearer(accessToken) }).then((res) => res.json());
}

function unlink(provider: string, accessToken: string) {
  return call(`/auth/identities/${provider}`, { method: "DELETE", headers: bearer(accessToken) });
}

describe("POST /auth/link/:provider", () => {
  it("adds a second Identity, after which either one signs into the same User", async () => {
    const lineSub = uniqueSub("line");
    const session = await signIn("google", uniqueSub("google"));
    const res = await link("line", session.accessToken, lineSub);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      identities: [{ provider: "google" }, { provider: "line" }],
    });
    expect((await signIn("line", lineSub)).userId).toBe(session.userId);
  });

  it("refuses an Identity that already belongs to another User", async () => {
    const lineSub = uniqueSub("taken");
    await signIn("line", lineSub);
    const other = await signIn("google", uniqueSub("other"));
    const res = await link("line", other.accessToken, lineSub);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: { code: "IDENTITY_LINKED_ELSEWHERE" } });
  });

  it("refuses a second Identity of a provider the User already has", async () => {
    const session = await signIn("google", uniqueSub("g1"));
    const res = await link("google", session.accessToken, uniqueSub("g2"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: { code: "PROVIDER_ALREADY_LINKED" } });
  });

  it("requires a signed-in User", async () => {
    expect((await call("/auth/link/line", json({ idToken: "fake|x|y" }))).status).toBe(401);
  });
});

describe("Identity email (shown in Settings)", () => {
  it("keeps a Google email, never a LINE one", async () => {
    const session = await signIn("google", uniqueSub("g"), "小宇", "rick@example.com");
    await link("line", session.accessToken, uniqueSub("l")).then((res) => res.json());
    expect(await meOf(session.accessToken)).toMatchObject({
      identities: [{ provider: "google", email: "rick@example.com" }, { provider: "line" }],
    });
    expect(await meOf(session.accessToken)).toMatchObject({
      identities: [{ provider: "google" }, { provider: "line", email: null }],
      signedInWith: "google",
    });
  });

  it("stores the email of a Google account linked later", async () => {
    const session = await signIn("line", uniqueSub("l"));
    const res = await call(
      "/auth/link/google",
      json(
        { idToken: `fake|${uniqueSub("g")}|小宇|late@example.com` },
        bearer(session.accessToken),
      ),
    );
    expect(await res.json()).toMatchObject({
      identities: [{ provider: "google", email: "late@example.com" }, { provider: "line" }],
    });
  });

  it("refreshes the email at the next sign-in, and keeps it when a token lacks one", async () => {
    const sub = uniqueSub("g");
    const first = await signIn("google", sub, "小宇", "old@example.com");
    await signIn("google", sub, "小宇", "new@example.com");
    expect(await meOf(first.accessToken)).toMatchObject({
      identities: [{ provider: "google", email: "new@example.com" }],
    });
    await signIn("google", sub, "小宇");
    expect(await meOf(first.accessToken)).toMatchObject({
      identities: [{ provider: "google", email: "new@example.com" }],
    });
  });
});

describe("Profile source: the first Identity's name and picture stay", () => {
  // The test clock stands still; a later link needs a later time to count as later.
  function linkLater(provider: string, accessToken: string, sub: string) {
    clock.now += 1000;
    return link(provider, accessToken, sub);
  }

  it("keeps LINE's when Google is linked later and signs in, and the LINE session stays LINE", async () => {
    const lineSub = uniqueSub("l");
    const googleSub = uniqueSub("g");
    const session = await signIn("line", lineSub, "LINE名");
    await linkLater("google", session.accessToken, googleSub);
    const google = await signIn("google", googleSub, "Google名");
    expect(await meOf(session.accessToken)).toMatchObject({
      displayName: "LINE名",
      pictureUrl: `https://pic/${lineSub}`,
      signedInWith: "line",
    });
    expect(await meOf(google.accessToken)).toMatchObject({ signedInWith: "google" });
  });

  it("keeps Google's when LINE is linked later and signs in, and the Google session stays Google", async () => {
    const googleSub = uniqueSub("g");
    const lineSub = uniqueSub("l");
    const session = await signIn("google", googleSub, "Google名");
    await linkLater("line", session.accessToken, lineSub);
    const line = await signIn("line", lineSub, "LINE名");
    expect(await meOf(session.accessToken)).toMatchObject({
      displayName: "Google名",
      pictureUrl: `https://pic/${googleSub}`,
      signedInWith: "google",
    });
    expect(await meOf(line.accessToken)).toMatchObject({ signedInWith: "line" });
  });

  it("keeps a session's provider through a refresh, whoever signed in meanwhile", async () => {
    const lineSub = uniqueSub("l");
    const googleSub = uniqueSub("g");
    const session = await signIn("line", lineSub, "LINE名");
    await linkLater("google", session.accessToken, googleSub);
    await signIn("google", googleSub, "Google名");
    const res = await call("/auth/refresh", withCookie(session.refresh));
    expect(res.status).toBe(200);
    const body = await res.json<{ accessToken: string; user: { signedInWith: string } }>();
    expect(body.user.signedInWith).toBe("line");
    expect(await meOf(body.accessToken)).toMatchObject({ signedInWith: "line" });
  });

  it("refreshes the name and picture when the source signs in again", async () => {
    const lineSub = uniqueSub("l");
    const session = await signIn("line", lineSub, "舊名");
    await linkLater("google", session.accessToken, uniqueSub("g"));
    await signIn("line", lineSub, "新名");
    expect(await meOf(session.accessToken)).toMatchObject({ displayName: "新名" });
  });

  it("passes to the remaining Identity once the source is unlinked", async () => {
    const lineSub = uniqueSub("l");
    const googleSub = uniqueSub("g");
    const session = await signIn("line", lineSub, "LINE名");
    await linkLater("google", session.accessToken, googleSub);
    await unlink("line", session.accessToken);
    // Nothing is fetched at unlink time: the old name stays until the next sign-in.
    expect(await meOf(session.accessToken)).toMatchObject({ displayName: "LINE名" });
    await signIn("google", googleSub, "Google名");
    expect(await meOf(session.accessToken)).toMatchObject({
      displayName: "Google名",
      pictureUrl: `https://pic/${googleSub}`,
    });
  });

  it("still refreshes a non-source Google email at sign-in", async () => {
    const googleSub = uniqueSub("g");
    const session = await signIn("line", uniqueSub("l"), "LINE名");
    await linkLater("google", session.accessToken, googleSub);
    await signIn("google", googleSub, "Google名", "new@example.com");
    expect(await meOf(session.accessToken)).toMatchObject({
      identities: [{ provider: "line" }, { provider: "google", email: "new@example.com" }],
    });
  });
});

describe("DELETE /auth/identities/:provider", () => {
  it("refuses to unlink the last Identity", async () => {
    const session = await signIn("line", uniqueSub("only"));
    const res = await unlink("line", session.accessToken);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: { code: "LAST_IDENTITY" } });
  });

  it("unlinks one of two Identities, which then no longer signs in to this User", async () => {
    const lineSub = uniqueSub("drop");
    const session = await signIn("google", uniqueSub("keep"));
    await link("line", session.accessToken, lineSub);

    const res = await unlink("line", session.accessToken);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ identities: [{ provider: "google" }] });
    expect((await signIn("line", lineSub)).userId).not.toBe(session.userId);
  });

  it("answers 404 for a provider the User has not linked", async () => {
    const session = await signIn("google", uniqueSub("none"));
    expect((await unlink("line", session.accessToken)).status).toBe(404);
  });
});
