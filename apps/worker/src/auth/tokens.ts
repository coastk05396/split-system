import {
  ACCESS_TOKEN_TTL_SECONDS,
  MERGE_PENDING_TTL_MS,
  type Provider,
  providerSchema,
} from "@split/shared";
import { errors, jwtVerify, SignJWT } from "jose";

const ISSUER = "split";
const ALGORITHM = "HS256";
const MERGE_SCOPE = "merge";
const MERGE_CONFIRM_TTL_SECONDS = Math.floor(MERGE_PENDING_TTL_MS / 1000);

function signingKey(secret: string): Uint8Array {
  if (secret.length < 32) throw new Error("SESSION_SIGNING_KEY must be at least 32 characters");
  return new TextEncoder().encode(secret);
}

/** Signs the 1-hour access token. Requests check only this JWT, never the database. */
export function signAccessToken(
  userId: string,
  secret: string,
  now: number,
  provider: Provider | null,
  sessionId?: string,
): Promise<string> {
  const iat = Math.floor(now / 1000);
  const claims: Record<string, string> = {};
  if (provider !== null) claims["prv"] = provider;
  if (sessionId !== undefined) claims["sid"] = sessionId;
  return new SignJWT(claims)
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuer(ISSUER)
    .setSubject(userId)
    .setIssuedAt(iat)
    .setExpirationTime(iat + ACCESS_TOKEN_TTL_SECONDS)
    .sign(signingKey(secret));
}

/** The User ID in a valid access token, or null when it is missing, forged or expired. */
export async function verifyAccessToken(
  token: string,
  secret: string,
  now: number,
): Promise<string | null> {
  return (await verifyAccess(token, secret, now))?.userId ?? null;
}

/** Like `verifyAccessToken`, plus the provider and session ID the session signed in with. */
export async function verifyAccess(
  token: string,
  secret: string,
  now: number,
): Promise<{ userId: string; provider: Provider | null; sessionId: string | null } | null> {
  try {
    const { payload } = await jwtVerify(token, signingKey(secret), {
      issuer: ISSUER,
      algorithms: [ALGORITHM],
      currentDate: new Date(now),
      requiredClaims: ["sub", "exp"],
    });
    if (payload.sub === undefined || payload["scope"] !== undefined) return null;
    const provider = providerSchema.safeParse(payload["prv"]);
    const sid = typeof payload["sid"] === "string" ? payload["sid"] : null;
    return {
      userId: payload.sub,
      provider: provider.success ? provider.data : null,
      sessionId: sid,
    };
  } catch (error) {
    if (error instanceof errors.JOSEError) return null;
    throw error;
  }
}

/** Signs a short-lived credential restricted to previewing, confirming, or cancelling one pending Merge. */
export function signMergeConfirmToken(
  userId: string,
  secret: string,
  now: number,
  sessionId: string,
  mergeId: string,
): Promise<string> {
  const iat = Math.floor(now / 1000);
  return new SignJWT({ scope: MERGE_SCOPE, sid: sessionId, mid: mergeId })
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuer(ISSUER)
    .setSubject(userId)
    .setIssuedAt(iat)
    .setExpirationTime(iat + MERGE_CONFIRM_TTL_SECONDS)
    .sign(signingKey(secret));
}

/** Verifies a Merge confirmation token; rejects normal access tokens and expired tokens. */
export async function verifyMergeConfirmToken(
  token: string,
  secret: string,
  now: number,
): Promise<{ userId: string; sessionId: string; mergeId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, signingKey(secret), {
      issuer: ISSUER,
      algorithms: [ALGORITHM],
      currentDate: new Date(now),
      requiredClaims: ["sub", "exp", "sid", "mid", "scope"],
    });
    if (
      payload.sub === undefined ||
      payload["scope"] !== MERGE_SCOPE ||
      typeof payload["sid"] !== "string" ||
      typeof payload["mid"] !== "string"
    ) {
      return null;
    }
    return { userId: payload.sub, sessionId: payload["sid"], mergeId: payload["mid"] };
  } catch (error) {
    if (error instanceof errors.JOSEError) return null;
    throw error;
  }
}

/**
 * A refresh token is `<session id>.<secret>`. Only the secret's SHA-256 is stored, so the
 * session ID lets a reused (already rotated) token be told apart from an unknown one.
 */
export interface RefreshToken {
  sessionId: string;
  token: string;
  hash: string;
}

export async function newRefreshToken(sessionId: string): Promise<RefreshToken> {
  const secret = base64url(crypto.getRandomValues(new Uint8Array(32)));
  return { sessionId, token: `${sessionId}.${secret}`, hash: await hashSecret(secret) };
}

/** Splits a presented refresh token into its session ID and the hash of its secret. */
export async function readRefreshToken(
  token: string,
): Promise<{ sessionId: string; hash: string } | null> {
  const match = /^([A-Za-z0-9-]{1,64})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (match?.[1] === undefined || match[2] === undefined) return null;
  return { sessionId: match[1], hash: await hashSecret(match[2]) };
}

export async function hashSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
