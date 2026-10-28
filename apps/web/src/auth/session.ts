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
  /** Dev and browser-test sign-in; the route answers 404 unless the Worker enables it. */
  testSignIn(request: TestSignInRequest): Promise<Me>;
  /** Ends this device's session. */
  signOut(): Promise<void>;
  /** `fetch` with the access token attached; refreshes once on a 401 and retries. */
  fetch: typeof fetch;
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

  async function accept(res: Response): Promise<Me> {
    if (!res.ok) throw await toApiFailure(res);
    const body = (await res.json()) as { accessToken: string; user: Me };
    accessToken = body.accessToken;
    return body.user;
  }

  function refresh(): Promise<Me | null> {
    refreshing ??= (async () => {
      try {
        // Widened: the typed client only describes the 200 answer.
        const res: Response = await api.auth.refresh.$post();
        if (res.ok) return await accept(res);
        accessToken = null;
        return null;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  function send(input: RequestInfo | URL, init: RequestInit | undefined, token: string | null) {
    const headers = new Headers(init?.headers);
    if (token !== null) headers.set("Authorization", `Bearer ${token}`);
    return baseFetch(input, { ...init, headers });
  }

  return {
    restore: refresh,

    async signIn(provider, idToken) {
      const route = provider === "google" ? api.auth.google : api.auth.line;
      return accept(await route.$post(undefined, withJson({ idToken })));
    },

    async testSignIn(request) {
      return accept(await api.auth["test-sign-in"].$post(undefined, withJson(request)));
    },

    async signOut() {
      accessToken = null;
      await api.auth.logout.$post();
    },

    async fetch(input, init) {
      const used = accessToken;
      const res = await send(input, init, used);
      if (res.status !== 401) return res;
      // Another call may already have refreshed while this one was in flight.
      if (accessToken !== null && accessToken !== used) return send(input, init, accessToken);
      const me = await refresh();
      if (me === null) {
        onSignedOut?.();
        return res;
      }
      return send(input, init, accessToken);
    },
  };
}
