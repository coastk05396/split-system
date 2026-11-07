export interface LineTextMessage {
  type: "text";
  text: string;
}

/** The Flex components the Bot builds: boxes, text, separators and URI buttons. */
export type FlexComponent =
  | {
      type: "box";
      layout: "vertical" | "horizontal";
      contents: FlexComponent[];
      spacing?: string;
      paddingAll?: string;
      backgroundColor?: string;
      cornerRadius?: string;
      paddingTop?: string;
      paddingBottom?: string;
      paddingStart?: string;
      paddingEnd?: string;
    }
  | {
      type: "text";
      text: string;
      size?: string;
      weight?: "regular" | "bold";
      color?: string;
      align?: "start" | "end";
      wrap?: boolean;
      maxLines?: number;
      flex?: number;
    }
  | { type: "separator"; margin?: string }
  | {
      type: "button";
      style: "primary" | "secondary" | "link";
      height: "sm";
      action:
        | { type: "uri"; label: string; uri: string }
        | { type: "postback"; label: string; data: string; displayText: string };
    };

export interface FlexBubble {
  type: "bubble";
  size: "kilo";
  header: FlexComponent;
  body: FlexComponent;
  footer: FlexComponent;
}

export interface QuickReplyItem {
  type: "action";
  action: { type: "postback"; label: string; data: string; displayText: string };
}

export interface LineFlexMessage {
  type: "flex";
  altText: string;
  contents: { type: "carousel"; contents: FlexBubble[] };
  quickReply?: { items: QuickReplyItem[] };
}

/** What the Bot sends: plain text and the Flight Radar Flex Carousel (ADR 0003: zh-TW only). */
export type LineMessage = LineTextMessage | LineFlexMessage;

/** Sends a reply with a webhook event's reply token; tests and local dev use a fake. */
export interface LineReplyClient {
  reply(replyToken: string, messages: LineMessage[]): Promise<void>;
  /** LINE's native "typing" indicator in a one-on-one chat. */
  startLoading(userId: string): Promise<void>;
  /**
   * A LINE Push message; counts against the monthly quota, so callers reserve a slot first.
   * The same `retryKey` makes LINE drop a repeat of a push it already accepted. Throws
   * LinePushRejectedError only when LINE definitely refused (4xx); any other error is uncertain.
   */
  push(userId: string, messages: LineMessage[], retryKey?: string): Promise<void>;
}

/** LINE answered a push with a 4xx: the message was not sent and no quota was used. */
export class LinePushRejectedError extends Error {
  constructor(readonly status: number) {
    super(`LINE push rejected with ${status}`);
    this.name = "LinePushRejectedError";
  }
}

const REPLY_URL = "https://api.line.me/v2/bot/message/reply";
const PUSH_URL = "https://api.line.me/v2/bot/message/push";
const LOADING_URL = "https://api.line.me/v2/bot/chat/loading/start";
/** Multiples of 5 from 5 to 60; the reply clears it earlier. */
const LOADING_SECONDS = 30;
const REQUEST_TIMEOUT_MS = 10_000;

/** The Messaging API reply and push calls. Replies are free; pushes count against the quota. */
export function createLineReplyClient(
  channelAccessToken: string,
  fetchImpl: typeof fetch = fetch,
): LineReplyClient {
  const post = async (url: string, body: object, what: string, retryKey?: string) => {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${channelAccessToken}`,
        ...(retryKey === undefined ? {} : { "X-Line-Retry-Key": retryKey }),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.ok) return;
    // 409: LINE already accepted this retry key, so the message went out on an earlier attempt.
    if (res.status === 409 && retryKey !== undefined) return;
    if (what === "push" && res.status >= 400 && res.status < 500)
      throw new LinePushRejectedError(res.status);
    throw new Error(`LINE ${what} failed with ${res.status}`);
  };
  return {
    reply: (replyToken, messages) => post(REPLY_URL, { replyToken, messages }, "reply"),
    startLoading: (userId) =>
      post(LOADING_URL, { chatId: userId, loadingSeconds: LOADING_SECONDS }, "loading"),
    push: (userId, messages, retryKey) =>
      post(PUSH_URL, { to: userId, messages }, "push", retryKey),
  };
}

/** Local dev without a channel: replies go nowhere. */
export const silentReplyClient: LineReplyClient = {
  reply: () => Promise.resolve(),
  startLoading: () => Promise.resolve(),
  // Throws so a watch is never marked delivered when no channel token is configured.
  push: () => Promise.reject(new Error("LINE push is not configured")),
};
