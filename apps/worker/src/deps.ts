import { createJoseVerifier, fetchJwks, type IdentityVerifier } from "./auth/identity-verifier.js";
import type { Bindings } from "./env.js";
import { productionRateSource, type RateSource } from "./rates/rate-source.js";

/** Outside services and the clock, swapped for fakes in tests. */
export interface AppDeps {
  verifier: (env: Bindings) => IdentityVerifier;
  now: () => number;
  /** Reference Exchange rates: Frankfurter with the ExchangeRate-API fallback. */
  rateSource: RateSource;
}

export const productionDeps: AppDeps = {
  verifier: (env) =>
    createJoseVerifier({
      cache: env.JWKS_CACHE,
      fetchJwks,
      googleClientId: env.GOOGLE_CLIENT_ID,
      lineChannelId: env.LINE_LOGIN_CHANNEL_ID,
      now: Date.now,
    }),
  now: Date.now,
  rateSource: productionRateSource(),
};
