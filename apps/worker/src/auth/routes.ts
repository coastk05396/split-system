import {
  ACCESS_TOKEN_TTL_SECONDS,
  idTokenRequestSchema,
  mePatchSchema,
  providerSchema,
  REFRESH_TOKEN_TTL_SECONDS,
  type SessionResponse,
  testSignInRequestSchema,
} from "@split/shared";
import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "../api.js";
import { createDb } from "../db/client.js";
import type { AppDeps } from "../deps.js";
import { ApiError } from "../errors.js";
import { parseBody } from "../request-guards.js";
import {
  createSession,
  deleteAccount,
  endAllSessions,
  endSession,
  linkIdentity,
  loadMe,
  rotateSession,
  updateSettings,
  signInIdentity,
  unlinkIdentity,
} from "./accounts.js";
import type { Provider, VerifiedIdentity } from "./identity-verifier.js";
import { requireUser } from "./require-user.js";
import { type RefreshToken, signAccessToken } from "./tokens.js";

const REFRESH_COOKIE = "refresh";
const COOKIE_PATH = "/api/v1/auth";

function setRefreshCookie(c: Context, refresh: RefreshToken): void {
  setCookie(c, REFRESH_COOKIE, refresh.token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: COOKIE_PATH,
    maxAge: REFRESH_TOKEN_TTL_SECONDS,
  });
}

function clearRefreshCookie(c: Context): void {
  deleteCookie(c, REFRESH_COOKIE, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: COOKIE_PATH,
  });
}

/** Sign-in, sessions, Identity linking and the account itself (SPEC §5.1, decisions 09, 26). */
export function authRoutes(deps: AppDeps) {
  const signedIn = requireUser(deps.now);

  async function issueSession(
    c: Context<AppEnv>,
    userId: string,
    refresh: RefreshToken,
  ): Promise<SessionResponse> {
    const me = await loadMe(createDb(c.env.DB), userId);
    if (me === null) throw new ApiError("UNAUTHORIZED");
    setRefreshCookie(c, refresh);
    const accessToken = await signAccessToken(userId, c.env.SESSION_SIGNING_KEY, deps.now());
    return { accessToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS, user: me };
  }

  async function signIn(c: Context<AppEnv>, identity: VerifiedIdentity) {
    const db = createDb(c.env.DB);
    const now = deps.now();
    const userId = await signInIdentity(db, identity, now);
    const refresh = await createSession(db, userId, c.req.header("User-Agent"), now);
    return c.json(await issueSession(c, userId, refresh), 200);
  }

  async function verify<E extends AppEnv>(c: Context<E>, provider: Provider) {
    const { idToken } = await parseBody(c, idTokenRequestSchema);
    return deps.verifier(c.env).verify(provider, idToken);
  }

  function readProvider(value: string): Provider {
    const parsed = providerSchema.safeParse(value);
    if (!parsed.success) throw new ApiError("NOT_FOUND");
    return parsed.data;
  }

  return new Hono<AppEnv>()
    .post("/auth/google", async (c) => signIn(c, await verify(c, "google")))
    .post("/auth/line", async (c) => signIn(c, await verify(c, "line")))
    .post("/auth/test-sign-in", async (c) => {
      // Dev and browser-test shortcut (SPEC §7.3): absent unless the flag is exactly "1".
      if (c.env.TEST_SIGN_IN !== "1") throw new ApiError("NOT_FOUND");
      const body = await parseBody(c, testSignInRequestSchema);
      return signIn(c, { ...body, pictureUrl: null });
    })
    .post("/auth/refresh", async (c) => {
      const presented = getCookie(c, REFRESH_COOKIE);
      const rotated =
        presented === undefined
          ? null
          : await rotateSession(createDb(c.env.DB), presented, deps.now());
      if (rotated === null) {
        clearRefreshCookie(c);
        throw new ApiError("UNAUTHORIZED");
      }
      return c.json(await issueSession(c, rotated.userId, rotated.refresh), 200);
    })
    .post("/auth/logout", async (c) => {
      const presented = getCookie(c, REFRESH_COOKIE);
      if (presented !== undefined) await endSession(createDb(c.env.DB), presented);
      clearRefreshCookie(c);
      return c.body(null, 204);
    })
    .post("/auth/logout-all", signedIn, async (c) => {
      await endAllSessions(createDb(c.env.DB), c.var.userId);
      clearRefreshCookie(c);
      return c.body(null, 204);
    })
    .post("/auth/link/:provider", signedIn, async (c) => {
      const provider = readProvider(c.req.param("provider"));
      const identity = await verify(c, provider);
      const db = createDb(c.env.DB);
      await linkIdentity(db, c.var.userId, identity, deps.now());
      return c.json(await requireMe(db, c.var.userId), 200);
    })
    .delete("/auth/identities/:provider", signedIn, async (c) => {
      const provider = readProvider(c.req.param("provider"));
      const db = createDb(c.env.DB);
      await unlinkIdentity(db, c.var.userId, provider);
      return c.json(await requireMe(db, c.var.userId), 200);
    })
    .get("/me", signedIn, async (c) =>
      c.json(await requireMe(createDb(c.env.DB), c.var.userId), 200),
    )
    .patch("/me", signedIn, async (c) => {
      const patch = await parseBody(c, mePatchSchema);
      const db = createDb(c.env.DB);
      await updateSettings(db, c.var.userId, patch, deps.now());
      return c.json(await requireMe(db, c.var.userId), 200);
    })
    .delete("/me", signedIn, async (c) => {
      await deleteAccount(createDb(c.env.DB), c.var.userId);
      clearRefreshCookie(c);
      return c.body(null, 204);
    });
}

/** A valid access token can outlive its account by up to an hour; treat that as signed out. */
async function requireMe(db: ReturnType<typeof createDb>, userId: string) {
  const me = await loadMe(db, userId);
  if (me === null) throw new ApiError("UNAUTHORIZED");
  return me;
}
