import { describe, expect, it } from "vitest";
import { inviteFlexMessage } from "./invite-card.js";

describe("inviteFlexMessage", () => {
  it("names the Group and opens the invitation from one button", () => {
    const message = inviteFlexMessage({
      groupName: "台南",
      url: "https://liff.line.me/1-a/join/t",
    });
    const json = JSON.stringify(message);

    expect(message).toMatchObject({ type: "flex", altText: "邀請你加入「台南」一起分帳" });
    expect(json).toContain('"text":"台南"');
    expect(json).toContain('"uri":"https://liff.line.me/1-a/join/t"');
  });
});
