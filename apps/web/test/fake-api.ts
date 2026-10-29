import type { Me } from "@split/shared";
import { createFakeGroups, type FakeGroups } from "./fake-groups.js";

/**
 * An in-memory stand-in for the Worker's auth API, reached through `fetch`.
 * It keeps one refresh cookie and hands out numbered access tokens.
 */
export interface FakeApi {
  fetch: typeof fetch;
  /** Every request seen, as "METHOD /path". */
  calls: string[];
  /** Pretend the browser holds a valid refresh cookie for this User. */
  setCookieUser(user: Me | null): void;
  /** Make the current access token stale so the next authed call gets a 401. */
  expireAccessToken(): void;
  /** Whether the test sign-in route exists (TEST_SIGN_IN=1). */
  testSignInEnabled: boolean;
  /** Groups, Members and Invites. */
  groups: FakeGroups;
  /** The next request to "METHOD /path" answers with this error (500 INTERNAL by default). */
  failNext(route: string, code?: string, status?: number): void;
  /** When set, `POST /auth/link/:provider` fails with this 409 code. */
  refuseLink: string | null;
  /** The next request to "METHOD /path" reaches the server, but its answer is lost (network error). */
  dropNextResponse(route: string): void;
  /** Every request seen, with its headers and body text. */
  requests: { route: string; headers: Headers; body: string | null }[];
  /** Reference rates by "BASE-QUOTE" (scaled by 1,000,000); a missing pair answers 503 RATE_UNAVAILABLE. */
  rates: Map<string, { rateScaled: number; rateDate?: string; stale?: boolean }>;
}

export function makeUser(displayName: string, provider: "google" | "line" = "google"): Me {
  return {
    id: `u-${displayName}`,
    displayName,
    pictureUrl: null,
    preferredCurrency: "TWD",
    language: "zh-TW",
    identities: [{ provider }],
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function error(code: string, status: number): Response {
  return json({ error: { code } }, status);
}

export function createFakeApi(): FakeApi {
  let cookieUser: Me | null = null;
  let tokenSeq = 0;
  const liveTokens = new Map<string, Me>();
  const calls: string[] = [];
  const failing = new Map<string, { code: string; status: number }>();
  const dropping = new Set<string>();
  const requests: FakeApi["requests"] = [];

  function issue(user: Me): Response {
    cookieUser = user;
    tokenSeq += 1;
    const accessToken = `access-${tokenSeq}`;
    liveTokens.set(accessToken, user);
    return json({ accessToken, expiresIn: 3600, user });
  }

  async function readJson(init: RequestInit | undefined): Promise<Record<string, unknown>> {
    const raw = typeof init?.body === "string" ? init.body : "{}";
    return Promise.resolve(JSON.parse(raw) as Record<string, unknown>);
  }

  /** Replaces the signed-in User everywhere the fake remembers them. */
  function update(user: Me): Response {
    if (cookieUser?.id === user.id) cookieUser = user;
    for (const [token, holder] of liveTokens) {
      if (holder.id === user.id) liveTokens.set(token, user);
    }
    return json(user);
  }

  function endAll(): Response {
    cookieUser = null;
    liveTokens.clear();
    return new Response(null, { status: 204 });
  }

  const api: FakeApi = {
    calls,
    groups: createFakeGroups(),
    failNext(route, code = "INTERNAL", status = 500) {
      failing.set(route, { code, status });
    },
    testSignInEnabled: true,
    refuseLink: null,
    requests,
    rates: new Map([
      ["USD-TWD", { rateScaled: 31_523_400 }],
      ["TWD-USD", { rateScaled: 31_723 }],
      ["JPY-TWD", { rateScaled: 215_000 }],
    ]),
    dropNextResponse(route) {
      dropping.add(route);
    },
    setCookieUser(user) {
      cookieUser = user;
    },
    expireAccessToken() {
      liveTokens.clear();
    },
    async fetch(input, init) {
      const response = await serve(input, init);
      const url = new URL(
        input instanceof Request ? input.url : input.toString(),
        "http://localhost",
      );
      const route = `${(init?.method ?? "GET").toUpperCase()} ${url.pathname}`;
      // The server did the work; only its answer is lost on the way back.
      if (dropping.delete(route)) throw new TypeError("Failed to fetch");
      return response;
    },
  };

  async function serve(
    input: Parameters<typeof fetch>[0],
    init: RequestInit | undefined,
  ): Promise<Response> {
    const url = new URL(
      input instanceof Request ? input.url : input.toString(),
      "http://localhost",
    );
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push(`${method} ${url.pathname}`);
    const headers = new Headers(init?.headers);
    requests.push({
      route: `${method} ${url.pathname}`,
      headers,
      body: typeof init?.body === "string" ? init.body : null,
    });
    const bearer = headers.get("Authorization")?.replace(/^Bearer /, "");
    const authed = bearer === undefined ? undefined : liveTokens.get(bearer);

    const failure = failing.get(`${method} ${url.pathname}`);
    if (failure !== undefined) {
      failing.delete(`${method} ${url.pathname}`);
      return error(failure.code, failure.status);
    }

    switch (`${method} ${url.pathname}`) {
      case "POST /api/v1/auth/refresh":
        return cookieUser === null ? error("UNAUTHORIZED", 401) : issue(cookieUser);
      case "POST /api/v1/auth/google":
      case "POST /api/v1/auth/line": {
        const { idToken } = await readJson(init);
        if (typeof idToken !== "string" || !idToken.startsWith("fake|")) {
          return error("ID_TOKEN_INVALID", 401);
        }
        const [, , name = "someone"] = idToken.split("|");
        const provider = url.pathname.endsWith("line") ? "line" : "google";
        return issue(makeUser(name, provider));
      }
      case "POST /api/v1/auth/test-sign-in": {
        if (!api.testSignInEnabled) return error("NOT_FOUND", 404);
        const body = await readJson(init);
        const provider = body.provider === "line" ? "line" : "google";
        return issue(makeUser(String(body.displayName), provider));
      }
      case "POST /api/v1/auth/logout":
        cookieUser = null;
        liveTokens.clear();
        return new Response(null, { status: 204 });
      case "GET /api/v1/me":
        return authed === undefined ? error("UNAUTHORIZED", 401) : json(authed);
      case "POST /api/v1/auth/logout-all":
        return authed === undefined ? error("UNAUTHORIZED", 401) : endAll();
      case "PATCH /api/v1/me": {
        if (authed === undefined) return error("UNAUTHORIZED", 401);
        const body = await readJson(init);
        const currencies = ["TWD", "USD", "JPY", "THB"] as const;
        const currency = currencies.find((c) => c === body.preferredCurrency);
        const language = body.language === "en" || body.language === "zh-TW" ? body.language : null;
        return update({
          ...authed,
          ...(currency === undefined ? {} : { preferredCurrency: currency }),
          ...(language === null ? {} : { language }),
        });
      }
      case "DELETE /api/v1/me":
        return authed === undefined ? error("UNAUTHORIZED", 401) : endAll();
      case "GET /api/v1/rates": {
        if (authed === undefined) return error("UNAUTHORIZED", 401);
        const base = url.searchParams.get("base") ?? "";
        const quote = url.searchParams.get("quote") ?? "";
        const rate = api.rates.get(`${base}-${quote}`);
        if (rate === undefined) return error("RATE_UNAVAILABLE", 503);
        const rateDate = rate.rateDate ?? url.searchParams.get("date") ?? "";
        return json({
          base,
          quote,
          rateScaled: rate.rateScaled,
          rateDate,
          stale: rate.stale ?? false,
        });
      }
    }

    const identity =
      /^(POST \/api\/v1\/auth\/link|DELETE \/api\/v1\/auth\/identities)\/(line|google)$/.exec(
        `${method} ${url.pathname}`,
      );
    if (identity !== null) {
      if (authed === undefined) return error("UNAUTHORIZED", 401);
      const provider = identity[2] === "line" ? "line" : "google";
      const others = authed.identities.filter((i) => i.provider !== provider);
      if (method === "DELETE") {
        if (others.length === 0) return error("LAST_IDENTITY", 409);
        return update({ ...authed, identities: others });
      }
      const { idToken } = await readJson(init);
      if (typeof idToken !== "string" || !idToken.startsWith("fake|")) {
        return error("ID_TOKEN_INVALID", 401);
      }
      if (api.refuseLink !== null) return error(api.refuseLink, 409);
      return update({ ...authed, identities: [...others, { provider }] });
    }
    const body = method === "GET" || method === "DELETE" ? {} : await readJson(init);
    return (
      api.groups.handle(method, url.pathname, body, authed, {
        headers,
        query: url.searchParams,
      }) ?? error("NOT_FOUND", 404)
    );
  }
  return api;
}
