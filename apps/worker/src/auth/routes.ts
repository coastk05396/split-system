import {
  ACCESS_TOKEN_TTL_SECONDS,
  confirmMergeRequestSchema,
  idTokenRequestSchema,
  mePatchSchema,
  providerSchema,
  redeemLinkCodeRequestSchema,
  SESSION_MAX_AGE_SECONDS,
  type SessionResponse,
  testSignInRequestSchema,
} from "@split/shared";
import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../api.js";
import { createDb } from "../db/client.js";
import type { AppDeps } from "../deps.js";
import { ApiError } from "../errors.js";
import { parseBody, sameOriginWrites } from "../request-guards.js";
import {
  cancelMerge,
  confirmMerge,
  createConfirmationSession,
  createLinkCode,
  createPendingMerge,
  createSession,
  deleteAccount,
  deleteSessionById,
  endSession,
  getPendingMerge,
  hasActivePendingMerge,
  linkIdentity,
  loadMe,
  redeemLinkCode,
  rotateSession,
  updateSettings,
  signInIdentity,
} from "./accounts.js";
import { bearerToken } from "./bearer-token.js";
import type { Provider, VerifiedIdentity } from "./identity-verifier.js";
import { requireUser } from "./require-user.js";
import {
  type RefreshToken,
  signAccessToken,
  signMergeConfirmToken,
  verifyAccess,
  verifyMergeConfirmToken,
} from "./tokens.js";

const REFRESH_COOKIE = "refresh";
const COOKIE_PATH = "/api/v1/auth";

function setRefreshCookie(c: Context, refresh: RefreshToken): void {
  setCookie(c, REFRESH_COOKIE, refresh.token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: COOKIE_PATH,
    maxAge: SESSION_MAX_AGE_SECONDS,
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
  const mergeActor = createMiddleware<{
    Bindings: AppEnv["Bindings"];
    Variables: AppEnv["Variables"] & {
      userId: string;
      signedInWith: Provider | null;
      sessionId: string | null;
      confirmMergeId: string | null;
    };
  }>(async (c, next) => {
    const token = bearerToken(c.req.header("Authorization"));
    if (token === undefined) throw new ApiError("UNAUTHORIZED");
    const now = deps.now();
    const access = await verifyAccess(token, c.env.SESSION_SIGNING_KEY, now);
    if (access !== null) {
      c.set("userId", access.userId);
      c.set("signedInWith", access.provider);
      c.set("sessionId", access.sessionId);
      c.set("confirmMergeId", null);
      await next();
      return;
    }
    const confirm = await verifyMergeConfirmToken(token, c.env.SESSION_SIGNING_KEY, now);
    if (confirm === null) throw new ApiError("UNAUTHORIZED");
    const active = await hasActivePendingMerge(
      createDb(c.env.DB),
      confirm.mergeId,
      confirm.userId,
      confirm.sessionId,
      now,
    );
    if (!active) throw new ApiError("UNAUTHORIZED");
    c.set("userId", confirm.userId);
    c.set("signedInWith", null);
    c.set("sessionId", confirm.sessionId);
    c.set("confirmMergeId", confirm.mergeId);
    await next();
  });

  async function issueSession<E extends AppEnv>(
    c: Context<E>,
    userId: string,
    provider: Provider | null,
    refresh: RefreshToken,
  ): Promise<SessionResponse> {
    const me = await loadMe(createDb(c.env.DB), userId, provider);
    if (me === null) throw new ApiError("UNAUTHORIZED");
    setRefreshCookie(c, refresh);
    const accessToken = await signAccessToken(
      userId,
      c.env.SESSION_SIGNING_KEY,
      deps.now(),
      provider,
      refresh.sessionId,
    );
    return { accessToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS, user: me };
  }

  async function signIn(c: Context<AppEnv>, identity: VerifiedIdentity) {
    const db = createDb(c.env.DB);
    const now = deps.now();
    const userId = await signInIdentity(db, identity, now);
    const ua = c.req.header("User-Agent");
    const refresh = await createSession(db, userId, identity.provider, ua, now);
    return c.json(await issueSession(c, userId, identity.provider, refresh), 200);
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

  return (
    new Hono<AppEnv>()
      .use("/auth/*", sameOriginWrites)
      .post("/auth/google", async (c) => signIn(c, await verify(c, "google")))
      .post("/auth/line", async (c) => signIn(c, await verify(c, "line")))
      .post("/auth/test-sign-in", async (c) => {
        // Dev and browser-test shortcut (SPEC §7.3): absent unless the flag is exactly "1".
        if (c.env.TEST_SIGN_IN !== "1") throw new ApiError("NOT_FOUND");
        const body = await parseBody(c, testSignInRequestSchema);
        return signIn(c, { ...body, pictureUrl: null, email: null });
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
        return c.json(
          await issueSession(c, rotated.userId, rotated.provider, rotated.refresh),
          200,
        );
      })
      .post("/auth/logout", async (c) => {
        const presented = getCookie(c, REFRESH_COOKIE);
        if (presented !== undefined) await endSession(createDb(c.env.DB), presented);
        clearRefreshCookie(c);
        return c.body(null, 204);
      })
      .post("/auth/link/:provider", signedIn, async (c) => {
        const provider = readProvider(c.req.param("provider"));
        const identity = await verify(c, provider);
        const db = createDb(c.env.DB);
        const now = deps.now();
        const outcome = await linkIdentity(db, c.var.userId, identity, now);
        if (!outcome.mergeNeeded) {
          return c.json(await requireMe(db, c.var.userId, c.var.signedInWith), 200);
        }
        if (c.var.sessionId === null) throw new ApiError("MERGE_PENDING_INVALID");
        const merge = await createPendingMerge(db, {
          keptUserId: c.var.userId,
          otherUserId: outcome.otherUserId,
          sessionId: c.var.sessionId,
          path: "settings",
          otherProvider: outcome.otherProvider,
          otherEmail: outcome.otherEmail,
          now,
        });
        return c.json({ mergeNeeded: true as const, merge }, 200);
      })
      // From LINE's in-app browser, where Google refuses to sign in: the signed-in User gets a code
      // to open in an outside browser, whose Google sign-in then joins this same User.
      .post("/auth/link-code", signedIn, async (c) => {
        const code = await createLinkCode(createDb(c.env.DB), c.var.userId, deps.now());
        return c.json({ code }, 200);
      })
      .post("/auth/link-code/redeem", async (c) => {
        const { code, idToken } = await parseBody(c, redeemLinkCodeRequestSchema);
        const identity = await deps.verifier(c.env).verify("google", idToken);
        const db = createDb(c.env.DB);
        const now = deps.now();
        const ua = c.req.header("User-Agent");
        const outcome = await redeemLinkCode(db, code, identity, now);
        if (!outcome.mergeNeeded) {
          const refresh = await createSession(db, outcome.userId, "google", ua, now);
          return c.json(await issueSession(c, outcome.userId, "google", refresh), 200);
        }
        const sessionId = await createConfirmationSession(
          db,
          outcome.keptUserId,
          outcome.keptProvider,
          ua,
          now,
        );
        const merge = await createPendingMerge(db, {
          keptUserId: outcome.keptUserId,
          otherUserId: outcome.otherUserId,
          sessionId,
          path: "linkCode",
          otherProvider: outcome.otherProvider,
          otherEmail: outcome.otherEmail,
          now,
        });
        const confirmationToken = await signMergeConfirmToken(
          outcome.keptUserId,
          c.env.SESSION_SIGNING_KEY,
          now,
          sessionId,
          merge.mergeId,
        );
        return c.json({ mergeNeeded: true as const, merge, confirmationToken }, 200);
      })
      .get("/auth/merge", mergeActor, async (c) => {
        const preview = await getPendingMerge(
          createDb(c.env.DB),
          c.var.userId,
          c.var.sessionId,
          deps.now(),
        );
        return c.json(preview, 200);
      })
      .post("/auth/merge/cancel", mergeActor, async (c) => {
        const { mergeId } = await parseBody(c, confirmMergeRequestSchema);
        if (c.var.confirmMergeId !== null && c.var.confirmMergeId !== mergeId) {
          throw new ApiError("MERGE_PENDING_INVALID");
        }
        const db = createDb(c.env.DB);
        await cancelMerge(db, c.var.userId, c.var.sessionId, mergeId, deps.now());
        if (c.var.confirmMergeId !== null && c.var.sessionId !== null) {
          await deleteSessionById(db, c.var.sessionId, c.var.userId);
        }
        return c.body(null, 204);
      })
      .post("/auth/merge/confirm", mergeActor, async (c) => {
        const { mergeId } = await parseBody(c, confirmMergeRequestSchema);
        if (c.var.confirmMergeId !== null && c.var.confirmMergeId !== mergeId) {
          throw new ApiError("MERGE_PENDING_INVALID");
        }
        const db = createDb(c.env.DB);
        const now = deps.now();
        let merged: Awaited<ReturnType<typeof confirmMerge>>;
        try {
          merged = await confirmMerge(
            c.env,
            db,
            c.var.userId,
            c.var.sessionId,
            mergeId,
            now,
            c.var.signedInWith,
          );
        } catch (error) {
          if (
            !(error instanceof ApiError && error.code === "MERGE_BACKFILL_PENDING") &&
            c.var.confirmMergeId !== null &&
            c.var.sessionId !== null
          ) {
            await deleteSessionById(db, c.var.sessionId, c.var.userId).catch(() => undefined);
          }
          throw error;
        }
        if (c.var.confirmMergeId !== null) {
          if (c.var.sessionId !== null) {
            await deleteSessionById(db, c.var.sessionId, c.var.userId);
          }
          const refresh = await createSession(
            db,
            merged.userId,
            merged.provider ?? "google",
            c.req.header("User-Agent"),
            now,
          );
          const session = await issueSession(c, merged.userId, merged.provider, refresh);
          return c.json(
            {
              ...session,
              ...(merged.mergingGroupIds.length > 0
                ? { mergingGroupIds: merged.mergingGroupIds }
                : {}),
            },
            200,
          );
        }
        const me = await requireMe(db, merged.userId, merged.provider);
        const accessToken = await signAccessToken(
          merged.userId,
          c.env.SESSION_SIGNING_KEY,
          now,
          merged.provider,
          c.var.sessionId ?? undefined,
        );
        return c.json(
          {
            accessToken,
            expiresIn: ACCESS_TOKEN_TTL_SECONDS,
            user: me,
            ...(merged.mergingGroupIds.length > 0
              ? { mergingGroupIds: merged.mergingGroupIds }
              : {}),
          },
          200,
        );
      })
      .get("/me", signedIn, async (c) =>
        c.json(await requireMe(createDb(c.env.DB), c.var.userId, c.var.signedInWith), 200),
      )
      .patch("/me", signedIn, async (c) => {
        const patch = await parseBody(c, mePatchSchema);
        const db = createDb(c.env.DB);
        await updateSettings(db, c.var.userId, patch, deps.now());
        return c.json(await requireMe(db, c.var.userId, c.var.signedInWith), 200);
      })
      .delete("/me", signedIn, async (c) => {
        await deleteAccount(c.env, c.var.userId, deps.now);
        clearRefreshCookie(c);
        return c.body(null, 204);
      })
  );
}

/** A valid access token can outlive its account by up to an hour; treat that as signed out. */
async function requireMe(
  db: ReturnType<typeof createDb>,
  userId: string,
  signedInWith: Provider | null,
) {
  const me = await loadMe(db, userId, signedInWith);
  if (me === null) throw new ApiError("UNAUTHORIZED");
  return me;
}
