import type { Provider } from "@split/shared";
import { createLocalJWKSet, errors, type JSONWebKeySet, jwtVerify } from "jose";
import { ApiError } from "../errors.js";

export type { Provider } from "@split/shared";

/** What the Worker keeps from a provider sign-in: never email, never the provider token. */
export interface VerifiedIdentity {
  provider: Provider;
  sub: string;
  displayName: string;
  pictureUrl: string | null;
}

/** Checks a Google or LINE ID token; throws ApiError ID_TOKEN_INVALID when it does not verify. */
export interface IdentityVerifier {
  verify(provider: Provider, idToken: string): Promise<VerifiedIdentity>;
}

/** Downloads a provider's public keys. Tests pass a fake; production uses `fetch`. */
export type JwksFetcher = (url: string) => Promise<JSONWebKeySet>;

interface ProviderRules {
  jwksUrl: string;
  issuer: string[];
  audience: string;
  algorithms: string[];
}

export const JWKS_URLS = {
  google: "https://www.googleapis.com/oauth2/v3/certs",
  line: "https://api.line.me/oauth2/v2.1/certs",
} as const satisfies Record<Provider, string>;

/** How long a provider's key set stays in KV before it is downloaded again. */
export const JWKS_CACHE_TTL_SECONDS = 3600;

/** Used when a token carries no `name` claim, since a User always has a display name. */
export const FALLBACK_DISPLAY_NAME = "使用者";

export interface JoseVerifierOptions {
  cache: KVNamespace;
  fetchJwks: JwksFetcher;
  googleClientId: string;
  lineChannelId: string;
  now: () => number;
}

/**
 * Verifies ID tokens locally with `jose` against the provider's JWKS, cached in KV.
 * A token signed by a key the cached set lacks (the provider rotated keys) triggers one
 * fresh download before it is refused.
 */
export function createJoseVerifier(options: JoseVerifierOptions): IdentityVerifier {
  const rules: Record<Provider, ProviderRules> = {
    google: {
      jwksUrl: JWKS_URLS.google,
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: options.googleClientId,
      algorithms: ["RS256"],
    },
    line: {
      jwksUrl: JWKS_URLS.line,
      issuer: ["https://access.line.me"],
      audience: options.lineChannelId,
      algorithms: ["ES256"],
    },
  };

  async function freshKeys(provider: Provider): Promise<JSONWebKeySet> {
    const keys = await options.fetchJwks(rules[provider].jwksUrl);
    await options.cache.put(cacheKey(provider), JSON.stringify(keys), {
      expirationTtl: JWKS_CACHE_TTL_SECONDS,
    });
    return keys;
  }

  async function verifyWith(provider: Provider, idToken: string, keys: JSONWebKeySet) {
    const { issuer, audience, algorithms } = rules[provider];
    return jwtVerify(idToken, createLocalJWKSet(keys), {
      issuer,
      audience,
      algorithms,
      currentDate: new Date(options.now()),
      requiredClaims: ["sub", "exp"],
    });
  }

  return {
    async verify(provider, idToken) {
      try {
        const cached = await options.cache.get<JSONWebKeySet>(cacheKey(provider), "json");
        let result;
        try {
          result = await verifyWith(provider, idToken, cached ?? (await freshKeys(provider)));
        } catch (error) {
          if (cached === null || !(error instanceof errors.JWKSNoMatchingKey)) throw error;
          result = await verifyWith(provider, idToken, await freshKeys(provider));
        }
        const { sub, name, picture } = result.payload;
        if (typeof sub !== "string" || sub === "") throw new ApiError("ID_TOKEN_INVALID");
        return {
          provider,
          sub,
          displayName:
            typeof name === "string" && name.trim() !== "" ? name.trim() : FALLBACK_DISPLAY_NAME,
          pictureUrl: typeof picture === "string" && picture !== "" ? picture : null,
        };
      } catch (error) {
        if (error instanceof errors.JOSEError || error instanceof ApiError) {
          throw new ApiError("ID_TOKEN_INVALID");
        }
        throw error;
      }
    },
  };
}

function cacheKey(provider: Provider): string {
  return `jwks:${provider}`;
}

/** The production key download. */
export const fetchJwks: JwksFetcher = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`JWKS download failed: ${res.status}`);
  const body = await res.json<JSONWebKeySet>();
  if (!Array.isArray(body.keys)) throw new Error("JWKS download returned no keys");
  return body;
};
