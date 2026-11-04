import type { Expense, Group, Invite } from "@split/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { useDeps } from "../app/AppProviders.js";
import { groupKeys, useEnsureInvite } from "../groups/api.js";
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
  const invite = useEnsureInvite(groupId);
  const client = useQueryClient();
  const { line } = useDeps();
  // One ensure request at a time: the warm-up and a quick save would otherwise each send one.
  const asking = useRef<Promise<Invite | null> | null>(null);
  function ensureInvite(): Promise<Invite | null> {
    asking.current ??= invite
      .mutateAsync()
      .catch(() => null)
      .finally(() => {
        asking.current = null;
      });
    return asking.current;
  }
  async function prepare(
    expense: Expense,
    group: Group,
    nameOf: (memberId: string) => string,
    sendToChat: boolean,
  ): Promise<SavedShare> {
    const cached = client.getQueryData<Invite>(groupKeys.invite(groupId));
    const link = cached ?? (await ensureInvite());
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
  /** Best effort: have the Invite ready before the card is built. */
  function warm() {
    if (client.getQueryData<Invite>(groupKeys.invite(groupId)) === undefined) {
      void ensureInvite();
    }
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
