import {
  FLIGHT_DESTINATIONS,
  formatAmount,
  type FlightCard,
  type FlightSearchIntent,
} from "@split/shared";
import { SIGNAL_LABEL, time } from "../flights/advice.js";
import type { FlexBubble, FlexComponent } from "./reply-client.js";

/** One carousel holds at most 5 bubbles: up to 4 flights and 1 portal into LIFF. */
export const MAX_FLIGHT_BUBBLES = 4;

const SIGNAL_COLOR = { strong_buy: "#1B8A4B", buy: "#2563EB", hold: "#B45309" } as const;
const MUTED = "#6B7280";

/** Query string that carries a whole search: postbacks and the LIFF portal share it. */
export function serializeIntent(intent: FlightSearchIntent): string {
  const params = new URLSearchParams({
    origin: intent.origin,
    destination: intent.destination,
    departureDate: intent.departureDate,
    returnDate: intent.returnDate,
    currency: intent.currency,
    excludeRedEye: intent.excludeRedEye ? "1" : "0",
    directOnly: intent.directOnly ? "1" : "0",
  });
  if (intent.budget !== undefined) params.set("budget", String(intent.budget));
  if (intent.theme !== undefined) params.set("theme", intent.theme);
  return params.toString();
}

// Every text has a fixed maxLines and every bubble the same rows, so all cards share one height.
const row = (
  text: string,
  options: { size?: string; weight?: "bold"; color?: string; align?: "end"; flex?: number } = {},
): FlexComponent => ({ type: "text", text, size: "xs", wrap: true, maxLines: 1, ...options });

const duration = (minutes: number) => `${Math.floor(minutes / 60)}h${minutes % 60}m`;
const monthDay = (date: string) => date.slice(5).replace("-", "/");
const sameLine = (leg: "去" | "回", departure: string | null, arrival: string | null) =>
  departure === null || arrival === null
    ? `${leg} 時間以 Google 航班為準`
    : `${leg} ${time(departure)} → ${time(arrival)}`;

/** Two plain-language lines grounded in the card's own facts; never a guessed number. */
function insights(card: FlightCard): [string, string] {
  const money = (amount: number) => formatAmount(amount, card.intent.currency);
  const history = card.history;
  const first = history
    ? history.percentBelowMean >= 0
      ? `比近 ${history.days} 天均價低 ${history.percentBelowMean}%`
      : `比近 ${history.days} 天均價高 ${Math.abs(history.percentBelowMean)}%`
    : {
        low: "Google 判斷目前票價偏低",
        typical: "Google 判斷目前票價屬一般",
        high: "Google 判斷目前票價偏高",
        unknown: "還沒有足夠歷史價格可比較",
      }[card.priceLevel];
  const second =
    card.intent.budget === undefined
      ? "尚未設定預算"
      : card.overBudget > 0
        ? `超出預算 ${money(card.overBudget)}`
        : `在預算 ${money(card.intent.budget)} 內`;
  return [first, second];
}

function bubble(parts: {
  badge: string;
  badgeColor: string;
  tag: string;
  body: FlexComponent[];
  action: { label: string; uri: string };
}): FlexBubble {
  return {
    type: "bubble",
    size: "kilo",
    header: {
      type: "box",
      layout: "horizontal",
      paddingAll: "md",
      backgroundColor: parts.badgeColor,
      contents: [
        row(parts.badge, { weight: "bold", color: "#FFFFFF", flex: 3 }),
        row(parts.tag, { color: "#FFFFFF", align: "end", flex: 2 }),
      ],
    },
    body: { type: "box", layout: "vertical", spacing: "sm", contents: parts.body },
    footer: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "button",
          style: "link",
          height: "sm",
          action: { type: "uri", label: parts.action.label, uri: parts.action.uri },
        },
      ],
    },
  };
}

export function flightBubble(card: FlightCard): FlexBubble {
  const { intent } = card;
  const place = FLIGHT_DESTINATIONS.find((d) => d.airport === intent.destination)?.zhTW;
  const [first, second] = insights(card);
  return bubble({
    badge: SIGNAL_LABEL[card.signal][0],
    badgeColor: SIGNAL_COLOR[card.signal],
    tag: `${card.stops === 0 ? "直飛" : `轉機 ${card.stops} 次`} · ${duration(card.durationMinutes)}`,
    body: [
      row(`${place ?? ""} ${intent.destination}`.trim(), { size: "md", weight: "bold" }),
      row(`${monthDay(intent.departureDate)} – ${monthDay(intent.returnDate)}`, { color: MUTED }),
      row(formatAmount(card.price, intent.currency), { size: "xl", weight: "bold" }),
      row("含稅來回", { color: MUTED }),
      { type: "separator" },
      row(`${sameLine("去", card.outboundDeparture, card.outboundArrival)} · ${card.airline}`),
      row(sameLine("回", card.inboundDeparture, card.inboundArrival)),
      { type: "separator" },
      row(first, { color: MUTED }),
      row(second, { color: MUTED }),
    ],
    action: { label: "查看航班 ↗", uri: card.url },
  });
}

/** The last bubble: same rows as a flight bubble, opening LIFF `/travel` with the same search. */
export function portalBubble(portalUrl: string): FlexBubble {
  return bubble({
    badge: "機票雷達",
    badgeColor: "#374151",
    tag: "小芽",
    body: [
      row("看更多航班", { size: "md", weight: "bold" }),
      row("在小芽打開同一個搜尋", { color: MUTED }),
      row("更多選擇", { size: "xl", weight: "bold" }),
      row("也能設定降價提醒", { color: MUTED }),
      { type: "separator" },
      row("同樣的條件，完整票價一次看"),
      row("不用重新輸入"),
      { type: "separator" },
      row("可比較更多日期與目的地", { color: MUTED }),
      row("登入小芽即可使用", { color: MUTED }),
    ],
    action: { label: "打開小芽機票雷達 ↗", uri: portalUrl },
  });
}
