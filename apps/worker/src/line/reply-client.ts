/** The only message the Bot sends in v1: plain text replies (decision 14). */
export interface LineMessage {
  type: "text";
  text: string;
}

/** Sends a reply with a webhook event's reply token; tests and local dev use a fake. */
export interface LineReplyClient {
  reply(replyToken: string, messages: LineMessage[]): Promise<void>;
}

const REPLY_URL = "https://api.line.me/v2/bot/message/reply";

/** The Messaging API reply call. Replies are free; the Bot never pushes. */
export function createLineReplyClient(
  channelAccessToken: string,
  fetchImpl: typeof fetch = fetch,
): LineReplyClient {
  return {
    async reply(replyToken, messages) {
      const res = await fetchImpl(REPLY_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${channelAccessToken}`,
        },
        body: JSON.stringify({ replyToken, messages }),
      });
      if (!res.ok) throw new Error(`LINE reply failed with ${res.status}`);
    },
  };
}

/** Local dev without a channel: replies go nowhere. */
export const silentReplyClient: LineReplyClient = {
  reply: () => Promise.resolve(),
};
