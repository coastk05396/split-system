import { describe, expect, it } from "vitest";
import { HELP_POSTBACK_DATA } from "../src/line/events.js";
import { richMenu } from "../src/line/rich-menu.js";

describe("the default Rich Menu (decision 14)", () => {
  const menu = richMenu("1234567890-abcdefgh");

  it("has the six buttons of screen 16 under the 小芽快捷選單 chat bar", () => {
    expect(menu.chatBarText).toBe("小芽快捷選單");
    expect(menu.areas.map((area) => area.action.label)).toEqual([
      "快速分帳",
      "我的旅程",
      "記一筆",
      "查看結算",
      "邀請夥伴",
      "使用幫助",
    ]);
  });

  it("tiles the menu image without overlap or gaps", () => {
    const covered = menu.areas.reduce((sum, { bounds }) => sum + bounds.width * bounds.height, 0);
    expect(covered).toBe(menu.size.width * menu.size.height);
    for (const { bounds } of menu.areas) {
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(menu.size.width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(menu.size.height);
    }
  });

  it("links five buttons into the LIFF app and sends 使用幫助 as the help postback", () => {
    const [quick, trip, add, settle, invite, help] = menu.areas.map((area) => area.action);
    for (const action of [quick, trip, add, settle, invite]) {
      expect(action?.type).toBe("uri");
      expect(action?.type === "uri" ? action.uri : "").toMatch(
        /^https:\/\/liff\.line\.me\/1234567890-abcdefgh\//,
      );
    }
    expect(add?.type === "uri" ? add.uri : "").toBe("https://liff.line.me/1234567890-abcdefgh/new");
    expect(help).toEqual({
      type: "postback",
      label: "使用幫助",
      data: HELP_POSTBACK_DATA,
      displayText: "使用幫助",
    });
  });
});
