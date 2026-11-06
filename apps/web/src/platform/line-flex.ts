import { liffLink } from "./liff-link.js";
import type { LineMessage } from "./line.js";

/** Brand colours of the card, the same sprout palette as the app. */
export const COLOR = {
  mint: "#E8F5EB",
  line: "#DBEDE0",
  peach: "#FFE3CA",
  sprout: "#2E9D71",
  ink: "#163D2A",
  muted: "#4F6B5B",
  white: "#FFFFFF",
} as const;

type FlexBubble = Extract<LineMessage, { type: "flex" }>["contents"] & { type: "bubble" };
export type FlexComponent = NonNullable<FlexBubble["body"]>["contents"][number];
type FlexSpacing = NonNullable<FlexBubble["body"]>["spacing"];
type FlexMargin = NonNullable<Extract<FlexComponent, { type: "box" }>["margin"]>;

/**
 * The web address for opening a Group resource—through its Invite `/join/:token` when one is
 * available so a non-Member can join first, or directly at `nextPath` (defaulting to the Group
 * page) when no Invite token is present.
 */
export function groupJoinUrl(
  groupId: string,
  inviteToken: string | null | undefined,
  nextPath?: string,
): string {
  const fallback = nextPath ?? `/groups/${encodeURIComponent(groupId)}`;
  if (inviteToken === null || inviteToken === undefined || inviteToken === "") {
    return `${window.location.origin}${fallback}`;
  }
  const base = `${window.location.origin}/join/${encodeURIComponent(inviteToken)}`;
  return nextPath === undefined ? base : `${base}?next=${encodeURIComponent(nextPath)}`;
}

/** The same deep link as a LIFF address for sharing inside LINE. */
export function groupJoinLink(
  groupId: string,
  inviteToken: string | null | undefined,
  nextPath?: string,
): string {
  return liffLink(groupJoinUrl(groupId, inviteToken, nextPath));
}

export interface FlexBubbleFrameInput {
  altText: string;
  spacing?: FlexSpacing;
  contents: FlexComponent[];
  actionLabel: string;
  actionUri: string;
  actionMargin?: FlexMargin;
}

/**
 * Shared kilo Flex bubble frame for 小芽 cards: a thin peach strip on top, a white body, and a
 * sprout green URI action button at the bottom.
 */
export function flexBubbleFrame({
  altText,
  spacing = "lg",
  contents,
  actionLabel,
  actionUri,
  actionMargin,
}: FlexBubbleFrameInput): LineMessage {
  const cta = actionLabel.endsWith("↗") ? actionLabel : `${actionLabel} ↗`;
  return {
    type: "flex",
    altText,
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
        spacing,
        contents: [
          ...contents,
          {
            type: "box",
            layout: "horizontal",
            ...(actionMargin === undefined ? {} : { margin: actionMargin }),
            cornerRadius: "18px",
            backgroundColor: COLOR.sprout,
            paddingAll: "14px",
            action: { type: "uri", label: cta, uri: actionUri },
            contents: [
              {
                type: "text",
                text: cta,
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
