import {
  applyIntentPatch,
  FLIGHT_DESTINATIONS,
  flightSearchIntentSchema,
  intentFromQuery,
  type FlightSearchIntent,
} from "@split/shared";
import type { AppDeps } from "../deps.js";
import type { Bindings } from "../env.js";
import { adviseFlights } from "../flights/advice.js";
import { productionFlightAI } from "../flights/ai.js";
import { executeFlightSearch } from "../flights/search.js";
import { ApiError } from "../errors.js";
import { consumeSenderRateLimit } from "../rate-limit.js";
import type { WebhookEvent } from "./events.js";
import { flightBubble, MAX_FLIGHT_BUBBLES, portalBubble, serializeIntent } from "./flight-flex.js";
import type { LineMessage, LineReplyClient, QuickReplyItem } from "./reply-client.js";

/** Postback data of a Quick Reply chip: `action=flight&` plus the whole pivoted search. */
export const FLIGHT_POSTBACK_PREFIX = "action=flight&";

export const FLIGHT_HINT_TEXT = "還不確定你想飛去哪，試試「下個月週末去沖繩，預算 15000」";
export const FLIGHT_BUSY_TEXT = "查詢太頻繁了，請稍等一下再試";
export const FLIGHT_EMPTY_TEXT = "目前查不到即時票價，可以直接到 Google 航班看看：";

/** Words that mark a flight or travel question; anything else keeps the Rich Menu pointer. */
const FLIGHT_WORDS = new RegExp(
  [
    "機票|航班|班機|飛[往去到]|飛機|出國|旅行|旅遊|度假|來回|便宜.{0,6}去",
    "\\b(flights?|fly|airfare|airfares|trip|travel|vacation|getaway)\\b",
    ...FLIGHT_DESTINATIONS.flatMap((d) => [d.zhTW, `\\b${d.en}\\b`]),
  ].join("|"),
  "i",
);

export type FlightChatRequest =
  | { kind: "prompt"; userId: string; prompt: string }
  | { kind: "intent"; userId: string; intent: FlightSearchIntent };

/** A one-on-one flight question or chip tap; null for everything else. */
export function flightChatRequest(event: WebhookEvent): FlightChatRequest | null {
  const userId = event.source?.type === "user" ? event.source.userId : undefined;
  if (userId === undefined || event.replyToken === undefined) return null;
  if (event.type === "message") {
    const text = event.message?.type === "text" ? event.message.text : undefined;
    return text !== undefined && FLIGHT_WORDS.test(text)
      ? { kind: "prompt", userId, prompt: text.slice(0, 1000) }
      : null;
  }
  const data = event.type === "postback" ? event.postback?.data : undefined;
  if (data?.startsWith(FLIGHT_POSTBACK_PREFIX) !== true) return null;
  const params = new URLSearchParams(data.slice(FLIGHT_POSTBACK_PREFIX.length));
  const intent = intentFromQuery(params);
  return intent === null ? null : { kind: "intent", userId, intent };
}

const encoder = new TextEncoder();

/** A keyed hash, so the LINE user id itself never lands in the counter table. */
async function senderKey(secret: string, userId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(userId));
  return `line:${Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

const text = (message: string): LineMessage[] => [{ type: "text", text: message }];

/** The reply for a flight chat request; never throws, so a failure cannot break the webhook. */
export async function flightChatReply(
  env: Bindings,
  deps: AppDeps,
  request: FlightChatRequest,
  portalBase: string,
  secret: string,
): Promise<LineMessage[]> {
  try {
    const key = await senderKey(secret, request.userId);
    await consumeSenderRateLimit(env.DB, key, "flights_minute", deps.now());
    await consumeSenderRateLimit(env.DB, key, "flights_hour", deps.now());
    const intent =
      request.kind === "intent"
        ? request.intent
        : flightSearchIntentSchema.parse(
            await (deps.flightAI ?? productionFlightAI).parsePrompt(
              request.prompt,
              {},
              env,
              deps.now(),
            ),
          );
    const reply = await executeFlightSearch(env, deps, intent);
    if (reply.cards.length === 0) return text(`${FLIGHT_EMPTY_TEXT}${reply.url}`);
    const advice = await adviseFlights(env, deps, {
      language: "zh-TW",
      intent: reply.intent,
      cards: reply.cards,
    });
    const chips: QuickReplyItem[] = advice.moves.map((move) => ({
      type: "action",
      action: {
        type: "postback",
        // LINE caps a Quick Reply label at 20 characters.
        label: move.label.slice(0, 20),
        data: `${FLIGHT_POSTBACK_PREFIX}${serializeIntent(applyIntentPatch(reply.intent, move.patch))}`,
        displayText: move.label,
      },
    }));
    return [
      { type: "text", text: advice.commentary },
      {
        type: "flex",
        altText: advice.commentary.slice(0, 400),
        contents: {
          type: "carousel",
          contents: [
            ...reply.cards.slice(0, MAX_FLIGHT_BUBBLES).map(flightBubble),
            portalBubble(`${portalBase}/travel?${serializeIntent(reply.intent)}`),
          ],
        },
        quickReply: { items: chips },
      },
    ];
  } catch (error) {
    if (error instanceof ApiError && error.code === "RATE_LIMITED") return text(FLIGHT_BUSY_TEXT);
    return text(FLIGHT_HINT_TEXT);
  }
}

/** Shows LINE's loading indicator, then replies once; failures are logged without ids. */
export async function handleFlightChat(
  env: Bindings,
  deps: AppDeps,
  client: LineReplyClient,
  request: FlightChatRequest,
  replyToken: string,
  portalBase: string,
  secret: string,
): Promise<void> {
  await client.startLoading(request.userId).catch(() => undefined);
  await client.reply(replyToken, await flightChatReply(env, deps, request, portalBase, secret));
}
