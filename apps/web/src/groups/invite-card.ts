import type { Group } from "@split/shared";
import { t } from "../i18n/messages.js";
import type { LineMessage } from "../platform/line.js";
import { COLOR, flexBubbleFrame, groupJoinLink, groupJoinUrl } from "../platform/line-flex.js";
import type { ShareContent } from "./ShareButtons.js";

export interface InviteCard {
  groupName: string;
  url: string;
  lineUrl: string;
}

export function buildInviteCard(
  group: Pick<Group, "id" | "name">,
  inviteToken: string | null | undefined,
): InviteCard {
  return {
    groupName: group.name,
    url: groupJoinUrl(group.id, inviteToken),
    lineUrl: groupJoinLink(group.id, inviteToken),
  };
}

export function inviteText(card: { groupName: string; url: string; lineUrl?: string }): string {
  return t("invite.shareMessage", { name: card.groupName, url: card.lineUrl ?? card.url });
}

/**
 * The LINE Flex card for an invitation, dressed like the Expense card: a peach strip on top, a
 * mint invite tag, the Group to join with a friendly line, and one green button that opens the
 * invitation.
 */
export function inviteFlexMessage({
  groupName,
  url,
  lineUrl,
}: {
  groupName: string;
  /** The LIFF address of the invitation. */
  url: string;
  lineUrl?: string;
}): LineMessage {
  return flexBubbleFrame({
    altText: t("invite.card.alt", { name: groupName }),
    contents: [
      {
        type: "box",
        layout: "horizontal",
        contents: [
          {
            type: "box",
            layout: "vertical",
            cornerRadius: "20px",
            backgroundColor: COLOR.mint,
            paddingTop: "5px",
            paddingBottom: "5px",
            paddingStart: "12px",
            paddingEnd: "12px",
            flex: 0,
            contents: [
              {
                type: "text",
                text: t("invite.card.badge"),
                size: "xs",
                weight: "bold",
                color: COLOR.sprout,
              },
            ],
          },
        ],
      },
      {
        type: "text",
        text: groupName,
        weight: "bold",
        size: "xl",
        color: COLOR.ink,
        wrap: true,
        maxLines: 2,
      },
      {
        type: "text",
        text: t("invite.card.body"),
        size: "sm",
        color: COLOR.muted,
        wrap: true,
      },
      { type: "separator", color: COLOR.line },
    ],
    actionLabel: t("invite.card.join"),
    actionUri: lineUrl ?? url,
  });
}

export function inviteShareContent(
  groupOrCard: Pick<Group, "id" | "name"> | InviteCard,
  inviteToken?: string | null,
): ShareContent & { lineMessages: [LineMessage] } {
  const card = "groupName" in groupOrCard ? groupOrCard : buildInviteCard(groupOrCard, inviteToken);
  const text = inviteText(card);
  return {
    text,
    url: card.url,
    title: card.groupName,
    telegramText: t("invite.shareTelegramText", { name: card.groupName }),
    lineMessages: [inviteFlexMessage(card)],
    copyText: text,
    copyLabel: t("invite.copy"),
    copiedNotice: t("invite.copied"),
  };
}
