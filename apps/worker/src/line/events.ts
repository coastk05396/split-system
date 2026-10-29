import { z } from "zod";
import type { LineMessage } from "./reply-client.js";

/** Postback data of the Rich Menu's 使用幫助 button. */
export const HELP_POSTBACK_DATA = "action=help";

export const WELCOME_TEXT = [
  "嗨，歡迎加入小芽分帳 🌱",
  "聚餐快分、旅行慢慢記，一群人的開銷交給小芽。",
  "點下方「小芽快捷選單」就能建立群組、記一筆或查看結算。",
].join("\n");

export const HELP_TEXT = [
  "小芽使用幫助 🌱",
  "・快速分帳：建立群組，邀朋友一起記帳",
  "・我的旅程：打開最近的旅行",
  "・記一筆：新增一筆開銷",
  "・查看結算：看看誰該付給誰",
  "・邀請夥伴：分享邀請連結",
  "小芽只記錄誰欠誰，不經手任何款項。",
].join("\n");

/** Decision 14: free text is not parsed; it gets this one pointer at the menu. */
export const MENU_POINTER_TEXT = "點下方選單就能記帳 🌱";

const eventSchema = z.looseObject({
  type: z.string(),
  replyToken: z.string().optional(),
  postback: z.looseObject({ data: z.string() }).optional(),
});

/** The parts of a webhook body the Bot reads; everything else is ignored. */
export const webhookBodySchema = z.looseObject({ events: z.array(eventSchema) });

export type WebhookEvent = z.infer<typeof eventSchema>;

/**
 * The replies for one event: follow, message and the help postback only. Every other
 * event (unfollow, join, other postbacks) gets nothing.
 */
export function repliesFor(event: WebhookEvent): LineMessage[] {
  switch (event.type) {
    case "follow":
      return [{ type: "text", text: WELCOME_TEXT }];
    case "message":
      return [{ type: "text", text: MENU_POINTER_TEXT }];
    case "postback":
      return event.postback?.data === HELP_POSTBACK_DATA ? [{ type: "text", text: HELP_TEXT }] : [];
    default:
      return [];
  }
}
