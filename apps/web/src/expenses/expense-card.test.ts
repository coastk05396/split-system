import type { Expense, Group } from "@split/shared";
import { describe, expect, it } from "vitest";
import { buildExpenseCard, expenseFlexMessage, expenseText } from "./expense-card.js";

const group = { id: "g-1", name: "東京小旅行" } as Group;
const names: Record<string, string> = { m1: "小宇", m2: "宜庭", m3: "阿哲", m4: "小美" };
const nameOf = (id: string) => names[id] ?? id;

function expense(patch: Partial<Expense> = {}): Expense {
  return {
    id: "e-1",
    groupId: "g-1",
    creatorMemberId: "m1",
    description: "火鍋",
    category: "餐飲",
    originalAmount: 2160,
    originalCurrency: "TWD",
    fxRateScaled: 1_000_000,
    fxDate: "2026-10-30",
    isCustomRate: false,
    settlementAmount: 2160,
    splitMethod: "equal",
    payers: [{ memberId: "m1", amountMinor: 2160, settlementAmount: 2160 }],
    splits: ["m1", "m2", "m3", "m4"].map((memberId) => ({
      memberId,
      shares: null,
      amountMinor: 540,
      settlementAmount: 540,
    })),
    expenseDate: "2026-10-30",
    expenseTime: null,
    stopId: null,
    createdAt: 0,
    updatedAt: 0,
    ...patch,
  };
}

describe("expense share card", () => {
  it("says the group, who paid, how it was split and what each person owes", () => {
    const card = buildExpenseCard(expense(), group, nameOf);

    expect(card).toMatchObject({
      groupName: "東京小旅行",
      title: "火鍋",
      emoji: "🍽️",
      amount: "NT$ 2,160",
      split: "4 人一起分",
      payer: "小宇先付",
      each: "每人約 NT$ 540",
      url: `${window.location.origin}/groups/g-1/expenses/e-1`,
    });
  });

  it("does not claim an equal share for the other split methods, and counts several payers", () => {
    const card = buildExpenseCard(
      expense({
        splitMethod: "shares",
        payers: [
          { memberId: "m1", amountMinor: 1000, settlementAmount: 1000 },
          { memberId: "m2", amountMinor: 1160, settlementAmount: 1160 },
        ],
      }),
      group,
      nameOf,
    );

    expect(card.each).toBeNull();
    expect(card.payer).toBe("2 人一起付");
    expect(card.split).toBe("按份數分");
  });

  it("falls back to the category when the Expense has no name", () => {
    expect(buildExpenseCard(expense({ description: " " }), group, nameOf).title).toBe("餐飲");
  });

  it("builds a Flex card with the group, name, amount, chip, payer and one view button", () => {
    const card = buildExpenseCard(expense(), group, nameOf);
    const message = expenseFlexMessage(card);

    expect(message.type).toBe("flex");
    if (message.type !== "flex") return;
    expect(message.altText).toBe("火鍋 NT$ 2,160");
    const json = JSON.stringify(message.contents);
    for (const text of [
      "東京小旅行",
      "火鍋 🍽️",
      "NT$ 2,160",
      "4 人一起分",
      "小宇先付",
      "每人約 NT$ 540",
      "查看這筆開銷 ↗",
    ]) {
      expect(json).toContain(text);
    }
    expect(json).toContain(`"uri":"${card.url}"`);
  });

  it("leaves out the headline and the tagline", () => {
    const json = JSON.stringify(expenseFlexMessage(buildExpenseCard(expense(), group, nameOf)));

    expect(json).not.toContain("記好");
    expect(json).not.toContain("大家一起分");
    expect(json).not.toContain("我剛剛");
  });

  it("falls back to plain text with the link for services that cannot show a card", () => {
    expect(expenseText(buildExpenseCard(expense(), group, nameOf))).toBe(
      `東京小旅行\n🍽️ 火鍋  NT$ 2,160\n小宇先付 · 4 人一起分 · 每人約 NT$ 540\n${window.location.origin}/groups/g-1/expenses/e-1`,
    );
  });
});
