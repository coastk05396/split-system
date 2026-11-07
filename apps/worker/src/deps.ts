import type { WebPushSender } from "./flights/web-push.js";
import type { FlightAI } from "./flights/ai.js";
import type { FlightAdvisor } from "./flights/advice.js";
import type { FlightSource } from "./flights/source.js";
import { createJoseVerifier, fetchJwks, type IdentityVerifier } from "./auth/identity-verifier.js";
import type { Bindings } from "./env.js";
import {
  createLineReplyClient,
  type LineReplyClient,
  silentReplyClient,
} from "./line/reply-client.js";
import { productionRateSource, type RateSource } from "./rates/rate-source.js";

/** Outside services and the clock, swapped for fakes in tests. */
export interface AppDeps {
  flightSource?: FlightSource;
  webPushSender?: WebPushSender;
  flightAI?: FlightAI;
  flightAdvisor?: FlightAdvisor;
  verifier: (env: Bindings) => IdentityVerifier;
  now: () => number;
  /** Reference Exchange rates: Frankfurter with the ExchangeRate-API fallback. */
  rateSource: RateSource;
  lineReplyClient: (env: Bindings) => LineReplyClient;
}

const verifiers = new WeakMap<Bindings, IdentityVerifier>();

export const productionDeps: AppDeps = {
  verifier: (env) => {
    const existing = verifiers.get(env);
    if (existing !== undefined) return existing;
    const verifier = createJoseVerifier({
      cache: env.JWKS_CACHE,
      fetchJwks,
      googleClientId: env.GOOGLE_CLIENT_ID,
      lineChannelId: env.LINE_LOGIN_CHANNEL_ID,
      now: Date.now,
    });
    verifiers.set(env, verifier);
    return verifier;
  },
  now: Date.now,
  rateSource: productionRateSource(),
  lineReplyClient: (env) =>
    env.LINE_CHANNEL_ACCESS_TOKEN === undefined || env.LINE_CHANNEL_ACCESS_TOKEN === ""
      ? silentReplyClient
      : createLineReplyClient(env.LINE_CHANNEL_ACCESS_TOKEN),
};
