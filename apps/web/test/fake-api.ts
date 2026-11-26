import {
  type CurrencyCode,
  type DailyFlightsResponse,
  getDefaultDailyFlights,
  type Me,
  type MergePreview,
} from "@split/shared";
import { createFakeGroups, type FakeGroups } from "./fake-groups.js";

/**
 * An in-memory stand-in for the Worker's auth API, reached through `fetch`.
 * It keeps one refresh cookie and hands out numbered access tokens.
 */
export interface FakeApi {
  fetch: typeof fetch;
  /** Every request seen, as "METHOD /path". */
  calls: string[];
  /** Changes the User on the server only, as another device would; this device is not told. */
  changeUserOnServer(user: Me): void;
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
  /** Holds answers at the network boundary until the returned release is called. */
  holdResponses(route: string): () => void;
  /** When set, `POST /auth/link/:provider` fails with this 409 code. */
  refuseLink: string | null;
  /** Link codes the server has issued, with the User each one belongs to. */
  linkCodes: Map<string, Me>;
  /** Existing Users keyed by Google `sub`, to trigger a Merge on link-code redemption or link. */
  googleOwners: Map<string, Me>;
  /** Group IDs whose ledger merge fails during confirm, leaving them marked as merging. */
  failMergeGroups: Set<string>;
  /** Existing Users keyed by LINE `sub`, to trigger a Merge on link. */
  lineOwners: Map<string, Me>;
  /** The next request to "METHOD /path" reaches the server, but its answer is lost (network error). */
  dropNextResponse(route: string): void;
  /** Every request seen, with its headers and body text. */
  requests: { route: string; headers: Headers; body: string | null }[];
  /** Daily flights payload returned by public GET /api/v1/flights/daily. */
  dailyFlights: DailyFlightsResponse;
  /** Reference rates by "BASE-QUOTE" (scaled by 1,000,000); a missing pair answers 503 RATE_UNAVAILABLE. */
  rates: Map<string, { rateScaled: number; rateDate?: string; stale?: boolean }>;
  spendingStats: { month: string; category: string; currency: CurrencyCode; amount: number }[];
  spendingDetails: {
    id: string;
    groupId: string;
    groupName: string;
    description: string;
    date: string;
    currency: CurrencyCode;
    amount: number;
  }[];
}

export function makeUser(displayName: string, provider: "google" | "line" = "google"): Me {
  return {
    id: `u-${displayName}`,
    displayName,
    pictureUrl: null,
    preferredCurrency: "TWD",
    language: "zh-TW",
    identities: [{ provider, email: provider === "google" ? `${displayName}@example.com` : null }],
    signedInWith: provider,
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
  const confirmTokens = new Map<string, { kept: Me; mergeId: string }>();
  const pendingMerges = new Map<string, { preview: MergePreview; kept: Me; other: Me }>();
  const calls: string[] = [];
  const failing = new Map<string, { code: string; status: number }>();
  const dropping = new Set<string>();
  const held = new Map<string, Promise<void>>();
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
    holdResponses(route) {
      let release: () => void = () => undefined;
      held.set(
        route,
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );
      return () => {
        held.delete(route);
        release();
      };
    },
    testSignInEnabled: true,
    refuseLink: null,
    linkCodes: new Map(),
    googleOwners: new Map(),
    failMergeGroups: new Set(),
    lineOwners: new Map(),
    requests,
    spendingStats: [],
    spendingDetails: [],
    dailyFlights: {
      date: "2026-11-16",
      updatedAt: "2026-11-16T01:00:00.000Z",
      items: getDefaultDailyFlights("2026-11-16"),
      isFallback: false,
    },
    rates: new Map([
      ["USD-TWD", { rateScaled: 31_523_400 }],
      ["TWD-USD", { rateScaled: 31_723 }],
      ["JPY-TWD", { rateScaled: 215_000 }],
    ]),
    dropNextResponse(route) {
      dropping.add(route);
    },
    changeUserOnServer(user) {
      update(user);
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
      await held.get(route);
      // The server did the work; only its answer is lost on the way back.
      if (dropping.delete(route)) throw new TypeError("Failed to fetch");
      return response;
    },
  };

  function createPendingMerge(kept: Me, other: Me, path: "linkCode" | "settings"): MergePreview {
    const keptGroups = api.groups.forUser(kept.id);
    const otherGroups = api.groups.forUser(other.id);
    const keptIds = new Set(keptGroups.map((g) => g.id));
    const otherIds = new Set(otherGroups.map((g) => g.id));
    const mergeId = `merge-${String(pendingMerges.size + 1)}`;
    const preview: MergePreview = {
      mergeId,
      path,
      expiresAt: Date.now() + 600_000,
      kept: {
        id: kept.id,
        displayName: kept.displayName,
        pictureUrl: kept.pictureUrl,
        providers: kept.identities.map((i) => i.provider),
        profileProvider: kept.identities[0]?.provider ?? "line",
        groupCount: keptGroups.length,
        groups: keptGroups.map((g) => ({ ...g, shared: otherIds.has(g.id) })),
      },
      other: {
        id: other.id,
        displayName: other.displayName,
        pictureUrl: other.pictureUrl,
        providers: other.identities.map((i) => i.provider),
        profileProvider: other.identities[0]?.provider ?? "google",
        groupCount: otherGroups.length,
        groups: otherGroups.map((g) => ({ ...g, shared: keptIds.has(g.id) })),
      },
    };
    pendingMerges.set(mergeId, { preview, kept, other });
    return preview;
  }

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
      case "GET /api/v1/flights/daily":
        return json(api.dailyFlights);
      case "GET /api/v1/stats/spending":
        return authed === undefined ? error("UNAUTHORIZED", 401) : json(api.spendingStats);
      case "GET /api/v1/stats/expenses":
        return authed === undefined
          ? error("UNAUTHORIZED", 401)
          : json({ items: api.spendingDetails, nextCursor: null });
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
      case "POST /api/v1/auth/link-code": {
        if (authed === undefined) return error("UNAUTHORIZED", 401);
        const code = `code-${String(api.linkCodes.size + 1)}`;
        api.linkCodes.set(code, authed);
        return json({ code });
      }
      case "POST /api/v1/auth/link-code/redeem": {
        const { code, idToken } = await readJson(init);
        if (typeof idToken !== "string" || !idToken.startsWith("fake|")) {
          return error("ID_TOKEN_INVALID", 401);
        }
        const owner = typeof code === "string" ? api.linkCodes.get(code) : undefined;
        if (owner === undefined) return error("LINK_CODE_INVALID", 422);
        api.linkCodes.delete(String(code));
        const [, sub = ""] = idToken.split("|");
        const existingOwner = api.googleOwners.get(sub);
        if (existingOwner !== undefined && existingOwner.id !== owner.id) {
          const preview = createPendingMerge(owner, existingOwner, "linkCode");
          tokenSeq += 1;
          const confirmationToken = `confirm-${tokenSeq}`;
          confirmTokens.set(confirmationToken, { kept: owner, mergeId: preview.mergeId });
          return json({
            mergeNeeded: true,
            merge: preview,
            confirmationToken,
          });
        }
        const linked = {
          ...owner,
          identities: [
            ...owner.identities,
            { provider: "google" as const, email: "linked@example.com" },
          ],
        };
        return issue(linked);
      }
      case "GET /api/v1/auth/merge": {
        const confirm = bearer === undefined ? undefined : confirmTokens.get(bearer);
        const actor = authed ?? confirm?.kept;
        if (actor === undefined) return error("UNAUTHORIZED", 401);
        const match = [...pendingMerges.values()].find(
          (m) =>
            m.kept.id === actor.id &&
            (confirm === undefined || m.preview.mergeId === confirm.mergeId),
        );
        if (match === undefined) {
          return error(
            confirm !== undefined ? "UNAUTHORIZED" : "MERGE_PENDING_INVALID",
            confirm !== undefined ? 401 : 422,
          );
        }
        return json(match.preview);
      }
      case "POST /api/v1/auth/merge/confirm": {
        const confirm = bearer === undefined ? undefined : confirmTokens.get(bearer);
        const actor = authed ?? confirm?.kept;
        if (actor === undefined) return error("UNAUTHORIZED", 401);
        const { mergeId } = await readJson(init);
        const match = typeof mergeId === "string" ? pendingMerges.get(mergeId) : undefined;
        if (
          match === undefined ||
          match.kept.id !== actor.id ||
          (confirm !== undefined && confirm.mergeId !== mergeId)
        ) {
          return error(
            confirm !== undefined ? "UNAUTHORIZED" : "MERGE_PENDING_INVALID",
            confirm !== undefined ? 401 : 422,
          );
        }
        if (bearer !== undefined) confirmTokens.delete(bearer);
        pendingMerges.delete(String(mergeId));
        api.groups.repointUser(match.other.id, match.kept.id, api.failMergeGroups);
        const mergingGroupIds = api.groups
          .forUser(match.kept.id)
          .filter((g) => g.merging === true)
          .map((g) => g.id);
        const merged: Me = {
          ...match.kept,
          signedInWith: match.preview.path === "linkCode" ? "google" : match.kept.signedInWith,
          identities: [...match.kept.identities, ...match.other.identities],
        };
        cookieUser = merged;
        tokenSeq += 1;
        const accessToken = `access-${tokenSeq}`;
        liveTokens.set(accessToken, merged);
        return json({
          accessToken,
          expiresIn: 3600,
          user: merged,
          ...(mergingGroupIds.length > 0 ? { mergingGroupIds } : {}),
        });
      }
      case "POST /api/v1/auth/merge/cancel": {
        const confirm = bearer === undefined ? undefined : confirmTokens.get(bearer);
        const actor = authed ?? confirm?.kept;
        if (actor === undefined) return error("UNAUTHORIZED", 401);
        const { mergeId } = await readJson(init);
        if (confirm !== undefined && bearer !== undefined) {
          if (confirm.mergeId !== mergeId) return error("MERGE_PENDING_INVALID", 422);
          confirmTokens.delete(bearer);
        }
        if (typeof mergeId === "string") pendingMerges.delete(mergeId);
        return new Response(null, { status: 204 });
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

    const identity = /^POST \/api\/v1\/auth\/link\/(line|google)$/.exec(
      `${method} ${url.pathname}`,
    );
    if (identity !== null) {
      if (authed === undefined) return error("UNAUTHORIZED", 401);
      const provider = identity[1] === "line" ? "line" : "google";
      const others = authed.identities.filter((i) => i.provider !== provider);
      const { idToken } = await readJson(init);
      if (typeof idToken !== "string" || !idToken.startsWith("fake|")) {
        return error("ID_TOKEN_INVALID", 401);
      }
      if (api.refuseLink !== null) return error(api.refuseLink, 409);
      const [, sub = ""] = idToken.split("|");
      const owners = provider === "google" ? api.googleOwners : api.lineOwners;
      const existingOwner = owners.get(sub);
      if (existingOwner !== undefined && existingOwner.id !== authed.id) {
        if (authed.identities.some((i) => i.provider === provider)) {
          return error("PROVIDER_ALREADY_LINKED", 409);
        }
        return json({
          mergeNeeded: true,
          merge: createPendingMerge(authed, existingOwner, "settings"),
        });
      }
      if (authed.identities.some((i) => i.provider === provider)) {
        return error("PROVIDER_ALREADY_LINKED", 409);
      }
      return update({
        ...authed,
        identities: [
          ...others,
          { provider, email: provider === "google" ? "linked@example.com" : null },
        ],
      });
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
