import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { FlightFare, FlightSearchIntent } from "@split/shared";
import { createApp } from "../src/app.js";
import { productionDeps } from "../src/deps.js";
import { purgeExpired } from "../src/maintenance.js";
import type { LineMessage, LineReplyClient } from "../src/line/reply-client.js";
import { bearer, call, clock, signIn, uniqueSub } from "./auth-harness.js";

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
    extra?: Partial<FlightSearchIntent>;
    fares?: FlightFare[];
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
    push: () => Promise.reject(new Error("chat replies never push")),
  };
  const app = createApp({
    ...productionDeps,
    now: () => clock.now,
    lineReplyClient: () => client,
    flightSource: () => {
      if (options.sourceCalls) options.sourceCalls.count++;
      return options.failSource
        ? Promise.reject(new Error("blocked"))
        : Promise.resolve(options.fares ?? fares);
    },
    flightAI: {
      parsePrompt: (prompt) => {
        options.prompts?.push(prompt);
        return options.parseFails
          ? Promise.reject(new Error("no destination"))
          : Promise.resolve({
              ...intent,
              ...options.extra,
              destination: options.destination ?? intent.destination,
            });
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
    expect(badges.slice(0, 3).every((b) => b.includes("超值好價"))).toBe(true);
    expect(badges[3]).toContain("價格僅供參考");
    expect(JSON.stringify(bubbles)).not.toMatch(
      /非常值得買|可以買|再等等|強烈買|可買|觀望|Strong Buy/,
    );
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

  it.each([
    [
      "an unknown price level with no history or budget",
      "NRT",
      {},
      { priceLevel: "unknown" as const },
    ],
    ["a cheap fare over budget", "BKK", { budget: 1000 }, { priceLevel: "low" as const }],
  ])("makes no price-level claim on the badge for %s", async (_name, destination, extra, patch) => {
    // Its own destination and LINE user: fares are cached per route and chats are rate limited per user.
    const { post, sent } = harness({
      destination,
      extra,
      fares: [{ ...fares[0], ...patch } as FlightFare],
    });

    await post({
      ...text(`機票 ${destination}`),
      source: { type: "user", userId: `U-${destination}` },
    });

    const flex = sent[0]?.messages.at(-1);
    if (flex?.type !== "flex") throw new Error("expected a Flex message");
    const header = JSON.stringify(flex.contents.contents[0]?.header);
    expect(header).toContain("價格僅供參考");
    expect(header).not.toMatch(/偏高|偏貴|超值|合理|便宜|划算|非常值得買|可以買|再等等/);
  });

  it("adds a 降價叫醒我 postback beside 查看航班 on every flight bubble, keeping one height", async () => {
    const { post, sent } = harness();

    await post(text("機票 沖繩"));

    const flex = sent[0]?.messages.at(-1);
    if (flex?.type !== "flex") throw new Error("expected a Flex message");
    const footers = flex.contents.contents.map((b) =>
      b.footer.type === "box" ? b.footer.contents : [],
    );
    expect(new Set(footers.map((f) => f.length))).toEqual(new Set([2]));
    for (const footer of footers.slice(0, 4)) {
      expect(footer[0]).toMatchObject({ action: { type: "uri", label: "查看航班 ↗" } });
      const watch = footer[1];
      if (watch?.type !== "button" || watch.action.type !== "postback")
        throw new Error("expected a postback button");
      expect(watch.action.label).toBe("降價叫醒我");
      expect(watch.action.data).toMatch(/^action=watch&origin=TPE&destination=OKA&.*fare=\d+$/);
      expect(watch.action.data.length).toBeLessThanOrEqual(300);
    }
    expect(JSON.stringify(flex)).not.toContain("🌱");
  });

  it("carries infants on the card: link, watch postback and portal, with a note that the price excludes them", async () => {
    const { post, sent } = harness({ extra: { adults: 2, infants: 1 } });

    await post(text("機票 沖繩 2大1嬰"));

    const flex = sent[0]?.messages.at(-1);
    if (flex?.type !== "flex") throw new Error("expected a Flex message");
    const [first, ...rest] = flex.contents.contents;
    const json = JSON.stringify(first);
    expect(json).toContain("NT$ 7,000"); // never multiplied for the infant
    expect(json).toContain("不含嬰兒");
    expect(json).toContain("infants=1");
    const tfs = /tfs=([\w-]+)/.exec(json)?.[1] ?? "";
    const bytes = Array.from(atob(tfs.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
      c.charCodeAt(0),
    );
    expect(bytes.slice(-11)).toEqual([72, 1, 64, 1, 64, 1, 64, 4, 152, 1, 1]);
    expect(JSON.stringify(rest.at(-1))).toContain("infants=1");
    // A search without infants keeps its plain card.
    const plain = harness();
    await plain.post(text("機票 沖繩"));
    const plainFlex = plain.sent[0]?.messages.at(-1);
    expect(JSON.stringify(plainFlex)).not.toContain("不含嬰兒");
  });

  it("creates a line_push Price Watch in one tap for a linked sender, listed in /travel's watches", async () => {
    const { post, sent, loading } = harness();
    const sub = uniqueSub("U-linked");
    const user = await signIn("line", sub);
    await post({ ...text("機票 沖繩", "r-search"), source: { type: "user", userId: sub } });
    const flex = sent[0]?.messages.at(-1);
    if (flex?.type !== "flex") throw new Error("expected a Flex message");
    const footer = flex.contents.contents[0]?.footer;
    const button = footer?.type === "box" ? footer.contents[1] : undefined;
    if (button?.type !== "button" || button.action.type !== "postback")
      throw new Error("expected a postback button");

    await post({
      type: "postback",
      replyToken: "r-watch",
      source: { type: "user", userId: sub },
      postback: { data: button.action.data },
    });

    expect(sent.at(-1)?.replyToken).toBe("r-watch");
    expect(JSON.stringify(sent.at(-1)?.messages)).toContain("降價提醒");
    expect(JSON.stringify(sent.at(-1)?.messages)).not.toContain("🌱");
    expect(loading).toEqual([sub]);
    const listed = await call("/flights/watches", { headers: bearer(user.accessToken) });
    expect((await listed.json<{ watches: object[] }>()).watches).toMatchObject([
      {
        channel: "line_push",
        status: "active",
        baselineFare: 7000,
        targetFare: 5950,
        intent: { origin: "TPE", destination: "OKA" },
      },
    ]);
  });

  it("keeps at most 2 active line_push watches per User", async () => {
    const { post, sent } = harness();
    const sub = uniqueSub("U-capped");
    const user = await signIn("line", sub);
    const tap = (destination: string, n: number) =>
      post({
        type: "postback",
        replyToken: `r-cap-${n}`,
        source: { type: "user", userId: sub },
        postback: {
          data: `action=watch&origin=TPE&destination=${destination}&departureDate=2026-12-04&returnDate=2026-12-07&currency=TWD&excludeRedEye=0&directOnly=0&fare=7000`,
        },
      });

    await tap("OKA", 1);
    await tap("NRT", 2);
    await tap("ICN", 3);

    expect(JSON.stringify(sent.at(-1)?.messages)).toContain("最多同時 2 個");
    const rows = await env.DB.prepare(
      "SELECT channel FROM flight_price_watches WHERE user_id=? AND status='active'",
    )
      .bind(user.userId)
      .all<{ channel: string }>();
    expect(rows.results).toEqual([{ channel: "line_push" }, { channel: "line_push" }]);
  });

  it("routes an unlinked sender through LIFF /travel with the pending watch, creating nothing", async () => {
    const { post, sent } = harness();
    const sub = uniqueSub("U-never-signed-in");

    await post({
      type: "postback",
      replyToken: "r-unlinked",
      source: { type: "user", userId: sub },
      postback: {
        data: "action=watch&origin=TPE&destination=OKA&departureDate=2026-12-04&returnDate=2026-12-07&currency=TWD&excludeRedEye=0&directOnly=0&fare=7000",
      },
    });

    const reply = JSON.stringify(sent.at(-1)?.messages);
    expect(reply).toContain("https://split.test/travel?origin=TPE&destination=OKA");
    expect(reply).toContain("watch=line&fare=7000");
    expect(reply).not.toContain("🌱");
    expect(reply).not.toContain(sub);
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM identities WHERE provider_sub=?")
      .bind(sub)
      .first<{ n: number }>();
    expect(count?.n).toBe(0);
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

  it.each([
    "東京 晚餐 2160",
    "旅行 住宿 3000",
    "Seoul dinner 800",
    "trip dinner 500",
    "東京 晚餐",
    "東京 玩 門票 1200",
    "東京 計程車 去機場 1200",
    "東京 住宿 去年 3000",
    "晚餐 2160，四人均分",
  ])("keeps the menu pointer for expense-like text %j", async (message) => {
    const calls = { count: 0 };
    const prompts: string[] = [];
    const { post, sent, loading } = harness({ sourceCalls: calls, prompts });

    await post({ ...text(message), source: { type: "user", userId: uniqueSub("U-spender") } });

    expect(sent.map((s) => s.messages)).toEqual([
      [{ type: "text", text: "點下方選單就能記帳 🌱" }],
    ]);
    expect(loading).toEqual([]);
    expect(prompts).toEqual([]);
    expect(calls.count).toBe(0);
  });

  it.each([
    "機票 預算 15000",
    "東京 機票 3000",
    "flight to Seoul 800",
    "想去東京",
    "go to Seoul",
    "下個月去沖繩 NT$ 15000",
    "去沖繩 15000 以內",
    "12月4號 2026 去沖繩",
    "下個月去沖繩 15000",
    "兩個人去東京 5000內",
    "to Seoul on Dec 24 2026",
  ])("still runs a flight search for %j", async (message) => {
    const prompts: string[] = [];
    const { post, loading } = harness({ prompts });

    const userId = uniqueSub("U-gate");
    await post({ ...text(message), source: { type: "user", userId } });

    expect(loading).toEqual([userId]);
    expect(prompts).toEqual([message]);
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
