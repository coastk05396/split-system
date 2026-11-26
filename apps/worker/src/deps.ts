import {
  createJoseVerifier,
  fetchJwks,
  type IdentityVerifier,
  type Provider,
  type VerifiedIdentity,
} from "./auth/identity-verifier.js";
import type { Bindings } from "./env.js";
import { serpApiFlightSource, type FlightSource } from "./flights/daily.js";
import {
  createLineReplyClient,
  type LineReplyClient,
  silentReplyClient,
} from "./line/reply-client.js";
import { productionRateSource, type RateSource } from "./rates/rate-source.js";

/** Outside services and the clock, swapped for fakes in tests. */
export interface AppDeps {
  verifier: (env: Bindings) => IdentityVerifier;
  now: () => number;
  /** Reference Exchange rates: Frankfurter with the ExchangeRate-API fallback. */
  rateSource: RateSource;
  lineReplyClient: (env: Bindings) => LineReplyClient;
  /** Optional flight source; defaults to the SerpApi Explore source when omitted. */
  flightSource?: (env: Bindings) => FlightSource;
}

const verifiers = new WeakMap<Bindings, IdentityVerifier>();

function parseTestToken(provider: Provider, idToken: string): VerifiedIdentity | null {
  if (idToken.startsWith("fake|")) {
    const [, sub, name, email] = idToken.split("|");
    if (sub === undefined || sub === "" || name === undefined || name === "") return null;
    return {
      provider,
      sub,
      displayName: name,
      pictureUrl: `https://pic/${sub}`,
      email: provider === "google" && email !== undefined && email !== "" ? email : null,
    };
  }
  if (idToken.startsWith("fake.")) {
    const payloadPart = idToken.split(".")[1];
    if (payloadPart === undefined) return null;
    try {
      const padded = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
      const raw = JSON.parse(atob(padded)) as {
        sub?: unknown;
        name?: unknown;
        email?: unknown;
      };
      if (
        typeof raw.sub !== "string" ||
        raw.sub === "" ||
        typeof raw.name !== "string" ||
        raw.name === ""
      ) {
        return null;
      }
      return {
        provider,
        sub: raw.sub,
        displayName: raw.name,
        pictureUrl: null,
        email:
          provider === "google" && typeof raw.email === "string" && raw.email !== ""
            ? raw.email
            : null,
      };
    } catch {
      return null;
    }
  }
  return null;
}

export const productionDeps = {
  verifier: (env: Bindings) => {
    const existing = verifiers.get(env);
    if (existing !== undefined) return existing;
    const jose = createJoseVerifier({
      cache: env.JWKS_CACHE,
      fetchJwks,
      googleClientId: env.GOOGLE_CLIENT_ID,
      lineChannelId: env.LINE_LOGIN_CHANNEL_ID,
      now: Date.now,
    });
    const verifier: IdentityVerifier =
      env.TEST_SIGN_IN === "1"
        ? {
            verify: (provider, idToken) => {
              const fake = parseTestToken(provider, idToken);
              return fake !== null ? Promise.resolve(fake) : jose.verify(provider, idToken);
            },
          }
        : jose;
    verifiers.set(env, verifier);
    return verifier;
  },
  now: Date.now,
  rateSource: productionRateSource(),
  lineReplyClient: (env: Bindings) =>
    env.LINE_CHANNEL_ACCESS_TOKEN === undefined || env.LINE_CHANNEL_ACCESS_TOKEN === ""
      ? silentReplyClient
      : createLineReplyClient(env.LINE_CHANNEL_ACCESS_TOKEN),
  flightSource: (env: Bindings) => serpApiFlightSource(env),
} satisfies AppDeps;
