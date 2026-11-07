import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { productionDeps } from "../src/deps.js";
import { dailyMaintenance } from "../src/maintenance.js";
import {
  LinePushRejectedError,
  type LineMessage,
  type LineReplyClient,
} from "../src/line/reply-client.js";
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
    // dailyMaintenance visits every active watch, so earlier tests' leftovers must not count.
    await env.DB.prepare("DELETE FROM flight_price_watches").run();
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

  it.each([
    ["a definite 4xx rejection", 0, new LinePushRejectedError(400)],
    ["a 5xx", 1, new Error("LINE push failed with 500")],
    ["a timeout", 1, new DOMException("timed out", "TimeoutError")],
    ["a network error", 1, new TypeError("network")],
  ])(
    "keeps the watch active after %s and leaves %d slot(s) used",
    async (_name, slots, failure) => {
      const { deps, linkedWatch, watches } = setup();
      const before = await used(clock.now);
      const { user } = await linkedWatch();
      const failing = {
        ...deps,
        lineReplyClient: () => ({
          reply: () => Promise.resolve(),
          startLoading: () => Promise.resolve(),
          push: () => Promise.reject(failure),
        }),
      };

      await dailyMaintenance(env, clock.now, failing);

      expect(await used(clock.now)).toBe(before + slots);
      expect(await watches(user.accessToken)).toMatchObject([{ status: "active" }]);
    },
  );

  it("sends the same UUID retry key for one watch on every attempt", async () => {
    const { deps, linkedWatch } = setup();
    await linkedWatch();
    const keys: (string | undefined)[] = [];
    const flaky = {
      ...deps,
      lineReplyClient: () => ({
        reply: () => Promise.resolve(),
        startLoading: () => Promise.resolve(),
        push: (_to: string, _messages: LineMessage[], retryKey?: string) => {
          keys.push(retryKey);
          return keys.length === 1 ? Promise.reject(new Error("timeout")) : Promise.resolve();
        },
      }),
    };

    await dailyMaintenance(env, clock.now, flaky);
    await dailyMaintenance(env, clock.now, flaky);

    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(keys[1]).toBe(keys[0]);
  });

  it("keeps checking the remaining watches when one watch's processing throws, logging only an error class", async () => {
    const { deps, pushes, linkedWatch, watches } = setup();
    const first = await linkedWatch();
    const second = await linkedWatch();
    const poisoned = await env.DB.prepare(
      "SELECT id FROM flight_price_watches ORDER BY created_at LIMIT 1",
    ).first<{ id: string }>();
    await env.DB.exec(
      `CREATE TRIGGER test_poison_watch BEFORE UPDATE ON flight_price_watches WHEN NEW.id='${poisoned?.id ?? ""}' AND NEW.claim_token IS NOT NULL BEGIN SELECT RAISE(ABORT, 'injected D1 outage for ${first.sub}'); END`,
    );
    const logged: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
    try {
      await dailyMaintenance(env, clock.now, deps);
    } finally {
      spy.mockRestore();
      await env.DB.exec("DROP TRIGGER IF EXISTS test_poison_watch");
    }

    expect(pushes.map((p) => p.to)).toEqual([second.sub]);
    expect(await watches(first.user.accessToken)).toMatchObject([{ status: "active" }]);
    expect(await watches(second.user.accessToken)).toMatchObject([{ status: "triggered" }]);
    const failure = logged.find((line) => line.includes("flight_watch_failed"));
    expect(failure).toBeDefined();
    expect(failure).not.toContain("injected");
    expect(failure).not.toContain(first.sub);
    expect(failure).not.toContain(poisoned?.id ?? "?");
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
