import { createJoseVerifier, fetchJwks, type IdentityVerifier } from "./auth/identity-verifier.js";
import type { Bindings } from "./env.js";
import {
  createLineReplyClient,
  type LineReplyClient,
  silentReplyClient,
} from "./line/reply-client.js";

/** Outside services and the clock, swapped for fakes in tests. */
export interface AppDeps {
  verifier: (env: Bindings) => IdentityVerifier;
  now: () => number;
  lineReplyClient: (env: Bindings) => LineReplyClient;
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
  lineReplyClient: (env) =>
    env.LINE_CHANNEL_ACCESS_TOKEN === undefined || env.LINE_CHANNEL_ACCESS_TOKEN === ""
      ? silentReplyClient
      : createLineReplyClient(env.LINE_CHANNEL_ACCESS_TOKEN),
};
