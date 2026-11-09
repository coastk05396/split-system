import {
  applyIntentPatch,
  FLIGHT_DESTINATIONS,
  flightSearchIntentSchema,
  formatAmount,
  intentFromQuery,
  intentToQuery,
  type FlightSearchIntent,
} from "@split/shared";
import type { AppDeps } from "../deps.js";
import type { Bindings } from "../env.js";
import { adviseFlights } from "../flights/advice.js";
import { productionFlightAI } from "../flights/ai.js";
import { linePushHasQuota, userOfLineUser } from "../flights/line-push.js";
import { executeFlightSearch } from "../flights/search.js";
import { createFlightWatch } from "../flights/watches.js";
import { ApiError } from "../errors.js";
import { consumeSenderRateLimit } from "../rate-limit.js";
import type { WebhookEvent } from "./events.js";
import {
  flightBubble,
  MAX_FLIGHT_BUBBLES,
  portalBubble,
  WATCH_POSTBACK_PREFIX,
} from "./flight-flex.js";
import type { LineMessage, LineReplyClient, QuickReplyItem } from "./reply-client.js";

/** Postback data of a Quick Reply chip: `action=flight&` plus the whole pivoted search. */
export const FLIGHT_POSTBACK_PREFIX = "action=flight&";

export const FLIGHT_HINT_TEXT = "還不確定你想飛去哪，試試「下個月週末去沖繩，預算 15000」";
export const FLIGHT_BUSY_TEXT = "查詢太頻繁了，請稍等一下再試";
export const WATCH_FAILED_TEXT = "暫時無法設定降價提醒，請稍後再試";
export const WATCH_LIMIT_TEXT = "LINE 降價提醒最多同時 2 個，請先到小芽機票雷達取消一個";

export const FLIGHT_EMPTY_TEXT = "目前查不到即時票價，可以直接到 Google 航班看看：";

/** Words that mark a flight or travel question on their own. */
const FLIGHT_WORDS =
  /機票|航班|班機|飛[往去到]|飛機|出國|旅行|旅遊|度假|來回|便宜.{0,6}去|\b(flights?|fly|airfare|airfares|trip|travel|vacation|getaway)\b/i;
/** A catalog destination is a flight question only together with an intent verb ("去沖繩", "to Seoul"). */
const DESTINATION = new RegExp(
  FLIGHT_DESTINATIONS.flatMap((d) => [d.zhTW, `\\b${d.en}\\b`]).join("|"),
  "i",
);
const INTENT_VERB = /[去飛玩]|\b(to|go|visit)\b/i;
/** Expense-like text: a 3+ digit amount without a flight noun/verb or a budget marker. */
const FLIGHT_NOUN = /機票|航班|班機|飛|flight|fly|airfare/i;
const BUDGET_MARKER = /預算|budget|NT\$|以內|\d\s*(?:以下|內)|\b(?:under|within|below)\b/i;
/** An intent verb directly followed by a catalog destination ("去沖繩", "to Seoul") is a trip, whatever digits surround it. */
const GOING = new RegExp(
  `(?:[去飛玩]|\\b(?:to|visit)\\b)\\s*(?:${FLIGHT_DESTINATIONS.flatMap((d) => [d.zhTW, `\\b${d.en}\\b`]).join("|")})`,
  "i",
);

function isFlightText(message: string): boolean {
  if (
    /\d{3,}/.test(message) &&
    !FLIGHT_NOUN.test(message) &&
    !BUDGET_MARKER.test(message) &&
    !GOING.test(message)
  )
    return false;
  return FLIGHT_WORDS.test(message) || (DESTINATION.test(message) && INTENT_VERB.test(message));
}

export type FlightChatRequest =
  | { kind: "prompt"; userId: string; prompt: string }
  | { kind: "intent"; userId: string; intent: FlightSearchIntent }
  | { kind: "watch"; userId: string; intent: FlightSearchIntent; fare: number };

/** A one-on-one flight question or chip tap; null for everything else. */
export function flightChatRequest(event: WebhookEvent): FlightChatRequest | null {
  const userId = event.source?.type === "user" ? event.source.userId : undefined;
  if (userId === undefined || event.replyToken === undefined) return null;
  if (event.type === "message") {
    const text = event.message?.type === "text" ? event.message.text : undefined;
    return text !== undefined && isFlightText(text)
      ? { kind: "prompt", userId, prompt: text.slice(0, 1000) }
      : null;
  }
  const data = event.type === "postback" ? event.postback?.data : undefined;
  if (data?.startsWith(WATCH_POSTBACK_PREFIX) === true) {
    const params = new URLSearchParams(data.slice(WATCH_POSTBACK_PREFIX.length));
    const watched = intentFromQuery(params);
    const fare = Number(params.get("fare"));
    return watched !== null && Number.isInteger(fare) && fare > 0 && fare <= 99_999_999
      ? { kind: "watch", userId, intent: watched, fare }
      : null;
  }
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

/** One tap: a linked sender gets a line_push Price Watch; anyone else is sent through LIFF. */
async function watchReply(
  env: Bindings,
  deps: AppDeps,
  request: Extract<FlightChatRequest, { kind: "watch" }>,
  portalBase: string,
): Promise<LineMessage[]> {
  const { intent, fare } = request;
  const portal = `${portalBase}/travel?${intentToQuery(intent)}`;
  try {
    const userId = await userOfLineUser(env.DB, request.userId);
    if (userId === null)
      return text(`先登入小芽才能設定降價提醒，點這裡繼續：\n${portal}&watch=line&fare=${fare}`);
    if (!(await linePushHasQuota(env.DB, deps.now())))
      return text(`本月 LINE 提醒額度已滿，改用免費網頁通知，請在手機瀏覽器開啟：\n${portal}`);
    const targetFare = Math.max(1, Math.floor(fare * 0.85));
    await createFlightWatch(
      env,
      userId,
      { intent, baselineFare: fare, targetFare, channel: "line_push" },
      deps.now(),
    );
    return text(
      `已設定降價提醒：${intent.origin} → ${intent.destination}，出現優先考慮的票價或降到 ${formatAmount(targetFare, intent.currency)} 時，用 LINE 通知你一次。`,
    );
  } catch (error) {
    return text(
      error instanceof ApiError && error.code === "FLIGHT_WATCH_LIMIT"
        ? WATCH_LIMIT_TEXT
        : WATCH_FAILED_TEXT,
    );
  }
}

/** The reply for a flight chat request; never throws, so a failure cannot break the webhook. */
export async function flightChatReply(
  env: Bindings,
  deps: AppDeps,
  request: FlightChatRequest,
  portalBase: string,
  secret: string,
): Promise<LineMessage[]> {
  if (request.kind === "watch") return watchReply(env, deps, request, portalBase);
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
        data: `${FLIGHT_POSTBACK_PREFIX}${intentToQuery(applyIntentPatch(reply.intent, move.patch))}`,
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
            portalBubble(`${portalBase}/travel?${intentToQuery(reply.intent)}`),
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
  if (request.kind !== "watch") await client.startLoading(request.userId).catch(() => undefined);
  await client.reply(replyToken, await flightChatReply(env, deps, request, portalBase, secret));
}
