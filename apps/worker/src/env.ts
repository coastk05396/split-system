import type { GroupLedger } from "./ledger.js";

/** Bindings declared in wrangler.jsonc, plus Worker secrets and local `.dev.vars`. */
export interface Bindings {
  MAINTENANCE?: string;
  DB: D1Database;
  GROUP_LEDGER: DurableObjectNamespace<GroupLedger>;
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
  /** Secret: SerpApi key for Baseline lookups (`google_flights`) only (ADR 0014). */
  SERPAPI_KEY_BASELINE?: string;
  /** Secret: SerpApi key for the short-haul (Asia, Japan and Korea) Explore queries. */
  SERPAPI_KEY_SHORT?: string;
  /** Secret: SerpApi key for the Europe, North America, Oceania and Middle East Explore queries. */
  SERPAPI_KEY_LONG?: string;
  /** Optional Trip.com affiliate Allianceid. */
  TRIP_COM_ALLIANCE_ID?: string;
  /** Optional Trip.com affiliate SID. */
  TRIP_COM_SID?: string;
  /** Optional Trip.com affiliate `trip_sub3`: a fixed account value, sent with Allianceid and SID. */
  TRIP_COM_SUB3?: string;
}
