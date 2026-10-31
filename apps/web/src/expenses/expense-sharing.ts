import type { Expense, Group } from "@split/shared";
import { useDeps } from "../app/AppProviders.js";
import { useEnsureInvite } from "../groups/api.js";
import type { ShareContent } from "../groups/ShareButtons.js";
import { t } from "../i18n/messages.js";
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
  const invite = useEnsureInvite(groupId);
  const { line } = useDeps();
  async function prepare(
    expense: Expense,
    group: Group,
    nameOf: (memberId: string) => string,
    sendToChat: boolean,
  ): Promise<SavedShare> {
    const link = await invite.mutateAsync().catch(() => null);
    const card = buildExpenseCard(expense, group, nameOf, link?.token ?? null);
    let chat: ChatSendResult = "none";
    if (sendToChat) {
      chat = await line
        .sendToChat([expenseFlexMessage(card)])
        .then((): ChatSendResult => "sent")
        .catch((): ChatSendResult => "failed");
    }
    return { card, chat };
  }
  return { prepare };
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
