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
  expect(leaked.commentary).toMatch(/^Test Air at .* has the strongest signal/);
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
  expect(reply.commentary).toContain("非常值得買");
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
