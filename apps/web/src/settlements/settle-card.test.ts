import type { Group, PlannedPayment } from "@split/shared";
import { describe, expect, it } from "vitest";
import {
  buildSettleCard,
  buildSettledCard,
  settleFlexMessage,
  settledFlexMessage,
  settleText,
} from "./settle-card.js";

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
      { payer: "小宇", receiver: "Gulu", label: "小宇 ➔ Gulu", amount: "NT$ 430" },
      { payer: "Yizhen", receiver: "ty", label: "Yizhen ➔ ty", amount: "NT$ 194" },
      { payer: "Gulu", receiver: "ty", label: "Gulu ➔ ty", amount: "NT$ 99" },
    ]);
    expect(card.url).toBe(
      `${window.location.origin}/join/tok-1?next=${encodeURIComponent("/groups/g-1?tab=settle")}`,
    );
  });

  it("builds a kilo-sized ticket Flex card with peach top strip, white background, group name, payment rows and settle button", () => {
    const card = buildSettleCard(payments, group, "TWD", nameOf);
    const message = settleFlexMessage(card);

    expect(message.type).toBe("flex");
    if (message.type !== "flex") return;
    expect(message.altText).toBe("「週末台南小旅行」的結算通知");
    expect(message.contents).toMatchObject({
      type: "bubble",
      size: "kilo",
      styles: {
        header: { backgroundColor: "#FFE3CA" },
        body: { backgroundColor: "#FFFFFF" },
      },
      header: {
        type: "box",
        paddingAll: "3px",
        contents: [{ type: "filler" }],
      },
    });
    expect((message.contents as Record<string, unknown>).hero).toBeUndefined();

    const json = JSON.stringify(message.contents);
    // Group name without sprout emoji
    expect(json).toContain('"text":"週末台南小旅行"');
    expect(json).not.toContain('"text":"🌱 週末台南小旅行"');

    // Subtitle with count
    expect(json).toContain("還有 3 筆沒結清");

    // Flow arrows without 欠了
    expect(json).toContain("小宇 ➔ Gulu");
    expect(json).toContain("Yizhen ➔ ty");
    expect(json).toContain("Gulu ➔ ty");
    expect(json).not.toContain("欠了");

    // Amounts with dark ink color (#163D2A), no legacy brown (#A85520)
    expect(json).toContain('"text":"NT$ 430"');
    expect(json).toContain('"color":"#163D2A"');
    expect(json).not.toContain("#A85520");

    // Settle button with arrow
    expect(json).toContain('"text":"前往結算 ↗"');
    expect(json).not.toContain("前往結清款項");

    // No legacy hero image
    expect(json).not.toContain("/settle-hero.png");
    expect(json).not.toContain('"contents":[]');
  });

  it("formats plain text with the group name, prompt, rows and link", () => {
    const card = buildSettleCard(payments, group, "TWD", nameOf);
    expect(settleText(card)).toBe(
      [
        "週末台南小旅行",
        "還有 3 筆沒結清",
        "小宇 ➔ Gulu  NT$ 430",
        "Yizhen ➔ ty  NT$ 194",
        "Gulu ➔ ty  NT$ 99",
        `${window.location.origin}/groups/g-1?tab=settle`,
      ].join("\n"),
    );
  });
});

describe("settled flex card", () => {
  it("builds a kilo-sized minimal flex card with peach top strip, white background and no sprout emoji in title", () => {
    const card = buildSettledCard(
      {
        payer: "小宇",
        receiver: "Gulu",
        amount: 449325,
      },
      group,
      "TWD",
      "tok-1",
    );

    expect(card.groupName).toBe("週末台南小旅行");
    expect(card.payer).toBe("小宇");
    expect(card.receiver).toBe("Gulu");
    expect(card.amount).toBe("NT$ 449,325");
    expect(card.url).toBe(
      `${window.location.origin}/join/tok-1?next=${encodeURIComponent("/groups/g-1?tab=settle")}`,
    );

    const message = settledFlexMessage(card);
    expect(message.type).toBe("flex");
    if (message.type !== "flex") return;
    expect(message.altText).toContain("週末台南小旅行");
    expect(message.altText).toContain("小宇");
    expect(message.altText).toContain("Gulu");
    expect(message.altText).toContain("NT$ 449,325");

    expect(message.contents).toMatchObject({
      type: "bubble",
      size: "kilo",
      styles: {
        header: { backgroundColor: "#FFE3CA" },
        body: { backgroundColor: "#FFFFFF" },
      },
      header: {
        type: "box",
        paddingAll: "3px",
        contents: [{ type: "filler" }],
      },
    });

    const json = JSON.stringify(message.contents);
    // Group name without sprout emoji and no handshake badge
    expect(json).toContain('"text":"週末台南小旅行"');
    expect(json).not.toContain('"text":"🌱 週末台南小旅行"');
    expect(json).not.toContain('"text":"🤝"');

    // Payer and receiver flow row
    expect(json).toContain('"text":"小宇"');
    expect(json).toContain('"text":"➔"');
    expect(json).toContain('"text":"Gulu"');

    // Large amount and mint settled stamp chip
    expect(json).toContain('"text":"NT$ 449,325"');
    expect(json).toContain('"size":"xxl"');
    expect(json).toContain('"text":"已結清"');
    expect(json).toContain('"backgroundColor":"#E8F5EB"');

    // Bottom sprout green button
    expect(json).toContain('"text":"查看結算 ↗"');
    expect(json).not.toContain('"text":"✨ 查看結算 ↗"');
    expect(json).toContain('"backgroundColor":"#2E9D71"');

    // No legacy texts or image hero banners
    expect(json).not.toContain("幾人分");
    expect(json).not.toContain("每人多少");
    expect(json).not.toContain("settle-hero.png");
  });

  it("renders profile images when picture URLs are available and letter glyphs when not", () => {
    const withImages = buildSettledCard(
      {
        payer: "Alice",
        receiver: "Bob",
        amount: 500,
        payerPictureUrl: "https://example.com/alice.png",
        receiverPictureUrl: null,
      },
      group,
      "TWD",
    );
    const msg = settledFlexMessage(withImages);
    expect(msg.type).toBe("flex");
    if (msg.type !== "flex") return;
    const json = JSON.stringify(msg.contents);

    // Alice has image
    expect(json).toContain('"url":"https://example.com/alice.png"');
    // Bob has initial box
    expect(json).toContain('"text":"B"');
  });
});
