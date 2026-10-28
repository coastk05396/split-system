import { describe, expect, it } from "vitest";
import { createFakeApi, makeUser } from "../../test/fake-api.js";
import { ApiFailure } from "../api/errors.js";
import { createSession } from "./session.js";

describe("session", () => {
  it("restores the User from the refresh cookie", async () => {
    const api = createFakeApi();
    api.setCookieUser(makeUser("小宇"));
    const session = createSession({ fetch: api.fetch });

    const me = await session.restore();

    expect(me?.displayName).toBe("小宇");
  });

  it("restores nobody when there is no refresh cookie", async () => {
    const api = createFakeApi();
    const session = createSession({ fetch: api.fetch });

    expect(await session.restore()).toBeNull();
  });

  it("signs in with a provider ID token", async () => {
    const api = createFakeApi();
    const session = createSession({ fetch: api.fetch });

    const me = await session.signIn("line", "fake|sub-1|阿芽");

    expect(me).toMatchObject({ displayName: "阿芽", identities: [{ provider: "line" }] });
  });

  it("reports a rejected ID token by its error code", async () => {
    const api = createFakeApi();
    const session = createSession({ fetch: api.fetch });

    const attempt = session.signIn("google", "forged");

    await expect(attempt).rejects.toBeInstanceOf(ApiFailure);
    await expect(attempt).rejects.toMatchObject({ code: "ID_TOKEN_INVALID" });
  });

  it("signs in through the test route", async () => {
    const api = createFakeApi();
    const session = createSession({ fetch: api.fetch });

    const me = await session.testSignIn({
      provider: "google",
      sub: "dev-1",
      displayName: "測試員",
    });

    expect(me.displayName).toBe("測試員");
  });

  it("sends the access token on authed calls", async () => {
    const api = createFakeApi();
    const session = createSession({ fetch: api.fetch });
    await session.signIn("google", "fake|sub-1|小宇");

    const res = await session.fetch("/api/v1/me");

    expect(res.status).toBe(200);
  });

  it("refreshes once and retries when the access token has expired", async () => {
    const api = createFakeApi();
    const session = createSession({ fetch: api.fetch });
    await session.signIn("google", "fake|sub-1|小宇");
    api.expireAccessToken();
    api.calls.length = 0;

    const [a, b] = await Promise.all([session.fetch("/api/v1/me"), session.fetch("/api/v1/me")]);

    expect([a.status, b.status]).toEqual([200, 200]);
    expect(api.calls.filter((call) => call === "POST /api/v1/auth/refresh")).toHaveLength(1);
  });

  it("tells listeners the User is signed out when the refresh is refused", async () => {
    const api = createFakeApi();
    const signedOut: string[] = [];
    const session = createSession({ fetch: api.fetch, onSignedOut: () => signedOut.push("out") });
    await session.signIn("google", "fake|sub-1|小宇");
    api.expireAccessToken();
    api.setCookieUser(null);

    const res = await session.fetch("/api/v1/me");

    expect(res.status).toBe(401);
    expect(signedOut).toEqual(["out"]);
  });

  it("signs out and forgets the access token", async () => {
    const api = createFakeApi();
    const session = createSession({ fetch: api.fetch });
    await session.signIn("google", "fake|sub-1|小宇");

    await session.signOut();

    expect((await session.fetch("/api/v1/me")).status).toBe(401);
    expect(await session.restore()).toBeNull();
  });
});
