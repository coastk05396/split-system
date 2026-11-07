import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { FlightFare, FlightSearchIntent } from "@split/shared";
import { createApp } from "../src/app.js";
import { productionDeps } from "../src/deps.js";
import { purgeExpired } from "../src/maintenance.js";
import type { LineMessage, LineReplyClient } from "../src/line/reply-client.js";
import { clock } from "./auth-harness.js";

const secret = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
  b.toString(16).padStart(2, "0"),
).join("");

const intent: FlightSearchIntent = {
  origin: "TPE",
  destination: "OKA",
  departureDate: "2026-12-04",
  returnDate: "2026-12-07",
  currency: "TWD",
  excludeRedEye: false,
  directOnly: false,
};

/** Two fares per route-date: a cheap `low` one and a pricey `high` one. */
const fares: FlightFare[] = [
  {
    price: 7000,
    airline: "Test Air",
    outboundDeparture: "08:00",
    outboundArrival: "10:00",
    inboundDeparture: "18:00",
    inboundArrival: "20:00",
    stops: 0,
    durationMinutes: 120,
    priceLevel: "low",
  },
  {
    price: 12000,
    airline: "Slow Air",
    outboundDeparture: "09:00",
    outboundArrival: "15:00",
    inboundDeparture: null,
    inboundArrival: null,
    stops: 1,
    durationMinutes: 360,
    priceLevel: "high",
  },
];

interface Sent {
  replyToken: string;
  messages: LineMessage[];
}

function harness(
  options: {
    prompts?: string[];
    sourceCalls?: { count: number };
    failSource?: boolean;
    parseFails?: boolean;
    destination?: string;
  } = {},
) {
  const sent: Sent[] = [];
  const loading: string[] = [];
  const pending: Promise<unknown>[] = [];
  const client: LineReplyClient = {
    reply(replyToken, messages) {
      sent.push({ replyToken, messages });
      return Promise.resolve();
    },
    startLoading(userId) {
      loading.push(userId);
      return Promise.resolve();
    },
  };
  const app = createApp({
    ...productionDeps,
    now: () => clock.now,
    lineReplyClient: () => client,
    flightSource: () => {
      if (options.sourceCalls) options.sourceCalls.count++;
      return options.failSource ? Promise.reject(new Error("blocked")) : Promise.resolve(fares);
    },
    flightAI: {
      parsePrompt: (prompt) => {
        options.prompts?.push(prompt);
        return options.parseFails
          ? Promise.reject(new Error("no destination"))
          : Promise.resolve({ ...intent, destination: options.destination ?? intent.destination });
      },
    },
    flightAdvisor: { select: () => Promise.resolve(null) },
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

  async function post(...events: object[]) {
    return postSigned(secret, ...events);
  }
  async function postSigned(signingSecret: string, ...events: object[]) {
    const body = JSON.stringify({ destination: "Ubot", events });
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(signingSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
    const res = await app.request(
      "https://split.test/api/v1/line/webhook",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Line-Signature": btoa(String.fromCharCode(...new Uint8Array(mac))),
        },
        body,
      },
      { ...env, LINE_CHANNEL_SECRET: secret },
      ctx,
    );
    await Promise.all(pending);
    return res;
  }
  return { post, postSigned, sent, loading };
}

const source = { type: "user", userId: "U-flyer" };
const text = (message: string, replyToken = "r-text") => ({
  type: "message",
  replyToken,
  source,
  message: { type: "text", id: "m-1", text: message },
});

describe("one-on-one LINE flight chat", () => {
  it("shows the loading indicator and replies with a kilo Flex Carousel and Quick Reply chips", async () => {
    const { post, sent, loading } = harness();

    const res = await post(text("下個月週末去沖繩"));

    expect(res.status).toBe(200);
    expect(loading).toEqual(["U-flyer"]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.replyToken).toBe("r-text");
    const flex = sent[0]?.messages.at(-1);
    expect(flex?.type).toBe("flex");
    if (flex?.type !== "flex") return;
    expect(flex.contents.type).toBe("carousel");
    expect(flex.contents.contents.length).toBeLessThanOrEqual(5);
    expect(flex.quickReply?.items.length).toBeGreaterThanOrEqual(3);
    expect(flex.quickReply?.items.length).toBeLessThanOrEqual(4);
  });

  it("keeps the carousel to 4 flights plus a portal, best Deal Signal first, with no sprout", async () => {
    const { post, sent } = harness();

    await post(text("機票 沖繩"));

    const flex = sent[0]?.messages.at(-1);
    if (flex?.type !== "flex") throw new Error("expected a Flex message");
    const bubbles = flex.contents.contents;
    expect(bubbles).toHaveLength(5);
    expect(bubbles.map((b) => b.size)).toEqual(Array<string>(5).fill("kilo"));
    // 6 fares in, 3 Strong Buy (NT$ 7,000) then the cheapest Hold (NT$ 12,000).
    const badges = bubbles.slice(0, 4).map((b) => JSON.stringify(b.header));
    expect(badges.slice(0, 3).every((b) => b.includes("非常值得買"))).toBe(true);
    expect(badges[3]).toContain("再等等");
    expect(JSON.stringify(bubbles[0])).toContain("NT$ 7,000");
    // Every bubble has the same rows, so the cards share one height.
    const rows = (b: (typeof bubbles)[number]) =>
      b.body.type === "box" ? b.body.contents.length : 0;
    expect(new Set(bubbles.map(rows)).size).toBe(1);
    expect(JSON.stringify(flex)).not.toContain("🌱");
    const portal = JSON.stringify(bubbles[4]);
    expect(portal).toContain("https://split.test/travel?origin=TPE&destination=OKA");
    expect(portal).toContain("departureDate=2026-12-04");
    expect(JSON.stringify(bubbles[0])).toContain(
      "https://www.google.com/travel/flights/search?tfs=",
    );
  });

  it("pivots the search from a Quick Reply chip without parsing a prompt", async () => {
    const prompts: string[] = [];
    const { post, sent, loading } = harness({ prompts });
    await post(text("去沖繩"));
    const first = sent[0]?.messages.at(-1);
    if (first?.type !== "flex") throw new Error("expected a Flex message");
    const chip = first.quickReply?.items.find((i) => i.action.data.includes("directOnly=1"));
    expect(chip).toBeDefined();
    expect(chip?.action.data.length).toBeLessThanOrEqual(300);
    expect(chip?.action.label.length).toBeLessThanOrEqual(20);

    await post({
      type: "postback",
      replyToken: "r-chip",
      source,
      postback: { data: chip?.action.data },
    });

    expect(prompts).toEqual(["去沖繩"]);
    expect(loading).toEqual(["U-flyer", "U-flyer"]);
    expect(sent[1]?.replyToken).toBe("r-chip");
    const next = sent[1]?.messages.at(-1);
    if (next?.type !== "flex") throw new Error("expected a Flex message");
    expect(next.contents.contents.at(-1)).toBeDefined();
    expect(JSON.stringify(next.contents.contents.at(-1))).toContain("directOnly=1");
    expect(next.quickReply?.items.length).toBeGreaterThanOrEqual(3);
  });

  it("ignores a chip postback whose search is malformed", async () => {
    const { post, sent, loading } = harness();

    await post({
      type: "postback",
      replyToken: "r-bad",
      source,
      postback: { data: "action=flight&destination=nowhere" },
    });

    expect(sent).toEqual([]);
    expect(loading).toEqual([]);
  });

  it("limits each sender to 10 searches a minute, counting them under a hashed key", async () => {
    const calls = { count: 0 };
    const { post, sent } = harness({ sourceCalls: calls });
    const stranger = { type: "user", userId: "U-never-opened-liff-rate" };
    const ask = (n: number) => ({ ...text("去沖繩", `r-${n}`), source: stranger });

    for (let n = 0; n < 10; n++) await post(ask(n));
    const searched = calls.count;
    await post(ask(10));

    expect(calls.count).toBe(searched);
    expect(sent.at(-1)).toEqual({
      replyToken: "r-10",
      messages: [{ type: "text", text: "查詢太頻繁了，請稍等一下再試" }],
    });
    const keys = await env.DB.prepare(
      "SELECT sender_key FROM line_sender_counters WHERE route_group='flights_minute'",
    ).all<{ sender_key: string }>();
    expect(keys.results.length).toBeGreaterThan(0);
    for (const { sender_key } of keys.results) {
      expect(sender_key).toMatch(/^line:[0-9a-f]{64}$/);
      expect(sender_key).not.toContain("U-never-opened-liff-rate");
    }
  });

  it("answers non-flight text with the menu pointer and runs no search", async () => {
    const calls = { count: 0 };
    const { post, sent, loading } = harness({ sourceCalls: calls });

    await post(text("晚餐 2160，四人均分"), text("哈囉", "r-hi"));

    expect(sent.map((s) => s.messages)).toEqual([
      [{ type: "text", text: "點下方選單就能記帳 🌱" }],
      [{ type: "text", text: "點下方選單就能記帳 🌱" }],
    ]);
    expect(loading).toEqual([]);
    expect(calls.count).toBe(0);
  });

  it("ignores group and room events, flight questions included", async () => {
    const { post, sent, loading } = harness();
    const group = { type: "group", groupId: "C-1", userId: "U-flyer" };
    const room = { type: "room", roomId: "R-1", userId: "U-flyer" };

    await post(
      { ...text("機票 沖繩", "r-g"), source: group },
      { ...text("晚餐 100", "r-r"), source: room },
      { type: "postback", replyToken: "r-p", source: group, postback: { data: "action=help" } },
    );

    expect(sent).toEqual([]);
    expect(loading).toEqual([]);
  });

  it("falls back to a Google Flights link when the source is blocked, and to a hint when the prompt is not understood", async () => {
    const blocked = harness({ failSource: true, destination: "KIX" });
    await blocked.post(text("去沖繩"));
    const reply = blocked.sent[0]?.messages[0];
    expect(reply?.type === "text" ? reply.text : "").toContain(
      "https://www.google.com/travel/flights/search?tfs=",
    );

    const confused = harness({ parseFails: true });
    await confused.post(text("想訂機票"));
    expect(confused.sent[0]?.messages[0]).toMatchObject({ type: "text" });
    expect(JSON.stringify(confused.sent[0]?.messages)).toContain("下個月週末去沖繩");
  });

  it("does nothing for a flight question signed with another secret", async () => {
    const { postSigned, sent, loading } = harness();

    const res = await postSigned("not-the-channel-secret", text("機票 沖繩"));

    expect(res.status).toBe(401);
    expect(sent).toEqual([]);
    expect(loading).toEqual([]);
  });

  it("purges sender counters older than an hour in the daily run", async () => {
    const now = clock.now;
    await env.DB.prepare(
      "INSERT INTO line_sender_counters(sender_key,route_group,window_start,count) VALUES('line:old','flights_minute',?,1),('line:new','flights_minute',?,1)",
    )
      .bind(now - 2 * 3_600_000, now)
      .run();

    await purgeExpired(env, now);

    const left = await env.DB.prepare(
      "SELECT sender_key FROM line_sender_counters WHERE sender_key IN ('line:old','line:new')",
    ).all<{ sender_key: string }>();
    expect(left.results.map((r) => r.sender_key)).toEqual(["line:new"]);
  });
});
