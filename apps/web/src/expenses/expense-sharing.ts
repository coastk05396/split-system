import type { Expense, Group } from "@split/shared";
import { useLineShare } from "../platform/line-share.js";
import type { ShareContent } from "../groups/ShareButtons.js";
import { t } from "../i18n/messages.js";
import { currentEpoch, rememberShare } from "./writes.js";
import {
  buildExpenseCard,
  type ExpenseCard,
  expenseFlexMessage,
  expenseText,
  expenseTextWithoutLink,
} from "./expense-card.js";

export type ChatSendResult = "none" | "sent" | "failed";
export interface SavedShare {
  card: ExpenseCard;
  chat: ChatSendResult;
}

/** Prepare one Expense for sharing; a missing Invite never prevents sharing with existing Members. */
export function useExpenseSharing(groupId: string) {
  const sharing = useLineShare();
  async function prepare(
    expense: Expense,
    group: Group,
    nameOf: (memberId: string) => string,
    sendToChat: boolean,
  ): Promise<SavedShare | null> {
    const asked = currentEpoch();
    const token = await sharing.inviteToken(groupId, { cached: true });
    if (asked !== currentEpoch()) return null;
    const card = buildExpenseCard(expense, group, nameOf, token);
    let chat: ChatSendResult = "none";
    if (sendToChat) {
      chat = await sharing
        .post([expenseFlexMessage(card)])
        .then((): ChatSendResult => "sent")
        .catch((): ChatSendResult => "failed");
    }
    return asked === currentEpoch() ? { card, chat } : null;
  }
  /** Best effort: have the Invite ready before the card is built. */
  function warm() {
    void sharing.inviteToken(groupId, { cached: true });
  }
  /** Prepare in the background; the Group page shows the result once it arrives. */
  function prepareLater(...args: Parameters<typeof prepare>) {
    rememberShare(groupId, args[0].id, prepare(...args));
  }
  return { prepare, prepareLater, warm };
}

/** Every sharing adapter receives the same Expense text, link, and LINE card. */
export function expenseShareContent(card: ExpenseCard): ShareContent {
  const text = expenseText(card);
  return {
    text,
    url: card.url,
    title: card.title,
    telegramText: expenseTextWithoutLink(card),
    lineMessages: [expenseFlexMessage(card)],
    copyText: text,
    copyLabel: t("expenseShare.copy"),
    copiedNotice: t("expenseShare.copied"),
  };
}
