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

export interface SettledCard {
  groupName: string;
  payer: string;
  receiver: string;
  amount: string;
  url: string;
  lineUrl: string;
  payerPictureUrl?: string | null | undefined;
  receiverPictureUrl?: string | null | undefined;
}

export function buildSettledCard(
  settlement: {
    payer: string;
    receiver: string;
    amount: number;
    payerPictureUrl?: string | null | undefined;
    receiverPictureUrl?: string | null | undefined;
  },
  group: Group,
  currency: CurrencyCode,
  inviteToken: string | null = null,
): SettledCard {
  const path = `/groups/${group.id}?tab=settle`;
  const url =
    inviteToken === null
      ? `${window.location.origin}${path}`
      : `${window.location.origin}/join/${inviteToken}?next=${encodeURIComponent(path)}`;
  return {
    groupName: group.name,
    payer: settlement.payer,
    receiver: settlement.receiver,
    amount: formatAmount(settlement.amount, currency),
    url,
    lineUrl: liffLink(url),
    payerPictureUrl: settlement.payerPictureUrl ?? null,
    receiverPictureUrl: settlement.receiverPictureUrl ?? null,
  };
}

function avatarBox(name: string, pictureUrl?: string | null) {
  if (pictureUrl && pictureUrl.startsWith("https://")) {
    return {
      type: "box" as const,
      layout: "vertical" as const,
      width: "22px",
      height: "22px",
      cornerRadius: "100px",
      flex: 0,
      contents: [
        {
          type: "image" as const,
          url: pictureUrl,
          size: "full" as const,
          aspectRatio: "1:1" as const,
          aspectMode: "cover" as const,
        },
      ],
    };
  }
  const first = new Intl.Segmenter().segment(name.trim() || "?")[Symbol.iterator]().next();
  const initial = first.done === true ? "?" : first.value.segment.toUpperCase();
  return {
    type: "box" as const,
    layout: "vertical" as const,
    width: "22px",
    height: "22px",
    cornerRadius: "100px",
    backgroundColor: COLOR.mint,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    flex: 0,
    contents: [
      {
        type: "text" as const,
        text: initial,
        size: "xxs" as const,
        weight: "bold" as const,
        color: COLOR.sprout,
        align: "center" as const,
      },
    ],
  };
}

export function settledFlexMessage(card: SettledCard): LineMessage {
  return {
    type: "flex",
    altText: t("settleShare.settledAlt", {
      name: card.groupName,
      payer: card.payer,
      receiver: card.receiver,
      amount: card.amount,
    }),
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
                backgroundColor: COLOR.peach,
                justifyContent: "center",
                alignItems: "center",
                flex: 0,
                contents: [{ type: "text", text: "🤝", size: "xl", align: "center" }],
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
            type: "box",
            layout: "horizontal",
            alignItems: "center",
            spacing: "xs",
            contents: [
              avatarBox(card.payer, card.payerPictureUrl),
              {
                type: "text",
                text: card.payer,
                size: "sm",
                weight: "bold",
                color: COLOR.ink,
                flex: 0,
                maxLines: 1,
              },
              {
                type: "text",
                text: "➔",
                size: "xs",
                color: COLOR.muted,
                flex: 0,
                align: "center",
              },
              avatarBox(card.receiver, card.receiverPictureUrl),
              {
                type: "text",
                text: card.receiver,
                size: "sm",
                weight: "bold",
                color: COLOR.ink,
                flex: 0,
                maxLines: 1,
              },
            ],
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
                    text: t("groups.settled"),
                    size: "xxs",
                    weight: "bold",
                    color: COLOR.sprout,
                  },
                ],
              },
            ],
          },
          {
            type: "box",
            layout: "horizontal",
            cornerRadius: "18px",
            backgroundColor: COLOR.sprout,
            paddingAll: "14px",
            action: { type: "uri", label: t("settleShare.viewSettle"), uri: card.lineUrl },
            contents: [
              {
                type: "text",
                text: `✨ ${t("settleShare.viewSettle")} ↗`,
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
