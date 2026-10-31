import type { Group, PlannedPayment } from "@split/shared";
import { describe, expect, it } from "vitest";
import { buildSettleCard, settleFlexMessage, settleText } from "./settle-card.js";

const group = { id: "g-1", name: "週末台南小旅行" } as Group;
const names: Record<string, string> = {
  m1: "Gulu",
  m2: "ty",
  m3: "Yizhen",
  m4: "小宇",
};
const nameOf = (id: string) => names[id] ?? id;

const payments: PlannedPayment[] = [
  { fromMemberId: "m1", toMemberId: "m2", amountMinor: 99 },
  { fromMemberId: "m3", toMemberId: "m2", amountMinor: 194 },
  { fromMemberId: "m4", toMemberId: "m1", amountMinor: 430 },
];

describe("settle share card", () => {
  it("lists every payment by Member Nickname sorted from largest amount to smallest", () => {
    const card = buildSettleCard(payments, group, "TWD", nameOf, "tok-1");

    expect(card.groupName).toBe("週末台南小旅行");
    expect(card.lines).toEqual([
      { payer: "小宇", receiver: "Gulu", label: "小宇 欠了 Gulu", amount: "NT$ 430" },
      { payer: "Yizhen", receiver: "ty", label: "Yizhen 欠了 ty", amount: "NT$ 194" },
      { payer: "Gulu", receiver: "ty", label: "Gulu 欠了 ty", amount: "NT$ 99" },
    ]);
    expect(card.url).toBe(
      `${window.location.origin}/join/tok-1?next=${encodeURIComponent("/groups/g-1?tab=settle")}`,
    );
  });

  it("builds a mega Flex card with the hero banner, group name, payment rows and settle button", () => {
    const card = buildSettleCard(payments, group, "TWD", nameOf);
    const message = settleFlexMessage(card);

    expect(message.type).toBe("flex");
    if (message.type !== "flex") return;
    expect(message.altText).toBe("「週末台南小旅行」的結算通知");
    expect(message.contents).toMatchObject({
      type: "bubble",
      size: "mega",
    });
    const json = JSON.stringify(message.contents);
    for (const text of [
      "🌱 週末台南小旅行",
      "小芽幫你算好囉～ 一起來結清吧！",
      "小宇 欠了 Gulu",
      "NT$ 430",
      "Yizhen 欠了 ty",
      "NT$ 194",
      "Gulu 欠了 ty",
      "NT$ 99",
      "✨ 前往結清款項",
      "/settle-hero.png",
    ]) {
      expect(json).toContain(text);
    }
    expect(json).not.toContain('"contents":[]');
  });

  it("formats plain text with the group name, prompt, rows and link", () => {
    const card = buildSettleCard(payments, group, "TWD", nameOf);
    expect(settleText(card)).toBe(
      [
        "🌱 週末台南小旅行",
        "小芽幫你算好囉～ 一起來結清吧！",
        "小宇 欠了 Gulu  NT$ 430",
        "Yizhen 欠了 ty  NT$ 194",
        "Gulu 欠了 ty  NT$ 99",
        `${window.location.origin}/groups/g-1?tab=settle`,
      ].join("\n"),
    );
  });
});
