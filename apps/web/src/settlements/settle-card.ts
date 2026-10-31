import { type CurrencyCode, formatAmount, type Group, type PlannedPayment } from "@split/shared";
import { COLOR } from "../expenses/expense-card.js";
import { t } from "../i18n/messages.js";
import { liffLink } from "../platform/liff-link.js";
import type { LineMessage } from "../platform/line.js";

export interface SettleCardLine {
  payer: string;
  receiver: string;
  label: string;
  amount: string;
}

/** What a shared Payment plan says, ready for plain text or a LINE Flex card. */
export interface SettleCard {
  groupName: string;
  lines: readonly SettleCardLine[];
  /** Opens the Group's 結算 tab, joining through its Invite first if the person is not in it. */
  url: string;
  /** The same as a LIFF address, for what goes into LINE. */
  lineUrl: string;
  /** Public HTTPS URL of the sprout hero banner image. */
  heroUrl: string;
}

const SETTLE_BG = "#EFF8F1";
const SETTLE_AMOUNT = "#A85520";

export function buildSettleCard(
  payments: readonly PlannedPayment[],
  group: Group,
  currency: CurrencyCode,
  nameOf: (memberId: string) => string,
  /** The Group's live Invite token; without it the link only works for people already in. */
  inviteToken: string | null = null,
): SettleCard {
  const path = `/groups/${group.id}?tab=settle`;
  const url =
    inviteToken === null
      ? `${window.location.origin}${path}`
      : `${window.location.origin}/join/${inviteToken}?next=${encodeURIComponent(path)}`;
  const sorted = [...payments].sort((a, b) => {
    if (b.amountMinor !== a.amountMinor) return b.amountMinor - a.amountMinor;
    const payerCmp = nameOf(a.fromMemberId).localeCompare(nameOf(b.fromMemberId));
    if (payerCmp !== 0) return payerCmp;
    return nameOf(a.toMemberId).localeCompare(nameOf(b.toMemberId));
  });
  const lines: SettleCardLine[] = sorted.map((p) => {
    const payer = nameOf(p.fromMemberId);
    const receiver = nameOf(p.toMemberId);
    return {
      payer,
      receiver,
      label: t("settleShare.owes", { payer, receiver }),
      amount: formatAmount(p.amountMinor, currency),
    };
  });
  return {
    groupName: group.name,
    lines,
    url,
    lineUrl: liffLink(url),
    heroUrl: `${window.location.origin}/settle-hero.png`,
  };
}

/** The plain-text version, for the LINE share link fallback outside LIFF. */
export function settleText(card: SettleCard): string {
  const rows = card.lines.map((line) => `${line.label}  ${line.amount}`).join("\n");
  return [
    `🌱 ${card.groupName}`,
    t("settleShare.subtitle"),
    ...(rows === "" ? [] : [rows]),
    card.lineUrl,
  ].join("\n");
}

/**
 * The LINE Flex card for the Group's Payment plan: the sprout hero banner on top, the Group name
 * and friendly prompt, every planned payment sorted by amount, and a green button that opens the
 * Group's 結算 tab.
 */
export function settleFlexMessage(card: SettleCard): LineMessage {
  return {
    type: "flex",
    altText: t("settleShare.alt", { name: card.groupName }),
    contents: {
      type: "bubble",
      size: "mega",
      styles: {
        hero: { backgroundColor: SETTLE_BG },
        body: { backgroundColor: SETTLE_BG },
      },
      hero: {
        type: "image",
        url: card.heroUrl,
        size: "full",
        aspectRatio: "13:5",
        aspectMode: "cover",
        action: { type: "uri", label: t("settleShare.action"), uri: card.lineUrl },
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "20px",
        spacing: "md",
        contents: [
          {
            type: "text",
            text: `🌱 ${card.groupName}`,
            weight: "bold",
            size: "xl",
            color: COLOR.ink,
            wrap: true,
            maxLines: 2,
          },
          {
            type: "text",
            text: t("settleShare.subtitle"),
            size: "sm",
            color: COLOR.muted,
            wrap: true,
          },
          ...(card.lines.length === 0
            ? []
            : [
                {
                  type: "box" as const,
                  layout: "vertical" as const,
                  margin: "lg" as const,
                  spacing: "sm" as const,
                  contents: card.lines.map((line) => ({
                    type: "box" as const,
                    layout: "horizontal" as const,
                    alignItems: "center" as const,
                    spacing: "sm" as const,
                    contents: [
                      {
                        type: "text" as const,
                        text: line.label,
                        size: "sm" as const,
                        color: COLOR.muted,
                        flex: 1,
                        wrap: true,
                      },
                      {
                        type: "text" as const,
                        text: line.amount,
                        size: "md" as const,
                        weight: "bold" as const,
                        color: SETTLE_AMOUNT,
                        align: "end" as const,
                        flex: 0,
                      },
                    ],
                  })),
                },
              ]),
          {
            type: "box",
            layout: "horizontal",
            margin: "lg",
            cornerRadius: "18px",
            backgroundColor: COLOR.sprout,
            paddingAll: "14px",
            action: { type: "uri", label: t("settleShare.action"), uri: card.lineUrl },
            contents: [
              {
                type: "text",
                text: `✨ ${t("settleShare.action")}`,
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
