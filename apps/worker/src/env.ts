/** Bindings declared in wrangler.jsonc. */
export interface Bindings {
  DB: D1Database;
  JWKS_CACHE: KVNamespace;
  ASSETS: Fetcher;
}
