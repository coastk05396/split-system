import { env } from "cloudflare:workers";
import {
  base64url,
  exportJWK,
  generateKeyPair,
  type JSONWebKeySet,
  type JWTPayload,
  SignJWT,
} from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createJoseVerifier,
  fetchJwks,
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
  let now: number;

  beforeEach(async () => {
    lineKey = await keyPair("ES256", `line-${crypto.randomUUID()}`);
    googleKey = await keyPair("RS256", `google-${crypto.randomUUID()}`);
    published = {
      [JWKS_URLS.line]: { keys: [lineKey.jwk] },
      [JWKS_URLS.google]: { keys: [googleKey.jwk] },
    };
    downloads = [];
    now = NOW;
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
      now: () => now,
    });
  });

  it("accepts a LIFF ES256 token and keeps only sub, name and picture (never its email)", async () => {
    const identity = await verifier.verify(
      "line",
      await sign(lineKey, lineClaims({ email: "x@y.z" })),
    );
    expect(identity).toEqual({
      provider: "line",
      sub: "U1234",
      displayName: "小宇",
      pictureUrl: "https://profile.line-scdn.net/abc",
      email: null,
    });
  });

  it("keeps a Google email only when Google says it is verified", async () => {
    const claims = { iss: "https://accounts.google.com", aud: GOOGLE_CLIENT, exp: NOW_S + 60 };
    const verified = await sign(googleKey, {
      ...claims,
      sub: "g-1",
      email: "rick@example.com",
      email_verified: true,
    });
    expect(await verifier.verify("google", verified)).toMatchObject({ email: "rick@example.com" });
    const unverified = await sign(googleKey, {
      ...claims,
      sub: "g-2",
      email: "who@example.com",
      email_verified: false,
    });
    expect(await verifier.verify("google", unverified)).toMatchObject({ email: null });
    expect(
      await verifier.verify("google", await sign(googleKey, { ...claims, sub: "g-3" })),
    ).toMatchObject({
      email: null,
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

    now += 60_000;
    const rotated = await keyPair("ES256", `line-${crypto.randomUUID()}`);
    published[JWKS_URLS.line] = { keys: [rotated.jwk] };
    await verifier.verify("line", await sign(rotated, lineClaims()));
    expect(downloads).toEqual([JWKS_URLS.line, JWKS_URLS.line]);
  });
  it("downloads only once for many fake kids within the refresh cooldown", async () => {
    for (let i = 0; i < 12; i++) {
      const token = await sign({ ...lineKey, kid: `fake-${i}` }, lineClaims());
      expect(await rejection(verifier.verify("line", token))).toMatchObject({
        code: "ID_TOKEN_INVALID",
      });
    }
    expect(downloads).toEqual([JWKS_URLS.line]);
    now += 60_000;
    await rejection(
      verifier.verify("line", await sign({ ...lineKey, kid: "fake-later" }, lineClaims())),
    );
    expect(downloads).toEqual([JWKS_URLS.line, JWKS_URLS.line]);
  });

  it("downloads again right after a failed download, not after the cooldown", async () => {
    published = {};
    await rejection(verifier.verify("line", await sign(lineKey, lineClaims())));

    published[JWKS_URLS.line] = { keys: [lineKey.jwk] };
    expect(await verifier.verify("line", await sign(lineKey, lineClaims()))).toMatchObject({
      sub: "U1234",
    });
    expect(downloads).toEqual([JWKS_URLS.line, JWKS_URLS.line]);
  });

  it("uses freshly downloaded keys when KV writes fail", async () => {
    const put = vi.spyOn(env.JWKS_CACHE, "put").mockRejectedValue(new Error("KV unavailable"));
    try {
      expect(await verifier.verify("line", await sign(lineKey, lineClaims()))).toMatchObject({
        sub: "U1234",
      });
      expect(await verifier.verify("line", await sign(lineKey, lineClaims()))).toMatchObject({
        sub: "U1234",
      });
      expect(downloads).toHaveLength(1);
    } finally {
      put.mockRestore();
    }
  });
});

it("aborts a stalled JWKS download after five seconds", async () => {
  // The real timeout would make this test wait five seconds; hand out a signal we fire ourselves.
  const stall = new AbortController();
  const asked: number[] = [];
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    asked.push(ms);
    return stall.signal;
  });
  vi.stubGlobal("fetch", (_url: string, init?: RequestInit) => {
    const signal = init?.signal;
    if (!signal) throw new Error("missing abort signal");
    return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener(
        "abort",
        () => {
          reject(signal.reason as Error);
        },
        { once: true },
      );
    });
  });
  try {
    const download = fetchJwks(JWKS_URLS.line);
    stall.abort(new DOMException("The operation timed out.", "TimeoutError"));
    await expect(download).rejects.toMatchObject({ name: "TimeoutError" });
    expect(asked).toEqual([5_000]);
  } finally {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  }
});
