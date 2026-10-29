import { env } from "cloudflare:workers";
import { createApp } from "../src/app.js";
import type { Bindings } from "../src/env.js";
import { ApiError } from "../src/errors.js";
import { silentReplyClient } from "../src/line/reply-client.js";
import type { RateSource } from "../src/rates/rate-source.js";
import type {
  IdentityVerifier,
  Provider,
  VerifiedIdentity,
} from "../src/auth/identity-verifier.js";

/**
 * A fake provider: an ID token is `fake|<sub>|<name>` and is accepted for either provider.
 * The real verifier has its own tests with locally generated keys.
 */
export const fakeVerifier: IdentityVerifier = {
  verify(provider: Provider, idToken: string): Promise<VerifiedIdentity> {
    const [tag, sub, name] = idToken.split("|");
    if (tag !== "fake" || sub === undefined || name === undefined) {
      return Promise.reject(new ApiError("ID_TOKEN_INVALID"));
    }
    return Promise.resolve({ provider, sub, displayName: name, pictureUrl: `https://pic/${sub}` });
  },
};

export const clock = { now: 1_750_000_000_000 };

/** Tests never reach the network: rate tests build their own app with a steerable source. */
export const offlineRateSource: RateSource = {
  fetchRate: () => Promise.reject(new Error("offline")),
};

export const testApp = createApp({
  verifier: () => fakeVerifier,
  now: () => clock.now,
  rateSource: offlineRateSource,
  lineReplyClient: () => silentReplyClient,
});

let counter = 0;
/** A provider `sub` no other test uses: storage is shared across tests in a file. */
export function uniqueSub(label: string): string {
  counter += 1;
  return `${label}-${counter}-${crypto.randomUUID()}`;
}

export function call(
  path: string,
  init: RequestInit = {},
  bindings: { [K in keyof Bindings]?: Bindings[K] | undefined } = {},
): Promise<Response> {
  return Promise.resolve(
    testApp.request(`https://split.test/api/v1${path}`, init, { ...env, ...bindings }),
  );
}

export function json(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}

export function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/** The refresh token value from a response's Set-Cookie, or undefined. */
export function refreshCookie(res: Response): string | undefined {
  const header = res.headers.get("Set-Cookie") ?? "";
  return /(?:^|,\s*)refresh=([^;]*)/.exec(header)?.[1];
}

export function withCookie(token: string, init: RequestInit = { method: "POST" }): RequestInit {
  return {
    ...init,
    headers: { ...(init.headers as Record<string, string>), Cookie: `refresh=${token}` },
  };
}

export interface Session {
  accessToken: string;
  refresh: string;
  userId: string;
}

export async function signIn(provider: Provider, sub: string, name = "小宇"): Promise<Session> {
  const res = await call(`/auth/${provider}`, json({ idToken: `fake|${sub}|${name}` }));
  if (res.status !== 200) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);
  const body = await res.json<{ accessToken: string; user: { id: string } }>();
  const refresh = refreshCookie(res);
  if (refresh === undefined) throw new Error("no refresh cookie");
  return { accessToken: body.accessToken, refresh, userId: body.user.id };
}
