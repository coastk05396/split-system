import type { Me, Provider, TestSignInRequest } from "@split/shared";
import { createApiClient, withJson } from "../api/client.js";
import { toApiFailure } from "../api/errors.js";

/**
 * The browser side of a session (decision 09): the access token lives only in memory,
 * the rotating refresh token only in the Worker's httpOnly cookie.
 */
export interface Session {
  /** Uses the refresh cookie to start a session; null when there is none. */
  restore(): Promise<Me | null>;
  /** Exchanges a Google or LINE ID token for a session. Throws ApiFailure. */
  signIn(provider: Provider, idToken: string): Promise<Me>;
  /** Spends a link code with a Google ID token: joins the code's User and signs in as them. */
  redeemLinkCode(code: string, idToken: string): Promise<Me>;
  link(provider: Provider, idToken: string): Promise<Me>;
  unlink(provider: Provider): Promise<Me>;
  createLinkCode(): Promise<string>;
  getMe(): Promise<Me>;
  /** Dev and browser-test sign-in; the route answers 404 unless the Worker enables it. */
  testSignIn(request: TestSignInRequest): Promise<Me>;
  /** Ends this device's session. */
  signOut(): Promise<void>;
  /** `fetch` with the access token attached; refreshes once on a 401 and retries. */
  fetch: typeof fetch;
  /** Returns the current access token, or null if signed out. */
  getAccessToken(): string | null;
}

export interface SessionOptions {
  fetch: typeof fetch;
  /** Called when a refresh is refused, so the app can return to sign-in. */
  onSignedOut?: () => void;
}

export function createSession({ fetch: baseFetch, onSignedOut }: SessionOptions): Session {
  const api = createApiClient(baseFetch);
  let accessToken: string | null = null;
  let refreshing: Promise<Me | null> | null = null;
  // Bumped by sign-out, so a refresh already in flight cannot hand the token back afterwards.
  let generation = 0;

  async function readSession(res: Response): Promise<{ accessToken: string; user: Me }> {
    if (!res.ok) throw await toApiFailure(res);
    return (await res.json()) as { accessToken: string; user: Me };
  }

  async function accept(res: Response): Promise<Me> {
    const body = await readSession(res);
    accessToken = body.accessToken;
    return body.user;
  }

  /**
   * One refresh at a time across every tab: the cookie rotates on use, so two tabs sending the
   * old one together would look like a replay and the Worker would end the session.
   * shortcut: without Web Locks (old browsers) tabs can still race, upgrade when that matters.
   */
  async function oneAtATime(run: () => Promise<Me | null>): Promise<Me | null> {
    return typeof navigator !== "undefined" && "locks" in navigator
      ? await navigator.locks.request("split-refresh", run)
      : run();
  }

  function refresh(): Promise<Me | null> {
    // Taken when the refresh is asked for: a sign-out after that voids it, whether it is
    // still queued for the lock, in flight, or only waiting on its body.
    const asked = generation;
    refreshing ??= oneAtATime(async () => {
      if (asked !== generation) return null;
      // Widened: the typed client only describes the 200 answer.
      const res: Response = await api.auth.refresh.$post();
      if (!res.ok) {
        if (asked === generation) accessToken = null;
        return null;
      }
      const body = await readSession(res);
      if (asked !== generation) return null;
      accessToken = body.accessToken;
      return body.user;
    }).finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  function send(input: RequestInfo | URL, init: RequestInit | undefined, token: string | null) {
    const headers = new Headers(init?.headers);
    if (token !== null) headers.set("Authorization", `Bearer ${token}`);
    return baseFetch(input, { ...init, headers });
  }

  // These calls need the session's refresh-and-retry fetch, just like other signed-in calls.
  const authenticated = createApiClient((input, init) => session.fetch(input, init));
  async function readUser(res: Response): Promise<Me> {
    if (!res.ok) throw await toApiFailure(res);
    return (await res.json()) as Me;
  }

  const session: Session = {
    getAccessToken() {
      return accessToken;
    },

    restore: refresh,

    async signIn(provider, idToken) {
      const route = provider === "google" ? api.auth.google : api.auth.line;
      return accept(await route.$post(undefined, withJson({ idToken })));
    },

    async redeemLinkCode(code, idToken) {
      return accept(
        await api.auth["link-code"].redeem.$post(undefined, withJson({ code, idToken })),
      );
    },

    async link(provider, idToken) {
      return readUser(
        await authenticated.auth.link[":provider"].$post(
          { param: { provider } },
          withJson({ idToken }),
        ),
      );
    },

    async unlink(provider) {
      return readUser(
        await authenticated.auth.identities[":provider"].$delete({ param: { provider } }),
      );
    },

    async createLinkCode() {
      const res: Response = await authenticated.auth["link-code"].$post();
      if (!res.ok) throw await toApiFailure(res);
      return ((await res.json()) as { code: string }).code;
    },

    getMe: async () => readUser(await authenticated.me.$get()),

    async testSignIn(request) {
      return accept(await api.auth["test-sign-in"].$post(undefined, withJson(request)));
    },

    async signOut() {
      generation += 1;
      accessToken = null;
      // Behind any refresh in flight, so the cookie it rotated is the one logout presents.
      await oneAtATime(async () => {
        await api.auth.logout.$post();
        return null;
      });
    },

    async fetch(input, init) {
      const used = accessToken;
      const asked = generation;
      const res = await send(input, init, used);
      if (res.status !== 401) return res;
      // A sign-out since then means another account may hold the token now: never resend as them.
      if (asked !== generation) return res;
      // Another call may already have refreshed while this one was in flight.
      if (accessToken !== null && accessToken !== used) return send(input, init, accessToken);
      const me = await refresh();
      if (me === null) {
        // Every request still in flight from this account is void, as after a sign-out.
        generation += 1;
        onSignedOut?.();
        return res;
      }
      return send(input, init, accessToken);
    },
  };
  return session;
}
