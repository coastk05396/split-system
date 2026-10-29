import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { LineMessage, LineReplyClient } from "../src/line/reply-client.js";
import { clock, fakeVerifier } from "./auth-harness.js";

/** A fresh channel secret per run; the real one is a Worker secret. */
const secret = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
  b.toString(16).padStart(2, "0"),
).join("");

interface Sent {
  replyToken: string;
  messages: LineMessage[];
}

function harness(options: { failReplies?: boolean } = {}) {
  const sent: Sent[] = [];
  const pending: Promise<unknown>[] = [];
  const replyClient: LineReplyClient = {
    reply(replyToken, messages) {
      if (options.failReplies === true) return Promise.reject(new Error("LINE is down"));
      sent.push({ replyToken, messages });
      return Promise.resolve();
    },
  };
  const app = createApp({
    verifier: () => fakeVerifier,
    now: () => clock.now,
    lineReplyClient: () => replyClient,
  });
  const ctx = {
    waitUntil(promise: Promise<unknown>) {
      pending.push(promise);
    },
    passThroughOnException() {
      /* not used */
    },
    props: {},
  } as unknown as ExecutionContext;

  async function post(
    body: string,
    signature: string | null,
    bindings: { LINE_CHANNEL_SECRET?: string | undefined } = { LINE_CHANNEL_SECRET: secret },
  ) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (signature !== null) headers["X-Line-Signature"] = signature;
    const res = await app.request(
      "https://split.test/api/v1/line/webhook",
      { method: "POST", headers, body },
      { ...env, ...bindings },
      ctx,
    );
    await Promise.all(pending);
    return res;
  }

  return { post, sent };
}

async function sign(body: string, key = secret): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(body));
  return btoa(String.fromCharCode(...new Uint8Array(mac)));
}

function webhookBody(...events: object[]): string {
  return JSON.stringify({ destination: "Ubot", events });
}

const source = { type: "user", userId: "U-someone" };

describe("POST /line/webhook", () => {
  it("refuses a body signed with another secret", async () => {
    const { post, sent } = harness();
    const body = webhookBody({ type: "follow", replyToken: "r-1", source });

    const res = await post(body, await sign(body, "not-the-channel-secret"));

    expect(res.status).toBe(401);
    expect(sent).toEqual([]);
  });

  it("refuses a request with no signature, or when no channel secret is configured", async () => {
    const { post, sent } = harness();
    const body = webhookBody({ type: "follow", replyToken: "r-1", source });

    expect((await post(body, null)).status).toBe(401);
    expect((await post(body, await sign(body), { LINE_CHANNEL_SECRET: undefined })).status).toBe(
      401,
    );
    expect(sent).toEqual([]);
  });

  it("welcomes someone who adds the account and points them at the menu", async () => {
    const { post, sent } = harness();
    const body = webhookBody({ type: "follow", replyToken: "r-follow", source });

    const res = await post(body, await sign(body));

    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.replyToken).toBe("r-follow");
    const text = sent[0]?.messages.map((m) => m.text).join("\n") ?? "";
    expect(text).toContain("小芽分帳");
    expect(text).toContain("選單");
    // Decision 14: the welcome no longer suggests typing an Expense sentence.
    expect(text).not.toContain("四人均分");
  });

  it("answers free text with the one-line menu pointer, without parsing it", async () => {
    const { post, sent } = harness();
    const body = webhookBody({
      type: "message",
      replyToken: "r-text",
      source,
      message: { type: "text", id: "m-1", text: "晚餐 2160，四人均分" },
    });

    await post(body, await sign(body));

    expect(sent).toEqual([
      { replyToken: "r-text", messages: [{ type: "text", text: "點下方選單就能記帳 🌱" }] },
    ]);
  });

  it("sends the help text for the menu's 使用幫助 postback", async () => {
    const { post, sent } = harness();
    const body = webhookBody({
      type: "postback",
      replyToken: "r-help",
      source,
      postback: { data: "action=help" },
    });

    await post(body, await sign(body));

    expect(sent).toHaveLength(1);
    expect(sent[0]?.messages[0]?.text).toContain("使用幫助");
    expect(sent[0]?.messages[0]?.text).toContain("記一筆");
  });

  it("ignores every other event, including unfollow and unknown postbacks", async () => {
    const { post, sent } = harness();
    const body = webhookBody(
      { type: "unfollow", source },
      { type: "join", replyToken: "r-join", source: { type: "group", groupId: "C-1" } },
      { type: "postback", replyToken: "r-other", source, postback: { data: "action=other" } },
    );

    const res = await post(body, await sign(body));

    expect(res.status).toBe(200);
    expect(sent).toEqual([]);
  });

  it("answers LINE's empty verification request with 200", async () => {
    const { post, sent } = harness();
    const body = webhookBody();

    expect((await post(body, await sign(body))).status).toBe(200);
    expect(sent).toEqual([]);
  });

  it("still answers 200 when a reply fails, and does not retry", async () => {
    const { post } = harness({ failReplies: true });
    const body = webhookBody({ type: "follow", replyToken: "r-1", source });

    expect((await post(body, await sign(body))).status).toBe(200);
  });

  it("rejects a signed body that is not a webhook payload", async () => {
    const { post, sent } = harness();
    const body = "not json";

    expect((await post(body, await sign(body))).status).toBe(400);
    expect(sent).toEqual([]);
  });
});
