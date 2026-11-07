import type { GroupLedger } from "./ledger.js";

/** Bindings declared in wrangler.jsonc, plus Worker secrets and local `.dev.vars`. */
export interface Bindings {
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  AI?: {
    run(
      model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      input: {
        messages: { role: string; content: string }[];
        response_format: { type: "json_object" };
      },
    ): Promise<unknown>;
  };
  GROQ_API_KEY?: string;
  FLIGHT_CONTAINER?: DurableObjectNamespace;
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
  /** Public: the LIFF app ID the chat carousel's portal bubble opens; unset, it opens this site. */
  LIFF_ID?: string;
  /** "1" enables the dev-only test sign-in route; never set in wrangler.jsonc. */
  TEST_SIGN_IN?: string;
}
