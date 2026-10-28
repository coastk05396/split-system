import { createJoseVerifier, fetchJwks, type IdentityVerifier } from "./auth/identity-verifier.js";
import type { Bindings } from "./env.js";

/** Outside services and the clock, swapped for fakes in tests. */
export interface AppDeps {
  verifier: (env: Bindings) => IdentityVerifier;
  now: () => number;
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
};
