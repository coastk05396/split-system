import type { Expense, Group } from "@split/shared";
import { useLineShare } from "../platform/line-share.js";
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

/**
 * Shares still being prepared after their Expense was saved, by Expense id. Router state must
 * be serialisable, so the Group page picks the promise up here instead.
 */
/** How long a share note waits for the Group page before it is dropped. */
const SHARE_KEPT_MS = 60_000;
const pendingShares = new Map<string, Promise<SavedShare>>();
export const watchPendingShare = (expenseId: string) => pendingShares.get(expenseId);
export const settlePendingShare = (expenseId: string) => pendingShares.delete(expenseId);

/** Prepare one Expense for sharing; a missing Invite never prevents sharing with existing Members. */
export function useExpenseSharing(groupId: string) {
  const sharing = useLineShare();
  async function prepare(
    expense: Expense,
    group: Group,
    nameOf: (memberId: string) => string,
    sendToChat: boolean,
  ): Promise<SavedShare> {
    const token = await sharing.inviteToken(groupId, { cached: true });
    const card = buildExpenseCard(expense, group, nameOf, token);
    let chat: ChatSendResult = "none";
    if (sendToChat) {
      chat = await sharing
        .post([expenseFlexMessage(card)])
        .then((): ChatSendResult => "sent")
        .catch((): ChatSendResult => "failed");
    }
    return { card, chat };
  }
  /** Best effort: have the Invite ready before the card is built. */
  function warm() {
    void sharing.inviteToken(groupId, { cached: true });
  }
  /** Prepare in the background; the Group page shows the result once it arrives. */
  function prepareLater(...args: Parameters<typeof prepare>) {
    const id = args[0].id;
    const share = prepare(...args);
    pendingShares.set(id, share);
    // If the user left before the Group page could pick it up, nobody else will drop it.
    setTimeout(() => {
      if (pendingShares.get(id) === share) pendingShares.delete(id);
    }, SHARE_KEPT_MS);
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
