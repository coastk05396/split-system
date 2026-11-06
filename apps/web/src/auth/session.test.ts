import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("updates the User's settings through PATCH /api/v1/me", async () => {
    const api = createFakeApi();
    const session = createSession({ fetch: api.fetch });
    await session.signIn("google", "fake|sub-1|小宇");

    const updated = await session.updateMe({ preferredCurrency: "USD", language: "en" });

    expect(updated).toMatchObject({ preferredCurrency: "USD", language: "en" });
    expect(api.calls).toContain("PATCH /api/v1/me");
  });

  it("deletes the account and forgets the access token without calling logout", async () => {
    const api = createFakeApi();
    const session = createSession({ fetch: api.fetch });
    await session.signIn("google", "fake|sub-1|小宇");

    await session.deleteAccount();

    expect(api.calls).toContain("DELETE /api/v1/me");
    expect(api.calls).not.toContain("POST /api/v1/auth/logout");
    expect(session.getAccessToken()).toBeNull();
    expect((await session.fetch("/api/v1/me")).status).toBe(401);
  });
});

/**
 * The Worker's refresh rule in miniature: one cookie shared by every tab that rotates on
 * each use, and a rotated cookie presented again revokes the session.
 */
function rotatingServer() {
  const user = makeUser("小宇");
  let cookie = "v1"; // what the server holds as current
  let jar: string | null = "v1"; // what the browser holds, updated when a response arrives
  let revoked = false;
  let rotations = 0;
  let hold: Promise<void> | null = null;
  let bodyGate: Promise<void> | null = null;
  let responseGate: Promise<void> | null = null;

  const fetchFn: typeof fetch = async (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : input.toString(),
      "http://localhost",
    );
    const route = `${(init?.method ?? "GET").toUpperCase()} ${url.pathname}`;
    if (route === "POST /api/v1/auth/logout") {
      if (jar === cookie) revoked = true; // only the current cookie ends the session
      jar = null; // and the browser drops its cookie either way
      return new Response(null, { status: 204 });
    }
    if (route !== "POST /api/v1/auth/refresh") return new Response(null, { status: 404 });
    const sent = jar; // the browser attaches the cookie when the request leaves
    await hold;
    if (revoked || sent !== cookie) {
      if (sent !== null) revoked = true;
      jar = null;
      return Response.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
    }
    rotations += 1;
    cookie = `v${String(rotations + 1)}`;
    await responseGate; // the server has rotated; the answer is still on its way
    jar = cookie;
    const answer = { accessToken: `access-${String(rotations)}`, expiresIn: 3600, user };
    if (bodyGate === null) return Response.json(answer);
    const gate = bodyGate;
    // Headers arrive now; the body only once the gate opens.
    return new Response(
      new ReadableStream({
        start(controller) {
          void gate.then(() => {
            controller.enqueue(new TextEncoder().encode(JSON.stringify(answer)));
            controller.close();
          });
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  return {
    fetch: fetchFn,
    /** Answers refreshes with their headers at once but their body only when released. */
    holdBody(): () => void {
      let release = () => {};
      bodyGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    /** Holds a refresh's answer after the server rotated, before the browser sees it. */
    holdResponse(): () => void {
      let release = () => {};
      responseGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    /** Makes the next refresh answers wait until the returned function is called. */
    holdRefresh(): () => void {
      let release = () => {};
      hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
  };
}

/** Browsers share one lock table across tabs; a queue stands in for it. */
function stubWebLocks() {
  let tail: Promise<unknown> = Promise.resolve();
  vi.stubGlobal("navigator", {
    locks: {
      request: <T>(_name: string, run: () => Promise<T>): Promise<T> => {
        const next = tail.then(run, run);
        tail = next.catch(() => undefined);
        return next;
      },
    },
  });
}

describe("session refresh across tabs and sign-out", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lets two tabs refresh at once without revoking the shared session", async () => {
    stubWebLocks();
    const server = rotatingServer();
    const tabA = createSession({ fetch: server.fetch });
    const tabB = createSession({ fetch: server.fetch });

    const [a, b] = await Promise.all([tabA.restore(), tabB.restore()]);

    expect(a?.displayName).toBe("小宇");
    expect(b?.displayName).toBe("小宇");
  });

  it("does not resend a refused request with another account's token after a sign-out", async () => {
    const api = createFakeApi();
    const sentWith: (string | null)[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const session = createSession({
      fetch: async (input, init) => {
        if (!(input instanceof Request ? input.url : input.toString()).includes("/probe"))
          return api.fetch(input, init);
        sentWith.push(new Headers(init?.headers).get("Authorization"));
        if (sentWith.length > 1) return new Response(null, { status: 200 });
        await gate;
        return new Response(null, { status: 401 });
      },
    });
    await session.signIn("google", "fake|sub-1|小宇");
    const pending = session.fetch("/probe");
    await session.signOut();
    await session.signIn("google", "fake|sub-2|阿哲");
    release();

    expect((await pending).status).toBe(401);
    expect(sentWith).toHaveLength(1);
  });

  it("does not resend a refused request as another account after the refresh was refused", async () => {
    const api = createFakeApi();
    const sent: string[] = [];
    let refuse = false;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const session = createSession({
      fetch: async (input, init) => {
        const url = input instanceof Request ? input.url : input.toString();
        if (refuse && url.includes("/auth/refresh")) return new Response(null, { status: 401 });
        if (!url.includes("/probe")) return api.fetch(input, init);
        sent.push(url);
        if (url.includes("/probe-b")) return new Response(null, { status: 401 });
        if (sent.filter((u) => u.includes("/probe-a")).length > 1)
          return new Response(null, { status: 200 });
        await gate;
        return new Response(null, { status: 401 });
      },
    });
    await session.signIn("google", "fake|sub-1|小宇");
    const pending = session.fetch("/probe-a");
    refuse = true;
    await session.fetch("/probe-b");
    refuse = false;
    await session.signIn("google", "fake|sub-2|阿哲");
    release();

    expect((await pending).status).toBe(401);
    expect(sent.filter((u) => u.includes("/probe-a"))).toHaveLength(1);
  });

  it("does not let a refresh that lands after sign-out bring the token back", async () => {
    const server = rotatingServer();
    const release = server.holdRefresh();
    const session = createSession({ fetch: server.fetch });
    const pending = session.restore();

    await session.signOut();
    release();

    expect(await pending).toBeNull();
    expect(session.getAccessToken()).toBeNull();
  });

  it("does not let a refresh whose body is still arriving at sign-out bring the token back", async () => {
    const server = rotatingServer();
    const release = server.holdBody();
    const session = createSession({ fetch: server.fetch });
    const pending = session.restore();
    await new Promise((resolve) => setTimeout(resolve, 0)); // headers are in, body is not

    await session.signOut();
    release();

    expect(await pending).toBeNull();
    expect(session.getAccessToken()).toBeNull();
  });

  it("does not send a refresh that was still queued for the lock when the User signed out", async () => {
    stubWebLocks();
    const server = rotatingServer();
    const release = server.holdRefresh();
    const other = createSession({ fetch: server.fetch });
    const session = createSession({ fetch: server.fetch });
    const first = other.restore();
    const queued = session.restore(); // waits behind the other tab's refresh

    const leaving = session.signOut(); // waits for the lock too, so it is released below
    release();
    await Promise.all([first, leaving]);

    expect(await queued).toBeNull();
    expect(session.getAccessToken()).toBeNull();
  });

  it("keeps a refresh whose answer arrives after sign-out from signing the User back in", async () => {
    stubWebLocks();
    const server = rotatingServer();
    const release = server.holdResponse();
    const session = createSession({ fetch: server.fetch });
    const pending = session.restore(); // the server rotates v1 to v2, the answer is still coming
    await new Promise((resolve) => setTimeout(resolve, 0));

    const leaving = session.signOut();
    release();
    await Promise.all([pending, leaving]);
    const reloaded = await createSession({ fetch: server.fetch }).restore();

    expect(reloaded).toBeNull();
  });
});
