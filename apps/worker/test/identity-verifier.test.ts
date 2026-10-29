import { env } from "cloudflare:workers";
import {
  base64url,
  exportJWK,
  generateKeyPair,
  type JSONWebKeySet,
  type JWTPayload,
  SignJWT,
} from "jose";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createJoseVerifier,
  type IdentityVerifier,
  JWKS_URLS,
} from "../src/auth/identity-verifier.js";
import { ApiError } from "../src/errors.js";

const NOW = 1_750_000_000_000;
const NOW_S = NOW / 1000;
const LINE_CHANNEL = "1234567890";
const GOOGLE_CLIENT = "client.apps.googleusercontent.com";

type Alg = "ES256" | "RS256";

async function keyPair(alg: Alg, kid: string) {
  const { privateKey, publicKey } = await generateKeyPair(alg, { extractable: true });
  return { privateKey, kid, alg, jwk: { ...(await exportJWK(publicKey)), kid, alg, use: "sig" } };
}
type Key = Awaited<ReturnType<typeof keyPair>>;

function sign(key: Key, claims: JWTPayload): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: key.alg, kid: key.kid })
    .sign(key.privateKey);
}

const lineClaims = (over: JWTPayload = {}): JWTPayload => ({
  iss: "https://access.line.me",
  aud: LINE_CHANNEL,
  sub: "U1234",
  name: "小宇",
  picture: "https://profile.line-scdn.net/abc",
  iat: NOW_S - 60,
  exp: NOW_S + 3600,
  ...over,
});

function withoutSub(): JWTPayload {
  const { sub: _sub, ...rest } = lineClaims();
  return rest;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

describe("createJoseVerifier", () => {
  let lineKey: Key;
  let googleKey: Key;
  let published: Record<string, JSONWebKeySet>;
  let downloads: string[];
  let verifier: IdentityVerifier;

  beforeEach(async () => {
    lineKey = await keyPair("ES256", `line-${crypto.randomUUID()}`);
    googleKey = await keyPair("RS256", `google-${crypto.randomUUID()}`);
    published = {
      [JWKS_URLS.line]: { keys: [lineKey.jwk] },
      [JWKS_URLS.google]: { keys: [googleKey.jwk] },
    };
    downloads = [];
    await env.JWKS_CACHE.delete("jwks:line");
    await env.JWKS_CACHE.delete("jwks:google");
    verifier = createJoseVerifier({
      cache: env.JWKS_CACHE,
      fetchJwks: (url) => {
        downloads.push(url);
        const keys = published[url];
        return keys === undefined
          ? Promise.reject(new Error("unknown url"))
          : Promise.resolve(keys);
      },
      googleClientId: GOOGLE_CLIENT,
      lineChannelId: LINE_CHANNEL,
      now: () => NOW,
    });
  });

  it("accepts a LIFF ES256 token and keeps only sub, name and picture", async () => {
    const identity = await verifier.verify(
      "line",
      await sign(lineKey, lineClaims({ email: "x@y.z" })),
    );
    expect(identity).toEqual({
      provider: "line",
      sub: "U1234",
      displayName: "小宇",
      pictureUrl: "https://profile.line-scdn.net/abc",
    });
  });

  it("accepts a Google RS256 token from either Google issuer", async () => {
    for (const iss of ["https://accounts.google.com", "accounts.google.com"]) {
      const token = await sign(googleKey, { iss, aud: GOOGLE_CLIENT, sub: "g-1", exp: NOW_S + 60 });
      expect(await verifier.verify("google", token)).toMatchObject({
        sub: "g-1",
        pictureUrl: null,
      });
    }
  });

  it.each([
    ["an expired token", lineClaims({ exp: NOW_S - 1 })],
    ["the wrong audience", lineClaims({ aud: "someone-else" })],
    ["the wrong issuer", lineClaims({ iss: "https://evil.example" })],
    ["no subject", withoutSub()],
  ])("refuses %s", async (_label, claims) => {
    const error = await rejection(verifier.verify("line", await sign(lineKey, claims)));
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("ID_TOKEN_INVALID");
  });

  it("refuses a tampered signature and a token signed by an unpublished key", async () => {
    const token = await sign(lineKey, lineClaims());
    const [header, , signature] = token.split(".");
    const forgedBody = base64url.encode(JSON.stringify(lineClaims({ sub: "U-attacker" })));
    const tampered = `${header ?? ""}.${forgedBody}.${signature ?? ""}`;
    expect(await rejection(verifier.verify("line", tampered))).toMatchObject({
      code: "ID_TOKEN_INVALID",
    });

    const stranger = await keyPair("ES256", lineKey.kid);
    const forged = await sign(stranger, lineClaims());
    expect(await rejection(verifier.verify("line", forged))).toMatchObject({
      code: "ID_TOKEN_INVALID",
    });
  });

  it("refuses a LINE token checked as Google and garbage input", async () => {
    const token = await sign(lineKey, lineClaims());
    expect(await rejection(verifier.verify("google", token))).toMatchObject({
      code: "ID_TOKEN_INVALID",
    });
    expect(await rejection(verifier.verify("line", "not.a.jwt"))).toMatchObject({
      code: "ID_TOKEN_INVALID",
    });
  });

  it("caches the key set in KV and downloads again when the provider rotates keys", async () => {
    await verifier.verify("line", await sign(lineKey, lineClaims()));
    await verifier.verify("line", await sign(lineKey, lineClaims()));
    expect(downloads).toEqual([JWKS_URLS.line]);
    expect(await env.JWKS_CACHE.get("jwks:line", "json")).toEqual({ keys: [lineKey.jwk] });

    const rotated = await keyPair("ES256", `line-${crypto.randomUUID()}`);
    published[JWKS_URLS.line] = { keys: [rotated.jwk] };
    await verifier.verify("line", await sign(rotated, lineClaims()));
    expect(downloads).toEqual([JWKS_URLS.line, JWKS_URLS.line]);
  });
});
