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
  /** A LINE Push message; counts against the monthly quota, so callers reserve a slot first. */
  push(userId: string, messages: LineMessage[]): Promise<void>;
}

const REPLY_URL = "https://api.line.me/v2/bot/message/reply";
const PUSH_URL = "https://api.line.me/v2/bot/message/push";
const LOADING_URL = "https://api.line.me/v2/bot/chat/loading/start";
/** Multiples of 5 from 5 to 60; the reply clears it earlier. */
const LOADING_SECONDS = 30;

/** The Messaging API reply and push calls. Replies are free; pushes count against the quota. */
export function createLineReplyClient(
  channelAccessToken: string,
  fetchImpl: typeof fetch = fetch,
): LineReplyClient {
  const post = async (url: string, body: object, what: string) => {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${channelAccessToken}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`LINE ${what} failed with ${res.status}`);
  };
  return {
    reply: (replyToken, messages) => post(REPLY_URL, { replyToken, messages }, "reply"),
    startLoading: (userId) =>
      post(LOADING_URL, { chatId: userId, loadingSeconds: LOADING_SECONDS }, "loading"),
    push: (userId, messages) => post(PUSH_URL, { to: userId, messages }, "push"),
  };
}

/** Local dev without a channel: replies go nowhere. */
export const silentReplyClient: LineReplyClient = {
  reply: () => Promise.resolve(),
  startLoading: () => Promise.resolve(),
  // Throws so a watch is never marked delivered when no channel token is configured.
  push: () => Promise.reject(new Error("LINE push is not configured")),
};
