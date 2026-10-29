import type { AppType } from "@split/worker";
import { type ClientRequestOptions, hc } from "hono/client";

/** The Worker's typed client (decision 20); `fetch` decides whether calls carry a session. */
export function createApiClient(fetchImpl: typeof fetch) {
  return hc<AppType>("/", { fetch: fetchImpl }).api.v1;
}

export type ApiClient = ReturnType<typeof createApiClient>;

/**
 * Request options carrying a JSON body. The Worker validates bodies with `parseBody`
 * rather than a Hono validator, so the typed client has no `json` input for them.
 */
export function withJson(body: unknown): ClientRequestOptions {
  return {
    init: { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } },
  };
}
