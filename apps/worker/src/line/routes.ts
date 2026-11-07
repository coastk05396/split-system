import { Hono } from "hono";
import type { AppEnv } from "../api.js";
import type { AppDeps } from "../deps.js";
import { ApiError } from "../errors.js";
import { repliesFor, webhookBodySchema } from "./events.js";
import { flightChatRequest, handleFlightChat } from "./flight-chat.js";
import { verifyLineSignature } from "./signature.js";

/**
 * `POST /line/webhook` (SPEC §5.1, decisions 05 and 14). Checks the signature on the raw
 * body, answers 200 at once and sends the replies in `waitUntil`. A failed reply is
 * dropped, not retried.
 */
export function lineRoutes(deps: AppDeps) {
  return new Hono<AppEnv>().post("/line/webhook", async (c) => {
    const secret = c.env.LINE_CHANNEL_SECRET;
    const signature = c.req.header("X-Line-Signature");
    const rawBody = await c.req.text();
    if (
      secret === undefined ||
      secret === "" ||
      signature === undefined ||
      !(await verifyLineSignature(secret, rawBody, signature))
    ) {
      throw new ApiError("UNAUTHORIZED");
    }

    const parsed = webhookBodySchema.safeParse(parseJson(rawBody));
    if (!parsed.success) throw new ApiError("VALIDATION_FAILED");

    const client = deps.lineReplyClient(c.env);
    const portalBase =
      c.env.LIFF_ID === undefined || c.env.LIFF_ID === ""
        ? new URL(c.req.url).origin
        : `https://liff.line.me/${c.env.LIFF_ID}`;
    const sends = parsed.data.events.flatMap((event) => {
      const flight = flightChatRequest(event);
      const messages = repliesFor(event);
      if (event.replyToken === undefined || (flight === null && messages.length === 0)) return [];
      const send =
        flight === null
          ? client.reply(event.replyToken, messages)
          : handleFlightChat(c.env, deps, client, flight, event.replyToken, portalBase, secret);
      return [
        send.catch((error: unknown) => {
          console.error(
            JSON.stringify({
              requestId: c.get("requestId"),
              lineReply: "failed",
              reason: error instanceof Error ? error.message : "unknown",
            }),
          );
        }),
      ];
    });
    c.executionCtx.waitUntil(Promise.all(sends));
    return c.body(null, 200);
  });
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
