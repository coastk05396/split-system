import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { createFakeApi, makeUser } from "../../test/fake-api.js";
import { createFakeSignIn } from "../../test/fake-sign-in.js";
import { createApiClient } from "../api/client.js";
import { createSession } from "../auth/session.js";
import type { RenderAppOptions } from "../../test/render-app.js";
import type { LineMessage } from "./line.js";
import { createLineShare } from "./line-share.js";

const content = {
  text: "hello https://example.com/join/token",
  lineMessages: [{ type: "text", text: "a card" }] satisfies LineMessage[],
};

async function setup(options: RenderAppOptions = {}) {
  const api = createFakeApi();
  const me = makeUser("小宇");
  api.setCookieUser(me);
  const session = createSession({ fetch: api.fetch });
  await session.restore();
  const groupId = api.groups.add(me, { name: "台南" });
  const { line, lineShareMessages, lineChatMessages } = createFakeSignIn(options);
  const client = new QueryClient();
  const assign = vi.fn();
  const ports = { line, api: createApiClient(session.fetch), client, location: { assign } };
  return {
    sharing: createLineShare(ports),
    ports,
    api,
    groupId,
    line,
    assign,
    lineShareMessages,
    lineChatMessages,
  };
}

describe("LINE sharing", () => {
  const modes = ["succeeds", "cancelled", "unavailable", "fails"] as const;
  const purposes = ["invite", "settlement", "expense"] as const;
  it.each(
    modes.flatMap((mode) =>
      purposes.flatMap((purpose) => [false, true].map((card) => ({ mode, purpose, card }))),
    ),
  )("$purpose, card=$card, picker=$mode", async ({ mode, purpose, card }) => {
    const { sharing, line, assign } = await setup(mode === "succeeds" ? {} : { linePicker: mode });
    const sendText = vi.spyOn(line, "share");
    const sendCard = vi.spyOn(line, "shareMessages");
    const message = card ? content : { text: content.text };
    if (mode === "fails")
      await expect(sharing.share(message, purpose)).rejects.toThrow("picker failed");
    else await expect(sharing.share(message, purpose)).resolves.toBe(mode === "succeeds");
    if (card)
      expect(sendCard).toHaveBeenCalledExactlyOnceWith(content.lineMessages, {
        stayOpen: purpose !== "expense",
      });
    else
      expect(sendText).toHaveBeenCalledExactlyOnceWith(content.text, {
        stayOpen: purpose !== "expense",
      });
    if (mode === "unavailable")
      expect(assign).toHaveBeenCalledExactlyOnceWith(
        "https://line.me/R/share?text=hello%20https%3A%2F%2Fexample.com%2Fjoin%2Ftoken",
      );
    else expect(assign).not.toHaveBeenCalled();
  });
  it("shares one in-flight Invite request across callers", async () => {
    const { sharing, ports, api, groupId } = await setup();
    const route = `POST /api/v1/groups/${groupId}/invite/ensure`;
    const release = api.holdResponses(route);
    const first = sharing.inviteToken(groupId);
    const second = createLineShare(ports).inviteToken(groupId);
    await vi.waitFor(() => {
      expect(api.calls.filter((call) => call === route)).toHaveLength(1);
    });
    release();
    const [one, two] = await Promise.all([first, second]);
    expect(one).toMatch(/^token-/);
    expect(two).toBe(one);
  });

  it("keeps chat-post failures visible to the caller", async () => {
    const { sharing } = await setup({ lineChatFails: true });
    await expect(sharing.post(content.lineMessages)).rejects.toThrow("chat send failed");
  });
  it("posts a card to the current chat", async () => {
    const { sharing, lineChatMessages, assign } = await setup({ lineChat: true });
    await sharing.post(content.lineMessages);
    expect(lineChatMessages).toEqual(content.lineMessages);
    expect(assign).not.toHaveBeenCalled();
  });

  it.each([false, true])("reports whether posting is possible: %s", async (available) => {
    const { sharing } = await setup({ lineChat: available });
    await expect(sharing.canPost()).resolves.toBe(available);
  });

  it("reuses the warm Expense Invite, but refreshes it for a Settlement", async () => {
    const { sharing, api, groupId } = await setup();
    const route = `POST /api/v1/groups/${groupId}/invite/ensure`;
    const token = await sharing.inviteToken(groupId, { cached: true });
    expect(await sharing.inviteToken(groupId, { cached: true })).toBe(token);
    expect(api.calls.filter((call) => call === route)).toHaveLength(1);
    expect(await sharing.inviteToken(groupId)).toBe(token);
    expect(api.calls.filter((call) => call === route)).toHaveLength(2);
  });

  it.each(["http", "network"])(
    "tolerates an Invite %s failure and tries again next time",
    async (failure) => {
      const { sharing, api, groupId } = await setup();
      const route = `POST /api/v1/groups/${groupId}/invite/ensure`;
      if (failure === "http") api.failNext(route);
      else api.dropNextResponse(route);
      await expect(sharing.inviteToken(groupId)).resolves.toBeNull();
      await expect(sharing.inviteToken(groupId)).resolves.toMatch(/^token-/);
      expect(api.calls.filter((call) => call === route)).toHaveLength(2);
    },
  );

  it("does not mix the Invite tokens of different Groups", async () => {
    const { sharing, api, groupId } = await setup();
    const other = api.groups.add(makeUser("小宇"), { name: "台北" });
    const tokens = await Promise.all([sharing.inviteToken(groupId), sharing.inviteToken(other)]);
    expect(tokens[0]).toMatch(/^token-/);
    expect(tokens[1]).toMatch(/^token-/);
    expect(tokens[0]).not.toBe(tokens[1]);
  });
});
