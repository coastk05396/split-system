import { type Expense, formatAmount, type Group } from "@split/shared";
import { categoryLabel } from "../i18n/format.js";
import { t } from "../i18n/messages.js";
import type { LineMessage } from "../platform/line.js";

/** What a shared Expense says, kept plain so it can ride in router state and become text or a card. */
export interface ExpenseCard {
  groupName: string;
  title: string;
  emoji: string;
  amount: string;
  /** How it was divided, e.g. "4 人一起分". */
  split: string;
  /** Who paid, e.g. "小宇先付". */
  payer: string;
  /** What each person owes under an equal split; null for the other split methods. */
  each: string | null;
  url: string;
}

const EMOJI: Readonly<Record<string, string>> = {
  餐飲: "🍽️",
  交通: "🚗",
  住宿: "🛏️",
  購物: "🛍️",
  娛樂: "🎟️",
  門票: "🎟️",
  醫療: "💊",
  其他: "✨",
};

/** Brand colours of the card, the same sprout palette as the app. */
const COLOR = {
  mint: "#E8F5EB",
  line: "#DBEDE0",
  peach: "#FFE3CA",
  sprout: "#2E9D71",
  ink: "#163D2A",
  muted: "#4F6B5B",
  white: "#FFFFFF",
} as const;

function splitText(expense: Expense): string {
  if (expense.splitMethod === "equal") {
    return t("expenseShare.splitEqual", { count: expense.splits.length });
  }
  return t(
    expense.splitMethod === "exact" ? "expenseShare.splitExact" : "expenseShare.splitShares",
  );
}

export function buildExpenseCard(
  expense: Expense,
  group: Group,
  nameOf: (memberId: string) => string,
): ExpenseCard {
  const [payer, ...otherPayers] = expense.payers;
  const eachMinor = Math.max(0, ...expense.splits.map((split) => split.amountMinor));
  return {
    groupName: group.name,
    title:
      expense.description.trim() === "" ? categoryLabel(expense.category) : expense.description,
    emoji: EMOJI[expense.category] ?? "✨",
    amount: formatAmount(expense.originalAmount, expense.originalCurrency),
    split: splitText(expense),
    payer:
      payer !== undefined && otherPayers.length === 0
        ? t("expenseShare.payer", { name: nameOf(payer.memberId) })
        : t("expenseShare.payers", { count: expense.payers.length }),
    each:
      expense.splitMethod === "equal" && expense.splits.length > 1
        ? t("expenseShare.each", { amount: formatAmount(eachMinor, expense.originalCurrency) })
        : null,
    url: `${window.location.origin}/groups/${group.id}/expenses/${expense.id}`,
  };
}

/** The same without the link, for services that take the link separately. */
export function expenseTextWithoutLink(card: ExpenseCard): string {
  const detail = [card.payer, card.split, card.each].filter((part) => part !== null).join(" · ");
  return `${card.groupName}\n${card.emoji} ${card.title}  ${card.amount}\n${detail}`;
}

/** The plain-text version, for Telegram, the system share menu, copy and the LINE link. */
export function expenseText(card: ExpenseCard): string {
  return `${expenseTextWithoutLink(card)}\n${card.url}`;
}

/**
 * The LINE Flex card: a peach strip on top, a receipt bubble beside the group name, the Expense
 * name and amount with a mint "split among" chip, who paid and what each owes, and one green
 * button that opens the Expense.
 */
export function expenseFlexMessage(card: ExpenseCard): LineMessage {
  return {
    type: "flex",
    altText: t("expenseShare.alt", { title: card.title, amount: card.amount }),
    contents: {
      type: "bubble",
      size: "kilo",
      styles: {
        header: { backgroundColor: COLOR.peach },
        body: { backgroundColor: COLOR.white },
      },
      // LINE rejects a box with no contents, so the thin peach strip holds one empty filler.
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
                backgroundColor: COLOR.peach,
                justifyContent: "center",
                alignItems: "center",
                flex: 0,
                contents: [{ type: "text", text: "🧾", size: "xl", align: "center" }],
              },
              {
                type: "text",
                text: card.groupName,
                size: "sm",
                weight: "bold",
                color: COLOR.muted,
                wrap: true,
                maxLines: 2,
                flex: 1,
              },
            ],
          },
          {
            type: "text",
            text: `${card.title} ${card.emoji}`,
            weight: "bold",
            size: "lg",
            color: COLOR.ink,
            wrap: true,
            maxLines: 2,
          },
          {
            type: "box",
            layout: "horizontal",
            alignItems: "center",
            spacing: "md",
            contents: [
              {
                type: "text",
                text: card.amount,
                size: "xxl",
                weight: "bold",
                color: COLOR.ink,
                flex: 1,
                adjustMode: "shrink-to-fit",
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
                    text: card.split,
                    size: "xs",
                    weight: "bold",
                    color: COLOR.sprout,
                  },
                ],
              },
            ],
          },
          { type: "separator", color: COLOR.line },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: card.payer, size: "sm", color: COLOR.muted, flex: 1 },
              ...(card.each === null
                ? []
                : [
                    {
                      type: "text" as const,
                      text: card.each,
                      size: "sm",
                      weight: "bold" as const,
                      color: COLOR.sprout,
                      align: "end" as const,
                      flex: 0,
                    },
                  ]),
            ],
          },
          {
            type: "box",
            layout: "horizontal",
            cornerRadius: "18px",
            backgroundColor: COLOR.sprout,
            paddingAll: "14px",
            action: { type: "uri", label: t("expenseShare.view"), uri: card.url },
            contents: [
              {
                type: "text",
                text: `${t("expenseShare.view")} ↗`,
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
