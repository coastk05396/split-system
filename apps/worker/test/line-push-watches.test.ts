import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { productionDeps } from "../src/deps.js";
import { dailyMaintenance } from "../src/maintenance.js";
import type { LineMessage, LineReplyClient } from "../src/line/reply-client.js";
import { bearer, clock, json, offlineRateSource, signIn, uniqueSub } from "./auth-harness.js";

const intent = {
  origin: "TPE",
  destination: "OKA",
  departureDate: "2026-12-04",
  returnDate: "2026-12-07",
  currency: "TWD",
};
const month = (now: number) => new Date(now + 8 * 3_600_000).toISOString().slice(0, 7);

function setup() {
  const pushes: { to: string; messages: LineMessage[] }[] = [];
  const client: LineReplyClient = {
    reply: () => Promise.resolve(),
    startLoading: () => Promise.resolve(),
    push(to, messages) {
      pushes.push({ to, messages });
      return Promise.resolve();
    },
  };
  const deps = {
    ...productionDeps,
    now: () => clock.now,
    rateSource: offlineRateSource,
    lineReplyClient: () => client,
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
  };
  const app = createApp(deps);
  const request = (path: string, init: RequestInit) =>
    app.request(`https://split.test/api/v1${path}`, init, env);
  async function linkedWatch() {
    const sub = uniqueSub("U-pushed");
    const user = await signIn("line", sub);
    const created = await request(
      "/flights/watches",
      json(
        { intent, baselineFare: 9000, targetFare: 7000, channel: "line_push" },
        bearer(user.accessToken),
      ),
    );
    expect(created.status).toBe(201);
    return { sub, user };
  }
  const watches = async (token: string) =>
    (
      await (
        await request("/flights/watches", { headers: bearer(token) })
      ).json<{ watches: { status: string; channel: string; latestFare: number }[] }>()
    ).watches;
  return { deps, pushes, linkedWatch, watches };
}

const setUsed = (count: number) =>
  env.DB.prepare(
    "INSERT INTO line_push_usage(month,count) VALUES(?1,?2) ON CONFLICT(month) DO UPDATE SET count=?2",
  )
    .bind(month(clock.now), count)
    .run();

const used = async (now: number) =>
  (
    await env.DB.prepare("SELECT count FROM line_push_usage WHERE month=?")
      .bind(month(now))
      .first<{ count: number }>()
  )?.count ?? 0;

describe("LINE Push Price Watch alerts", () => {
  beforeEach(async () => {
    await setUsed(0);
  });

  it("pushes one sprout-free alert, counts it for the month and marks the watch triggered", async () => {
    const { deps, pushes, linkedWatch, watches } = setup();
    const before = await used(clock.now);
    const { sub, user } = await linkedWatch();

    await Promise.all([
      dailyMaintenance(env, clock.now, deps),
      dailyMaintenance(env, clock.now, deps),
    ]);
    await dailyMaintenance(env, clock.now, deps);

    expect(pushes).toHaveLength(1);
    expect(pushes[0]?.to).toBe(sub);
    const message = JSON.stringify(pushes[0]?.messages);
    expect(message).toContain("TPE");
    expect(message).toContain("NT$ 6,000");
    expect(message).not.toContain("🌱");
    expect(await used(clock.now)).toBe(before + 1);
    expect(await watches(user.accessToken)).toMatchObject([
      { channel: "line_push", status: "triggered", latestFare: 6000 },
    ]);
  });

  it("halts pushes at 150 a month but still marks the watch triggered for the in-app badge", async () => {
    const { deps, pushes, linkedWatch, watches } = setup();
    await setUsed(150);
    const { user } = await linkedWatch();

    await dailyMaintenance(env, clock.now, deps);

    expect(pushes).toEqual([]);
    expect(await used(clock.now)).toBe(150);
    expect(await watches(user.accessToken)).toMatchObject([{ status: "triggered" }]);
  });

  it("keeps the watch active and frees the slot when LINE refuses the push", async () => {
    const { deps, linkedWatch, watches } = setup();
    const before = await used(clock.now);
    const { user } = await linkedWatch();
    const failing = {
      ...deps,
      lineReplyClient: () => ({
        reply: () => Promise.resolve(),
        startLoading: () => Promise.resolve(),
        push: () => Promise.reject(new Error("LINE push failed with 500")),
      }),
    };

    await dailyMaintenance(env, clock.now, failing);

    expect(await used(clock.now)).toBe(before);
    expect(await watches(user.accessToken)).toMatchObject([{ status: "active" }]);
  });

  it("offers LINE alerts only to a linked User while the month has room", async () => {
    const { deps } = setup();
    const app = createApp(deps);
    const available = async (token: string) =>
      (
        await (
          await app.request(
            "https://split.test/api/v1/flights/line-push",
            { headers: bearer(token) },
            env,
          )
        ).json<{ available: boolean }>()
      ).available;
    const linked = await signIn("line", uniqueSub("U-status"));
    const googleOnly = await signIn("google", uniqueSub("g-status"));

    expect(await available(linked.accessToken)).toBe(true);
    expect(await available(googleOnly.accessToken)).toBe(false);
    const refused = await app.request(
      "https://split.test/api/v1/flights/watches",
      json(
        { intent, baselineFare: 9000, targetFare: 7000, channel: "line_push" },
        bearer(googleOnly.accessToken),
      ),
      env,
    );
    expect(refused.status).toBe(400);
    await setUsed(150);
    expect(await available(linked.accessToken)).toBe(false);
  });
});
