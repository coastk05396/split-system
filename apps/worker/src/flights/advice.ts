import {
  FLIGHT_DESTINATIONS,
  formatAmount,
  type AdaptiveNextMove,
  type FlightAdviceReply,
  type FlightAdviceRequest,
  type SearchIntentPatch,
} from "@split/shared";
import { z } from "zod";
import type { Bindings } from "../env.js";
import { runStructured } from "./ai.js";
import { fareMatchesIntent } from "./search.js";

export const ADVICE_FOCUSES = ["cheapest", "best_signal", "over_budget", "nonstop"] as const;
export type AdviceFocus = (typeof ADVICE_FOCUSES)[number];
/** Ordered by default usefulness; the model may only reorder or drop these. */
export const ADVICE_MOVES = [
  "thursday",
  "relax_direct",
  "lift_budget",
  "red_eye",
  "swap_island",
  "direct_only",
  "earlier_week",
  "later_week",
  "longer_stay",
  "shorter_stay",
] as const;
export type AdviceMove = (typeof ADVICE_MOVES)[number];
export interface AdviceSelection {
  focus: AdviceFocus;
  moves: AdviceMove[];
}
/** Model-assisted choice among verified options; null means use the deterministic defaults. */
export interface FlightAdvisor {
  select(
    request: FlightAdviceRequest,
    options: { focuses: AdviceFocus[]; moves: AdviceMove[] },
    env: Bindings,
  ): Promise<AdviceSelection | null>;
}

const selectionSchema = z
  .object({ focus: z.enum(ADVICE_FOCUSES), moves: z.array(z.enum(ADVICE_MOVES)) })
  .strict();

/** Output is limited to enum choices, so a model cannot put a fare, percentage or time on a card. */
export function createFlightAdvisor(fetchImpl: typeof fetch = fetch): FlightAdvisor {
  return {
    async select(request, options, env) {
      const facts = request.cards.map(
        ({ airline, price, outboundDeparture, stops, signal, overBudget, intent }) => ({
          destination: intent.destination,
          airline,
          price,
          outboundDeparture,
          stops,
          signal,
          overBudget,
        }),
      );
      return (
        (await runStructured({
          env,
          fetchImpl,
          name: "flight_advice_choice",
          schema: selectionSchema,
          timeoutMs: 3000,
          messages: [
            {
              role: "system",
              content: `You advise on flight results. Reply only as JSON {"focus","moves"}. focus: the single most useful angle, one of ${JSON.stringify(options.focuses)}. moves: up to 4 next-search ideas, most useful first, chosen only from ${JSON.stringify(options.moves)}. You write no sentences or numbers; the app words everything from verified facts. Prices are integer currency minor units.`,
            },
            {
              role: "user",
              content: JSON.stringify({
                currency: request.intent.currency,
                budget: request.intent.budget ?? null,
                facts,
              }),
            },
          ],
        })) ?? null
      );
    },
  };
}
export const productionFlightAdvisor = createFlightAdvisor();

type Pair = readonly [zhTW: string, en: string];
const DAY = 86_400_000;
const shift = (date: string, days: number) =>
  new Date(Date.parse(date) + days * DAY).toISOString().slice(0, 10);
const SIGNAL_RANK = { strong_buy: 0, buy: 1, hold: 2 } as const;
export const SIGNAL_LABEL = {
  strong_buy: ["非常值得買", "Strong Buy"],
  buy: ["可以買", "Buy"],
  hold: ["再等等", "Hold"],
} as const satisfies Record<string, Pair>;

/** Every offered chip is computed from the actual results, so none can be inapplicable. */
export function eligibleMoves(
  { intent, cards }: FlightAdviceRequest,
  now: number,
): Map<AdviceMove, { patch: SearchIntentPatch; label: Pair }> {
  const today = new Date(now).toISOString().slice(0, 10);
  const moves = new Map<AdviceMove, { patch: SearchIntentPatch; label: Pair }>();
  const weekday = new Date(intent.departureDate).getUTCDay();
  const toThursday = weekday === 0 ? -3 : weekday >= 5 ? 4 - weekday : 0;
  const thursday = shift(intent.departureDate, toThursday);
  // A one-way search has no return date to move.
  const back = (days: number) =>
    intent.returnDate === undefined ? {} : { returnDate: shift(intent.returnDate, days) };
  if (toThursday !== 0 && thursday >= today)
    moves.set("thursday", {
      patch: { departureDate: thursday, ...back(toThursday) },
      label: [`改週四出發 ${thursday}`, `Leave Thursday ${thursday}`],
    });
  if (intent.directOnly)
    moves.set("relax_direct", { patch: { directOnly: false }, label: ["接受轉機", "Allow stops"] });
  else if (cards.some((card) => card.stops === 0))
    moves.set("direct_only", { patch: { directOnly: true }, label: ["只看直飛", "Direct only"] });
  const cheapest = cheapestOf(cards);
  if (cheapest.overBudget > 0)
    moves.set("lift_budget", {
      patch: { budget: cheapest.price },
      label: [
        `預算提高到 ${formatAmount(cheapest.price, intent.currency)}`,
        `Raise budget to ${formatAmount(cheapest.price, intent.currency)}`,
      ],
    });
  if (
    !intent.excludeRedEye &&
    cards.some(
      (card) => !fareMatchesIntent(card, { ...intent, directOnly: false, excludeRedEye: true }),
    )
  )
    moves.set("red_eye", {
      patch: { excludeRedEye: true },
      label: ["避開紅眼航班", "Skip red-eye flights"],
    });
  const here = FLIGHT_DESTINATIONS.find((d) => d.airport === intent.destination);
  const shown = new Set(cards.map((card) => card.intent.destination));
  const alternative =
    here &&
    FLIGHT_DESTINATIONS.find(
      (d) =>
        d.climate === here.climate &&
        d.vibes.some((vibe) => here.vibes.some((v) => v === vibe)) &&
        d.airport !== intent.origin &&
        !shown.has(d.airport),
    );
  if (alternative)
    moves.set("swap_island", {
      patch: { destination: alternative.airport },
      label: [`同預算改看${alternative.zhTW}`, `Try ${alternative.en}, same budget`],
    });
  if (shift(intent.departureDate, -7) >= today)
    moves.set("earlier_week", {
      patch: {
        departureDate: shift(intent.departureDate, -7),
        ...back(-7),
      },
      label: ["提早一週", "One week earlier"],
    });
  moves.set("later_week", {
    patch: {
      departureDate: shift(intent.departureDate, 7),
      ...back(7),
    },
    label: ["延後一週", "One week later"],
  });
  if (intent.returnDate !== undefined)
    moves.set("longer_stay", {
      patch: { returnDate: shift(intent.returnDate, 1) },
      label: ["多待一天", "Stay one more day"],
    });
  if (intent.returnDate !== undefined && shift(intent.returnDate, -1) > intent.departureDate)
    moves.set("shorter_stay", {
      patch: { returnDate: shift(intent.returnDate, -1) },
      label: ["少待一天", "Stay one day less"],
    });
  return moves;
}

const cheapestOf = (cards: FlightAdviceRequest["cards"]) =>
  cards.reduce((best, card) => (card.price < best.price ? card : best));

export function eligibleFocuses({ cards }: FlightAdviceRequest): AdviceFocus[] {
  return [
    ...(cheapestOf(cards).overBudget > 0 ? (["over_budget"] as const) : []),
    "best_signal",
    "cheapest",
    ...(cards.some((card) => card.stops === 0) ? (["nonstop"] as const) : []),
  ];
}

export const time = (value: string) => /\d{2}:\d{2}/.exec(value)?.[0] ?? value;

/** Wording comes from verified facts only; a model contributes a focus, never text or numbers. */
export function renderAdvice(
  request: FlightAdviceRequest,
  selection: AdviceSelection | null,
  now: number,
): FlightAdviceReply {
  const { cards, intent } = request;
  const i = request.language === "en" ? 1 : 0;
  const pick = (pair: Pair) => pair[i];
  const focuses = eligibleFocuses(request);
  const focus =
    selection && focuses.includes(selection.focus) ? selection.focus : (focuses[0] ?? "cheapest");
  const cheapest = cheapestOf(cards);
  const best = cards.reduce((a, b) => (SIGNAL_RANK[b.signal] < SIGNAL_RANK[a.signal] ? b : a));
  // Only read when focus is "nonstop", which requires a nonstop card to exist.
  const nonstop =
    cards
      .filter((card) => card.stops === 0)
      .reduce<(typeof cards)[number] | undefined>(
        (a, b) => (!a || b.price < a.price ? b : a),
        undefined,
      ) ?? cheapest;
  const money = (amount: number) => formatAmount(amount, intent.currency);
  const lead = {
    cheapest: [
      `最便宜的是 ${cheapest.airline}，${money(cheapest.price)}，${time(cheapest.outboundDeparture)} 出發。`,
      `Cheapest is ${cheapest.airline} at ${money(cheapest.price)}, departing ${time(cheapest.outboundDeparture)}.`,
    ],
    best_signal: [
      `${best.airline} ${money(best.price)} 的買進訊號最好（${SIGNAL_LABEL[best.signal][0]}）。`,
      `${best.airline} at ${money(best.price)} has the strongest signal (${SIGNAL_LABEL[best.signal][1]}).`,
    ],
    over_budget: [
      `最低票價仍超出預算 ${money(cheapest.overBudget)}。`,
      `Even the lowest fare is ${money(cheapest.overBudget)} over your budget.`,
    ],
    nonstop: [
      `${nonstop.airline} 直飛，${money(nonstop.price)}，${time(nonstop.outboundDeparture)} 出發。`,
      `${nonstop.airline} flies nonstop at ${money(nonstop.price)}, departing ${time(nonstop.outboundDeparture)}.`,
    ],
  } as const satisfies Record<AdviceFocus, Pair>;
  const strong = cards.filter((card) => card.signal === "strong_buy").length;
  const tally: Pair = [
    `${cards.length} 個選項中有 ${strong} 個是「非常值得買」。`,
    `${strong} of ${cards.length} options are Strong Buy.`,
  ];

  const available = eligibleMoves(request, now);
  const ordered = [...(selection?.moves ?? []), ...ADVICE_MOVES].filter(
    (id, index, all) => available.has(id) && all.indexOf(id) === index,
  );
  const moves: AdaptiveNextMove[] = ordered.slice(0, 4).map((id) => {
    const move = available.get(id);
    return { id, label: pick(move?.label ?? ["", ""]), patch: move?.patch ?? {} };
  });
  return { commentary: `${pick(lead[focus])} ${pick(tally)}`, moves };
}

/** Model trouble of any kind degrades to deterministic wording; the UI never sees an error. */
export async function adviseFlights(
  env: Bindings,
  deps: import("../deps.js").AppDeps,
  request: FlightAdviceRequest,
): Promise<FlightAdviceReply> {
  const now = deps.now();
  const selection = await (deps.flightAdvisor ?? productionFlightAdvisor)
    .select(
      request,
      { focuses: eligibleFocuses(request), moves: [...eligibleMoves(request, now).keys()] },
      env,
    )
    .catch(() => null);
  return renderAdvice(request, selection, now);
}
