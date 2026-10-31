/** Bindings declared in wrangler.jsonc, plus Worker secrets and local `.dev.vars`. */
export interface Bindings {
  MAINTENANCE?: string;
  DB: D1Database;
  JWKS_CACHE: KVNamespace;
  ASSETS: Fetcher;
  /** Secret that signs access tokens (`wrangler secret put`; locally `.dev.vars`). */
  SESSION_SIGNING_KEY: string;
  /** Public: the Google OAuth client ID that Google ID tokens are issued to. */
  GOOGLE_CLIENT_ID: string;
  /** Public: the LINE Login channel ID that LIFF ID tokens are issued to. */
  LINE_LOGIN_CHANNEL_ID: string;
  /** Secret: the Messaging API channel secret that signs webhooks. Unset, every webhook is refused. */
  LINE_CHANNEL_SECRET?: string;
  /** Secret: the Messaging API channel access token for replies. Unset, replies are dropped. */
  LINE_CHANNEL_ACCESS_TOKEN?: string;
  /** "1" enables the dev-only test sign-in route; never set in wrangler.jsonc. */
  TEST_SIGN_IN?: string;
}
