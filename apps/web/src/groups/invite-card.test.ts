import { describe, expect, it } from "vitest";
import { buildInviteCard, inviteFlexMessage, inviteShareContent } from "./invite-card.js";

describe("inviteFlexMessage", () => {
  it("builds a Japanese envelope-style Flex card with envelope tag, lifestyle copy and join button", () => {
    const message = inviteFlexMessage({
      groupName: "台南小旅行",
      url: "https://liff.line.me/1-a/join/t",
    });
    const json = JSON.stringify(message);

    expect(message).toMatchObject({
      type: "flex",
      altText: "邀請你加入「台南小旅行」一起分帳",
      contents: {
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
      },
    });

    // Envelope badge tag in mint pill
    expect(json).toContain('"text":"💌 收到一份分帳邀請"');
    expect(json).toContain('"backgroundColor":"#E8F5EB"');

    // Group name
    expect(json).toContain('"text":"台南小旅行"');

    // Lifestyle description
    expect(json).toContain('"text":"這趟的花費大家一起記，回家前就能算清"');

    // Join button with arrow
    expect(json).toContain('"text":"加入群組 ↗"');
    expect(json).toContain('"uri":"https://liff.line.me/1-a/join/t"');

    // No sprout emoji box
    expect(json).not.toContain('"text":"🌱"');
    // No legacy robotic corporate copy
    expect(json).not.toContain("大家的開銷與結算都在同一個地方");
  });

  it("builds one-step ShareContent for an Invite from the Group and Invite token", () => {
    const card = buildInviteCard({ id: "g-1", name: "台南小旅行" }, "tok-1");
    expect(card.url).toBe(`${window.location.origin}/join/tok-1`);

    const content = inviteShareContent({ id: "g-1", name: "台南小旅行" }, "tok-1");
    expect(content).toMatchObject({
      url: `${window.location.origin}/join/tok-1`,
      title: "台南小旅行",
      text: `一起用小芽分帳記「台南小旅行」的開銷吧！${window.location.origin}/join/tok-1`,
      telegramText: "一起用小芽分帳記「台南小旅行」的開銷吧！",
      copyText: `一起用小芽分帳記「台南小旅行」的開銷吧！${window.location.origin}/join/tok-1`,
      copyLabel: "複製邀請連結",
      copiedNotice: "已複製邀請連結",
    });
    expect(content.lineMessages).toHaveLength(1);
    expect(content.lineMessages[0]).toMatchObject({
      type: "flex",
      altText: "邀請你加入「台南小旅行」一起分帳",
    });
  });
});
