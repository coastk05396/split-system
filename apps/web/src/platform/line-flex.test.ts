import { describe, expect, it } from "vitest";
import { COLOR, flexBubbleFrame, groupJoinLink, groupJoinUrl } from "./line-flex.js";

describe("groupJoinLink", () => {
  it("routes through /join/:token with an encoded next path when an Invite token is present", () => {
    expect(groupJoinLink("g-1", "tok-abc", "/groups/g-1/expenses/e-1")).toBe(
      `${window.location.origin}/join/tok-abc?next=${encodeURIComponent("/groups/g-1/expenses/e-1")}`,
    );
  });

  it("omits the next query parameter when joining the Group root directly", () => {
    expect(groupJoinLink("g-1", "tok-abc")).toBe(`${window.location.origin}/join/tok-abc`);
  });

  it("falls back to nextPath or the Group path when no Invite token is available", () => {
    expect(groupJoinLink("g-1", null, "/groups/g-1?tab=settle")).toBe(
      `${window.location.origin}/groups/g-1?tab=settle`,
    );
    expect(groupJoinLink("g-1", "")).toBe(`${window.location.origin}/groups/g-1`);
    expect(groupJoinUrl("g-1", undefined)).toBe(`${window.location.origin}/groups/g-1`);
  });
});

describe("flexBubbleFrame", () => {
  it("wraps body contents in a kilo bubble with a peach strip and a sprout URI button", () => {
    const message = flexBubbleFrame({
      altText: "測試卡片",
      contents: [{ type: "text", text: "東京小旅行", color: COLOR.ink }],
      actionLabel: "查看明細",
      actionUri: "https://split.example/groups/g-1",
    });

    expect(message).toEqual({
      type: "flex",
      altText: "測試卡片",
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
            { type: "text", text: "東京小旅行", color: COLOR.ink },
            {
              type: "box",
              layout: "horizontal",
              cornerRadius: "18px",
              backgroundColor: COLOR.sprout,
              paddingAll: "14px",
              action: {
                type: "uri",
                label: "查看明細 ↗",
                uri: "https://split.example/groups/g-1",
              },
              contents: [
                {
                  type: "text",
                  text: "查看明細 ↗",
                  color: COLOR.white,
                  weight: "bold",
                  align: "center",
                },
              ],
            },
          ],
        },
      },
    });
  });
});
