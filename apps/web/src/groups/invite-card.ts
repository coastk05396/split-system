import { COLOR } from "../expenses/expense-card.js";
import { t } from "../i18n/messages.js";
import type { LineMessage } from "../platform/line.js";

/**
 * The LINE Flex card for an invitation, dressed like the Expense card: a peach strip on top, a
 * sprout bubble beside the app name, the Group to join with a mint chip, and one green button
 * that opens the invitation.
 */
export function inviteFlexMessage({
  groupName,
  url,
}: {
  groupName: string;
  /** The LIFF address of the invitation. */
  url: string;
}): LineMessage {
  return {
    type: "flex",
    altText: t("invite.card.alt", { name: groupName }),
    contents: {
      type: "bubble",
      size: "kilo",
      styles: {
        header: { backgroundColor: COLOR.peach },
        body: { backgroundColor: COLOR.white },
      },
      header: {
        type: "box",
        layout: "vertical",
        paddingAll: "3px",
        contents: [{ type: "filler" }],
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "18px",
        spacing: "lg",
        contents: [
          {
            type: "box",
            layout: "horizontal",
            spacing: "md",
            alignItems: "center",
            contents: [
              {
                type: "box",
                layout: "vertical",
                width: "44px",
                height: "44px",
                cornerRadius: "14px",
                backgroundColor: COLOR.mint,
                justifyContent: "center",
                alignItems: "center",
                flex: 0,
                contents: [{ type: "text", text: "🌱", size: "xl", align: "center" }],
              },
              {
                type: "text",
                text: t("invite.card.app"),
                size: "sm",
                weight: "bold",
                color: COLOR.muted,
                flex: 1,
              },
              {
                type: "box",
                layout: "vertical",
                cornerRadius: "20px",
                backgroundColor: COLOR.mint,
                paddingTop: "6px",
                paddingBottom: "6px",
                paddingStart: "12px",
                paddingEnd: "12px",
                flex: 0,
                contents: [
                  {
                    type: "text",
                    text: t("invite.card.badge"),
                    size: "xxs",
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
          {
            type: "box",
            layout: "horizontal",
            cornerRadius: "18px",
            backgroundColor: COLOR.sprout,
            paddingAll: "14px",
            action: { type: "uri", label: t("invite.card.join"), uri: url },
            contents: [
              {
                type: "text",
                text: `${t("invite.card.join")} ↗`,
                color: COLOR.white,
                weight: "bold",
                align: "center",
              },
            ],
          },
        ],
      },
    },
  };
}
