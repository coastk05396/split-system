import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { formatAmount, type FlightAdviceReply, type FlightAdviceRequest } from "@split/shared";
import { createApp } from "../src/app.js";
import { productionDeps, type AppDeps } from "../src/deps.js";
import { bearer, clock, json, signIn, uniqueSub } from "./auth-harness.js";

const intent = {
  origin: "TPE",
  destination: "OKA",
  departureDate: "2026-12-04", // a Friday
  returnDate: "2026-12-07",
  currency: "TWD",
  excludeRedEye: false,
  directOnly: false,
} as const;
const fare = {
  price: 9000,
  airline: "Test Air",
  outboundDeparture: "08:00",
  outboundArrival: "12:00",
  inboundDeparture: null,
  inboundArrival: null,
  stops: 0,
  durationMinutes: 180,
  priceLevel: "low",
  intent,
  signal: "strong_buy",
  overBudget: 0,
} as const;
const request = (language: "en" | "zh-TW" = "en"): FlightAdviceRequest => ({
  language,
  intent,
  cards: [fare, { ...fare, airline: "Night Air", price: 12000, signal: "hold" }],
});

async function advise(
  body: unknown,
  deps: Partial<AppDeps> = {},
  bindings: object = env,
  sub = uniqueSub("advice"),
) {
  const app = createApp({ ...productionDeps, now: () => clock.now, ...deps });
  const user = await signIn("google", sub);
  return app.request(
    "https://split.test/api/v1/flights/advise",
    json(body, bearer(user.accessToken)),
    bindings,
  );
}

it("answers with deterministic grounded commentary and 3-4 structured chips when no model is available", async () => {
  const response = await advise(request(), {
    flightAdvisor: { select: () => Promise.resolve(null) },
  });
  expect(response.status).toBe(200);
  const reply = await response.json<FlightAdviceReply>();
  expect(reply.commentary).toContain(formatAmount(9000, "TWD"));
  expect(reply.commentary).toContain("Test Air");
  expect(reply.moves.length).toBeGreaterThanOrEqual(3);
  expect(reply.moves.length).toBeLessThanOrEqual(4);
  expect(reply.moves).toContainEqual({
    id: "thursday",
    label: "Leave Thursday 2026-12-03",
    patch: { departureDate: "2026-12-03", returnDate: "2026-12-06" },
  });
});

it("lets Groq strict JSON choose the focus and chip order while the server words every price", async () => {
  const { createFlightAdvisor } = await import("../src/flights/advice.js");
  const payloads: unknown[] = [];
  const advisor = createFlightAdvisor((_input, init) => {
    if (typeof init?.body !== "string") throw new Error("missing JSON request body");
    payloads.push(JSON.parse(init.body));
    return Promise.resolve(
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({ focus: "cheapest", moves: ["longer_stay", "later_week"] }),
            },
          },
        ],
      }),
    );
  });
  const response = await advise(
    request(),
    { flightAdvisor: advisor },
    { ...env, GROQ_API_KEY: crypto.randomUUID() },
  );
  const reply = await response.json<FlightAdviceReply>();
  expect(payloads[0]).toMatchObject({
    model: "openai/gpt-oss-120b",
    response_format: { type: "json_schema", json_schema: { strict: true } },
  });
  expect(reply.commentary).toMatch(/^Cheapest is Test Air at /);
  expect(reply.moves.map((move) => move.id).slice(0, 2)).toEqual(["longer_stay", "later_week"]);
  expect(reply.moves).toHaveLength(4);
});

it("falls back to Workers AI on a Groq 429, then to deterministic copy when output leaks text or hangs", async () => {
  const { createFlightAdvisor } = await import("../src/flights/advice.js");
  const advisor = createFlightAdvisor(() => Promise.resolve(new Response("", { status: 429 })));
  let output: unknown = { focus: "nonstop", moves: ["later_week"] };
  let hang = false;
  const bindings = {
    ...env,
    GROQ_API_KEY: crypto.randomUUID(),
    AI: {
      run: () =>
        hang ? new Promise(() => undefined) : Promise.resolve({ response: JSON.stringify(output) }),
    },
  };
  const ask = async () =>
    (await advise(request(), { flightAdvisor: advisor }, bindings)).json<FlightAdviceReply>();
  expect((await ask()).commentary).toMatch(/^Test Air flies nonstop at /);
  output = { focus: "cheapest", moves: [], commentary: "Only NT$1 today, 90% off!" };
  const leaked = await ask();
  expect(leaked.commentary).not.toMatch(/90%|NT\$1\b/);
  expect(leaked.commentary).toMatch(/^Test Air at .* is worth considering first/);
  hang = true;
  expect((await ask()).moves.length).toBeGreaterThanOrEqual(3);
}, 10_000);

it("words commentary and chips in Traditional Chinese and ignores choices the results do not support", async () => {
  const response = await advise(request("zh-TW"), {
    flightAdvisor: {
      select: () =>
        Promise.resolve({ focus: "over_budget", moves: ["lift_budget", "relax_direct"] }),
    },
  });
  const reply = await response.json<FlightAdviceReply>();
  expect(reply.commentary).toContain("Test Air");
  expect(reply.commentary).toContain("值得優先考慮");
  expect(reply.commentary).not.toContain("budget");
  expect(reply.moves.map((move) => move.id)).not.toContain("lift_budget");
  expect(reply.moves.map((move) => move.id)).not.toContain("relax_direct");
  expect(reply.moves.find((move) => move.id === "thursday")?.label).toBe("改週四出發 2026-12-03");
});

it("limits advice requests per User", async () => {
  const sub = uniqueSub("advice-limit");
  const deps = { flightAdvisor: { select: () => Promise.resolve(null) } };
  for (let i = 0; i < 20; i++) expect((await advise(request(), deps, env, sub)).status).toBe(200);
  expect((await advise(request(), deps, env, sub)).status).toBe(429);
});

it("still offers at least three chips when few conditions apply", async () => {
  const sparse = {
    ...intent,
    destination: "ZZZ",
    departureDate: "2025-06-18", // a Wednesday within a week of today
    returnDate: "2025-06-21",
    excludeRedEye: true,
  } as const;
  const response = await advise(
    {
      language: "en",
      intent: sparse,
      cards: [{ ...fare, intent: sparse, stops: 1 }],
    },
    { flightAdvisor: { select: () => Promise.resolve(null) } }, // never reach the real AI binding
  );
  const reply = await response.json<FlightAdviceReply>();
  expect(reply.moves.map((move) => move.id)).toEqual(["later_week", "longer_stay", "shorter_stay"]);
});

/** The retired Deal Signal label words, in both languages (the signal itself stays data). */
const LABELS = /強烈買|可買|觀望|非常值得買|可以買|再等等|Strong Buy|\bBuy\b|\bHold\b/i;

it.each(["en", "zh-TW"] as const)(
  "never names the Deal Signal in commentary, for any best signal or focus, in %s",
  async (language) => {
    for (const signal of ["strong_buy", "buy", "hold"] as const) {
      for (const focus of ["best_signal", "cheapest", "over_budget", "nonstop"] as const) {
        const response = await advise(
          {
            language,
            intent,
            cards: [
              { ...fare, signal, overBudget: 500 },
              { ...fare, airline: "Night Air", price: 12000, signal: "hold", overBudget: 3500 },
            ],
          },
          { flightAdvisor: { select: () => Promise.resolve({ focus, moves: [] }) } },
        );
        const { commentary } = await response.json<FlightAdviceReply>();
        expect(commentary, `${signal} ${focus}`).not.toMatch(LABELS);
        expect(commentary.length).toBeGreaterThan(10);
      }
    }
  },
);

it.each(["en", "zh-TW"] as const)(
  "makes no price claim when no fare is rated better than hold, even if best_signal is asked for, in %s",
  async (language) => {
    const hold = { ...fare, signal: "hold", priceLevel: "unknown", overBudget: 0 } as const;
    const response = await advise(
      { language, intent, cards: [hold, { ...hold, airline: "Night Air", price: 12000 }] },
      { flightAdvisor: { select: () => Promise.resolve({ focus: "best_signal", moves: [] }) } },
    );
    const { commentary } = await response.json<FlightAdviceReply>();
    expect(commentary).toMatch(language === "en" ? /^Cheapest is / : /^最便宜的是 /);
    expect(commentary.split(/[。.]\s/)[0]).not.toMatch(
      /best-value|great price|fair price|best-value|最划算|超值|合理/,
    );
  },
);

it.each(["en", "zh-TW"] as const)(
  "says a rated best fare is a great or fair price, no more, in %s",
  async (language) => {
    for (const [signal, words] of [
      ["strong_buy", language === "en" ? "worth considering first" : "值得優先考慮"],
      ["buy", language === "en" ? "fair price" : "價格合理"],
    ] as const) {
      const response = await advise(
        {
          language,
          intent,
          cards: [
            { ...fare, signal },
            { ...fare, airline: "Night Air", price: 12000, signal: "hold" },
          ],
        },
        { flightAdvisor: { select: () => Promise.resolve({ focus: "best_signal", moves: [] }) } },
      );
      const { commentary } = await response.json<FlightAdviceReply>();
      expect(commentary.split(/[。.]\s/)[0]).toContain(words);
    }
  },
);

const PRICE_CLAIM = /great price|best-value|best value|bargain|deal|超值|好價|划算|優惠|便宜/i;

it.each(["en", "zh-TW"] as const)(
  "claims no bargain for a Strong Buy that Google rates high or whose history is 100% above the mean, in %s",
  async (language) => {
    // Six fares: the cheapest third is the two lowest; the 8000 top fare is rated high by Google.
    const base = {
      airline: "Test Air",
      outboundDeparture: "08:00",
      outboundArrival: "12:00",
      inboundDeparture: null,
      inboundArrival: null,
      stops: 0,
      durationMinutes: 180,
      priceLevel: "typical" as const,
    };
    const app = createApp({
      ...productionDeps,
      now: () => clock.now,
      flightSource: () =>
        Promise.resolve([
          { ...base, price: 8000, top: true, priceLevel: "high" as const },
          ...[8500, 9000, 9500, 10000, 10500].map((price) => ({ ...base, price })),
        ]),
    });
    const user = await signIn("google", uniqueSub("advice-high"));
    const search = await app.request(
      "https://split.test/api/v1/flights/search",
      json({ ...intent, destination: "HKG", directOnly: true }, bearer(user.accessToken)),
      env,
    );
    const { cards } = await search.json<{ cards: FlightAdviceRequest["cards"] }>();
    const high = cards.filter((card) => card.priceLevel === "high");
    expect(high.length).toBeGreaterThan(0);
    expect(high.every((card) => card.signal === "strong_buy")).toBe(true);
    const doubled = {
      ...(high[0] as (typeof cards)[number]),
      priceLevel: "typical" as const,
      history: { days: 30, meanPrice: 4000, percentBelowMean: -100, percentile: 100 },
    };
    for (const set of [high, [doubled]]) {
      const response = await app.request(
        "https://split.test/api/v1/flights/advise",
        json({ language, intent, cards: set }, bearer(user.accessToken)),
        env,
      );
      const { commentary } = await response.json<FlightAdviceReply>();
      expect(commentary).not.toMatch(PRICE_CLAIM);
      expect(commentary).toContain(language === "en" ? "worth considering first" : "值得優先考慮");
    }
  },
);
