import { env } from "cloudflare:workers";
import { intentFromQuery } from "@split/shared";
import { expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { productionDeps } from "../src/deps.js";
import { bearer, clock, json, signIn, uniqueSub } from "./auth-harness.js";

it("owns, caps and cancels Web Price Watches through the HTTP interface", async () => {
  const app = createApp({ ...productionDeps, now: () => clock.now });
  const user = await signIn("google", uniqueSub("watch"));
  const stranger = await signIn("google", uniqueSub("other-watch"));
  const request = (path: string, init: RequestInit) =>
    app.request(`https://split.test/api/v1/flights${path}`, init, env);
  const intent = {
    origin: "TPE",
    destination: "NRT",
    departureDate: "2026-12-04",
    returnDate: "2026-12-07",
    currency: "TWD",
  };
  let id = "";
  for (let day = 4; day <= 8; day++) {
    const response = await request(
      "/watches",
      json(
        {
          intent: {
            ...intent,
            departureDate: `2026-12-${String(day).padStart(2, "0")}`,
            returnDate: "2026-12-12",
          },
          baselineFare: 9000,
          targetFare: 7000,
          channel: "web_push",
        },
        bearer(user.accessToken),
      ),
    );
    expect(response.status).toBe(201);
    id = (await response.json<{ id: string }>()).id;
  }
  const capped = await request(
    "/watches",
    json(
      { intent, baselineFare: 9000, targetFare: 7000, channel: "web_push" },
      bearer(user.accessToken),
    ),
  );
  expect(capped.status).toBe(409);
  expect(
    (await request(`/watches/${id}`, { method: "DELETE", headers: bearer(stranger.accessToken) }))
      .status,
  ).toBe(404);
  expect(
    (await request(`/watches/${id}`, { method: "DELETE", headers: bearer(user.accessToken) }))
      .status,
  ).toBe(204);
  const listed = await request("/watches", { headers: bearer(user.accessToken) });
  expect((await listed.json<{ watches: { id: string }[] }>()).watches).toHaveLength(4);
});

it("daily checks deliver once, prune stale subscriptions, expire watches and cascade on account deletion", async () => {
  const { dailyMaintenance } = await import("../src/maintenance.js");
  const { offlineRateSource } = await import("./auth-harness.js");
  const sends: string[] = [];
  let now = clock.now;
  const deps = {
    ...productionDeps,
    pause: () => Promise.resolve(),
    snapshotDestinations: [],
    now: () => now,
    rateSource: offlineRateSource,
    flightSource: () =>
      Promise.resolve([
        {
          price: 6000,
          airline: "Test Air",
          outboundDeparture: "08:00",
          outboundArrival: "11:00",
          inboundDeparture: null,
          inboundArrival: null,
          stops: 0,
          durationMinutes: 180,
          priceLevel: "typical" as const,
        },
      ]),
    webPushSender: (subscription: { endpoint: string }) => {
      sends.push(subscription.endpoint);
      return Promise.resolve(subscription.endpoint.endsWith("stale") ? 410 : 201);
    },
  };
  const app = createApp(deps);
  const user = await signIn("google", uniqueSub("watch-cron"));
  const request = (path: string, init: RequestInit) =>
    app.request(`https://split.test/api/v1${path}`, init, env);
  const keys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  if (!("privateKey" in keys)) throw new Error("ECDH key pair unavailable");
  const rawPublic = await crypto.subtle.exportKey("raw", keys.publicKey);
  if (!(rawPublic instanceof ArrayBuffer)) throw new Error("ECDH raw key unavailable");
  const publicKey = new Uint8Array(rawPublic);
  const encode = (bytes: Uint8Array) =>
    btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  for (const name of ["stale", "live"])
    expect(
      (
        await request(
          "/flights/push-subscriptions",
          json(
            {
              endpoint: `https://fcm.googleapis.com/${name}`,
              keys: {
                p256dh: encode(publicKey),
                auth: encode(crypto.getRandomValues(new Uint8Array(16))),
              },
            },
            bearer(user.accessToken),
          ),
        )
      ).status,
    ).toBe(204);
  const intent = {
    origin: "KHH",
    destination: "HND",
    departureDate: "2026-12-04",
    returnDate: "2026-12-07",
    currency: "TWD",
  };
  expect(
    (
      await request(
        "/flights/watches",
        json(
          { intent, baselineFare: 9000, targetFare: 7000, channel: "web_push" },
          bearer(user.accessToken),
        ),
      )
    ).status,
  ).toBe(201);
  await Promise.all([dailyMaintenance(env, now, deps), dailyMaintenance(env, now, deps)]);
  expect(sends).toHaveLength(2);
  expect(
    (
      await (
        await request("/flights/watches", { headers: bearer(user.accessToken) })
      ).json<{ watches: { status: string; latestFare: number }[] }>()
    ).watches,
  ).toMatchObject([{ status: "triggered", latestFare: 6000 }]);
  await dailyMaintenance(env, now, deps);
  expect(sends).toHaveLength(2);
  const stale = await env.DB.prepare("SELECT endpoint FROM web_push_subscriptions WHERE user_id=?")
    .bind(user.userId)
    .all();
  expect(stale.results).toHaveLength(1);
  await request(
    "/flights/watches",
    json(
      {
        intent: { ...intent, destination: "ICN" },
        baselineFare: 9000,
        targetFare: 7000,
        channel: "web_push",
      },
      bearer(user.accessToken),
    ),
  );
  now += 61 * 86400_000;
  await dailyMaintenance(env, now, deps);
  expect(
    (
      await env.DB.prepare(
        "SELECT status FROM flight_price_watches WHERE user_id=? AND status='expired'",
      )
        .bind(user.userId)
        .all()
    ).results,
  ).toHaveLength(1);
  now = clock.now;
  expect(
    (await request("/me", { method: "DELETE", headers: bearer(user.accessToken) })).status,
  ).toBe(204);
  expect(
    (
      await env.DB.prepare("SELECT id FROM flight_price_watches WHERE user_id=?")
        .bind(user.userId)
        .all()
    ).results,
  ).toHaveLength(0);
  expect(
    (
      await env.DB.prepare("SELECT endpoint FROM web_push_subscriptions WHERE user_id=?")
        .bind(user.userId)
        .all()
    ).results,
  ).toHaveLength(0);
});

it("sends a decryptable aes128gcm notification with a verifiable VAPID signature", async () => {
  const { vi } = await import("vitest");
  const { importJWK, jwtVerify } = await import("jose");
  const { dailyMaintenance } = await import("../src/maintenance.js");
  const { offlineRateSource } = await import("./auth-harness.js");
  const encode = (bytes: Uint8Array) =>
    btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  const receiver = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  const signing = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  if (!("privateKey" in receiver) || !("privateKey" in signing))
    throw new Error("Expected key pairs");
  const receiverRaw = await crypto.subtle.exportKey("raw", receiver.publicKey);
  const signingRaw = await crypto.subtle.exportKey("raw", signing.publicKey);
  const signingJwk = await crypto.subtle.exportKey("jwk", signing.privateKey);
  if (
    !(receiverRaw instanceof ArrayBuffer) ||
    !(signingRaw instanceof ArrayBuffer) ||
    signingJwk instanceof ArrayBuffer ||
    !signingJwk.d ||
    !signingJwk.x ||
    !signingJwk.y
  )
    throw new Error("Expected exported keys");
  const receiverPublic = new Uint8Array(receiverRaw);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const bindings = {
    ...env,
    VAPID_PUBLIC_KEY: encode(new Uint8Array(signingRaw)),
    VAPID_PRIVATE_KEY: signingJwk.d,
    VAPID_SUBJECT: "mailto:flight-test@example.com",
  };
  const deps = {
    ...productionDeps,
    pause: () => Promise.resolve(),
    snapshotDestinations: [],
    now: () => clock.now,
    rateSource: offlineRateSource,
    flightSource: () =>
      Promise.resolve([
        {
          price: 5000,
          airline: "Test Air",
          outboundDeparture: "09:00",
          outboundArrival: "12:00",
          inboundDeparture: null,
          inboundArrival: null,
          stops: 0,
          durationMinutes: 180,
          priceLevel: "low" as const,
        },
      ]),
  };
  const app = createApp(deps);
  const user = await signIn("google", uniqueSub("vapid"));
  const request = (path: string, body: unknown) =>
    app.request(
      `https://split.test/api/v1/flights${path}`,
      json(body, bearer(user.accessToken)),
      bindings,
    );
  const endpoint = "https://fcm.googleapis.com/encrypted-test";
  expect(
    (
      await request("/push-subscriptions", {
        endpoint,
        keys: { p256dh: encode(receiverPublic), auth: encode(auth) },
      })
    ).status,
  ).toBe(204);
  expect(
    (
      await request("/watches", {
        intent: {
          origin: "TSA",
          destination: "GMP",
          departureDate: "2026-12-04",
          returnDate: "2026-12-07",
          currency: "TWD",
        },
        baselineFare: 9000,
        targetFare: 6000,
        channel: "web_push",
      })
    ).status,
  ).toBe(201);
  const outbound: RequestInit[] = [];
  const network = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    expect(input).toBe(endpoint);
    if (init) outbound.push(init);
    return Promise.resolve(new Response(null, { status: 201 }));
  });
  try {
    await dailyMaintenance(bindings, clock.now, deps);
  } finally {
    network.mockRestore();
  }
  expect(outbound).toHaveLength(1);
  const message = outbound[0];
  if (!message) throw new Error("Missing outbound message");
  const headers = new Headers(message.headers);
  expect(headers.get("Content-Encoding")).toBe("aes128gcm");
  const token = /t=([^,]+)/.exec(headers.get("Authorization") ?? "")?.[1];
  if (!token) throw new Error("Missing VAPID token");
  const verified = await jwtVerify(
    token,
    await importJWK({ kty: "EC", crv: "P-256", x: signingJwk.x, y: signingJwk.y }, "ES256"),
    { audience: "https://fcm.googleapis.com", currentDate: new Date(clock.now) },
  );
  expect(verified.payload.sub).toBe("mailto:flight-test@example.com");
  const body = await new Response(message.body).arrayBuffer();
  const salt = new Uint8Array(body.slice(0, 16));
  expect(new DataView(body).getUint32(16)).toBe(4096);
  const keyLength = new Uint8Array(body)[20];
  expect(keyLength).toBe(65);
  const senderPublic = new Uint8Array(body.slice(21, 86));
  const senderKey = await crypto.subtle.importKey(
    "raw",
    senderPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const agreement = { name: "ECDH", public: senderKey };
  const shared = await crypto.subtle.deriveBits(agreement, receiver.privateKey, 256);
  const authKey = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveBits"]);
  const encoder = new TextEncoder();
  const info = new Uint8Array(14 + 65 + 65);
  info.set(encoder.encode("WebPush: info\0"));
  info.set(receiverPublic, 14);
  info.set(senderPublic, 79);
  const ikm = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: auth, info },
    authKey,
    256,
  );
  const contentKey = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const keyBits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info: encoder.encode("Content-Encoding: aes128gcm\0") },
    contentKey,
    128,
  );
  const nonce = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info: encoder.encode("Content-Encoding: nonce\0") },
    contentKey,
    96,
  );
  const aes = await crypto.subtle.importKey("raw", keyBits, "AES-GCM", false, ["decrypt"]);
  const plaintext = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, aes, body.slice(86)),
  );
  expect(plaintext.at(-1)).toBe(2);
  const notification: unknown = JSON.parse(new TextDecoder().decode(plaintext.slice(0, -1)));
  expect(notification).toMatchObject({
    title: "航班雷達 · 降價通知",
    body: "TSA → GMP · NT$ 5,000",
  });
  // /travel reads flat query params once on arrival, so the link must round-trip through them.
  const link = new URL((notification as { url: string }).url, "https://split.test");
  expect(link.pathname).toBe("/travel");
  expect(intentFromQuery(link.searchParams)).toEqual({
    origin: "TSA",
    destination: "GMP",
    departureDate: "2026-12-04",
    returnDate: "2026-12-07",
    currency: "TWD",
    excludeRedEye: false,
    directOnly: false,
  });
});

it("expires passed departures and rejects arbitrary push destinations", async () => {
  let now = clock.now;
  const app = createApp({ ...productionDeps, now: () => now });
  const user = await signIn("google", uniqueSub("watch-expired"));
  const post = (path: string, input: unknown) =>
    app.request(
      `https://split.test/api/v1/flights${path}`,
      json(input, bearer(user.accessToken)),
      env,
    );
  expect(
    (
      await post("/push-subscriptions", {
        endpoint: "https://127.0.0.1/private",
        keys: { p256dh: "A".repeat(87), auth: "A".repeat(22) },
      })
    ).status,
  ).toBe(400);
  const departureDate = new Date(now + 86400_000).toISOString().slice(0, 10);
  const returnDate = new Date(now + 4 * 86400_000).toISOString().slice(0, 10);
  const created = await post("/watches", {
    intent: { origin: "TPE", destination: "HKG", departureDate, returnDate, currency: "TWD" },
    baselineFare: 9000,
    targetFare: 7000,
    channel: "web_push",
  });
  const watch = await created.json<{ id: string }>();
  expect(created.status).toBe(201);
  now += 2 * 86400_000;
  const { dailyMaintenance } = await import("../src/maintenance.js");
  const { offlineRateSource } = await import("./auth-harness.js");
  await dailyMaintenance(env, now, {
    ...productionDeps,
    pause: () => Promise.resolve(),
    snapshotDestinations: [],
    now: () => now,
    rateSource: offlineRateSource,
    flightSource: () => Promise.resolve([]),
  });
  expect(
    (
      await env.DB.prepare("SELECT status FROM flight_price_watches WHERE id=?")
        .bind(watch.id)
        .first<{ status: string }>()
    )?.status,
  ).toBe("expired");
});

it("fires a watch for a top fare in the cheapest third even with no history and a target it misses", async () => {
  const { dailyMaintenance } = await import("../src/maintenance.js");
  const { offlineRateSource } = await import("./auth-harness.js");
  const fare = (top: boolean) => ({
    price: 6000,
    airline: "Test Air",
    outboundDeparture: "08:00",
    outboundArrival: "11:00",
    inboundDeparture: null,
    inboundArrival: null,
    stops: 0,
    durationMinutes: 180,
    priceLevel: "typical" as const,
    top,
  });
  const sends: string[] = [];
  const deps = {
    ...productionDeps,
    pause: () => Promise.resolve(),
    snapshotDestinations: [],
    now: () => clock.now,
    rateSource: offlineRateSource,
    // Same fare on two routes; only the NGO one is a top flight (the lookup is cached per route).
    flightSource: (intent: { destination: string }) =>
      Promise.resolve([fare(intent.destination === "NGO")]),
    webPushSender: (subscription: { endpoint: string }) => {
      sends.push(subscription.endpoint);
      return Promise.resolve(201);
    },
  };
  const app = createApp(deps);
  const user = await signIn("google", uniqueSub("watch-top"));
  const keys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  if (!("publicKey" in keys)) throw new Error("ECDH key pair unavailable");
  const encode = (bytes: Uint8Array) =>
    btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  const rawPublic = await crypto.subtle.exportKey("raw", keys.publicKey);
  if (!(rawPublic instanceof ArrayBuffer)) throw new Error("ECDH raw key unavailable");
  const publicKey = new Uint8Array(rawPublic);
  const request = (path: string, init: RequestInit) =>
    app.request(`https://split.test/api/v1${path}`, init, env);
  expect(
    (
      await request(
        "/flights/push-subscriptions",
        json(
          {
            endpoint: "https://fcm.googleapis.com/top",
            keys: {
              p256dh: encode(publicKey),
              auth: encode(crypto.getRandomValues(new Uint8Array(16))),
            },
          },
          bearer(user.accessToken),
        ),
      )
    ).status,
  ).toBe(204);
  // The target (1000) is far below the 6000 fare, so only Strong Buy can fire the watch.
  for (const destination of ["FUK", "NGO"])
    expect(
      (
        await request(
          "/flights/watches",
          json(
            {
              intent: {
                origin: "KHH",
                destination,
                departureDate: "2026-12-04",
                returnDate: "2026-12-07",
                currency: "TWD",
              },
              baselineFare: 9000,
              targetFare: 1000,
              channel: "web_push",
            },
            bearer(user.accessToken),
          ),
        )
      ).status,
    ).toBe(201);
  await dailyMaintenance(env, clock.now, deps);
  expect(sends).toHaveLength(1);
  const { results } = await env.DB.prepare(
    "SELECT status, intent_json AS intent FROM flight_price_watches WHERE user_id=? ORDER BY created_at",
  )
    .bind(user.userId)
    .all<{ status: string; intent: string }>();
  expect(
    results.map((row) => [
      (JSON.parse(row.intent) as { destination: string }).destination,
      row.status,
    ]),
  ).toEqual([
    ["FUK", "active"],
    ["NGO", "triggered"],
  ]);
});
