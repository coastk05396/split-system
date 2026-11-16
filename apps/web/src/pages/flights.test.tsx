import type { DailyFlightItem } from "@split/shared";
import { screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { makeUser } from "../../test/fake-api.js";
import { renderApp } from "../../test/render-app.js";

function fare(
  id: string,
  over: Partial<DailyFlightItem> & Pick<DailyFlightItem, "dest" | "priceTwd">,
): DailyFlightItem {
  return {
    id,
    origin: "TPE",
    region: "jp",
    tripType: "rt",
    outDate: "2026-12-10",
    inDate: "2026-12-14",
    discountPct: 0,
    tag: "normal",
    airlines: ["CI"],
    transfers: 0,
    returnTransfers: 0,
    isRedEye: false,
    outboundDep: "10:00",
    inboundDep: "15:00",
    ...over,
  };
}

/** Round trips: Tokyo has 4 fares over two airports (cheapest is a red-eye steal at NRT), KIX 1, ICN 1; one-ways: ICN, BKK. */
const SAMPLE_FLIGHTS: DailyFlightItem[] = [
  fare("nrt-b", {
    dest: "NRT",
    priceTwd: 7200,
    outDate: "2027-01-12",
    inDate: "2027-01-16",
  }),
  fare("nrt-a", {
    dest: "NRT",
    priceTwd: 5680,
    discountPct: 45,
    tag: "steal",
    airlines: ["MM"],
    isRedEye: true,
    outboundDep: "02:15",
  }),
  fare("nrt-c", {
    dest: "NRT",
    origin: "KHH",
    priceTwd: 6900,
    discountPct: 18,
    tag: "below_market",
    airlines: ["IT"],
    transfers: 1,
    outDate: "2027-02-03",
    inDate: "2027-02-07",
  }),
  fare("hnd-a", {
    dest: "HND",
    origin: "TSA",
    priceTwd: 6200,
    outDate: "2027-03-05",
    inDate: "2027-03-09",
  }),
  fare("kix-a", {
    dest: "KIX",
    origin: "KHH",
    priceTwd: 8900,
    discountPct: 21,
    tag: "below_market",
    airlines: ["IT"],
    outDate: "2027-02-26",
    inDate: "2027-03-02",
  }),
  fare("icn-rt", {
    dest: "ICN",
    region: "kr",
    priceTwd: 6100,
    airlines: ["KE"],
    outDate: "2026-12-20",
    inDate: "2026-12-24",
  }),
  fare("icn-ow", {
    dest: "ICN",
    region: "kr",
    tripType: "ow",
    priceTwd: 4100,
    discountPct: 21,
    tag: "below_market",
    airlines: ["KE"],
    transfers: 1,
    returnTransfers: null,
    outDate: "2026-12-18",
    inDate: null,
  }),
  fare("bkk-ow", {
    dest: "BKK",
    region: "sea",
    tripType: "ow",
    priceTwd: 2500,
    discountPct: 40,
    tag: "steal",
    airlines: ["FD"],
    returnTransfers: null,
    outDate: "2026-12-22",
    inDate: null,
  }),
];

function setup(path = "/flights", cookieUser?: ReturnType<typeof makeUser>) {
  const view = renderApp(cookieUser ? { path, cookieUser } : { path });
  view.api.dailyFlights = {
    date: "2026-11-16",
    updatedAt: "2026-11-16T01:00:00.000Z",
    items: SAMPLE_FLIGHTS,
    isFallback: false,
  };
  return view;
}

const cityHeadings = () => screen.getAllByRole("heading", { level: 2 });

/** The fare rows a card lists once expanded (none while collapsed). */
function rowsOf(card: HTMLElement): HTMLElement[] {
  const panelId = within(card).getByRole("button").getAttribute("aria-controls") ?? "";
  const panel = document.getElementById(panelId);
  return panel === null ? [] : within(panel).getAllByRole("link");
}

describe("daily flights page", () => {
  it("shows one card per city built from its cheapest fare, with no dates, and expands to every fare sorted by price", async () => {
    const user = userEvent.setup();
    setup();

    await screen.findAllByRole("heading", { level: 2 });
    const heading = screen.getByRole("heading", { level: 1, name: "今日低價機票" });
    expect(within(heading.closest("header") as HTMLElement).getByText("BETA")).toBeVisible();
    expect(screen.getByText("每天 08:00 更新")).toBeVisible();

    // Default 來回 tab: 3 cities (NRT, KIX, ICN) from 5 round-trip fares; 最划算 order
    expect(cityHeadings().map((h) => h.textContent.match(/東京|大阪|首爾/)?.[0])).toEqual([
      "東京",
      "首爾",
      "大阪",
    ]);
    const nrt = cityHeadings()[0] as HTMLElement;
    // Everything on the card belongs to the cheapest NRT fare (TPE, 樂桃航空, direct, 5,680, 省 45%)
    expect(nrt).toHaveTextContent("TPE ⇄ NRT");
    expect(nrt).toHaveTextContent("樂桃航空 · 直飛 · 4 筆");
    expect(nrt).toHaveTextContent("5,680");
    expect(nrt).toHaveTextContent("省 45%");
    expect(nrt).toHaveTextContent("紅眼");
    expect(nrt).not.toHaveTextContent(/起|成田/);
    expect(nrt.textContent).not.toMatch(/\d{1,2}\/\d{1,2}/);
    expect(document.querySelectorAll('svg[data-country="JP"]').length).toBe(2);

    // Expand: all 3 NRT fares, price ascending, each linking to the Trip.com redirect
    const toggle = within(nrt).getByRole("button");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(rowsOf(nrt)).toHaveLength(0);
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const rows = rowsOf(nrt);
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.getAttribute("href"))).toEqual([
      "/api/v1/flights/go?origin=TPE&dest=NRT&outDate=2026-12-10&tripType=rt&lang=zh-TW&inDate=2026-12-14",
      "/api/v1/flights/go?origin=TSA&dest=HND&outDate=2027-03-05&tripType=rt&lang=zh-TW&inDate=2027-03-09",
      "/api/v1/flights/go?origin=KHH&dest=NRT&outDate=2027-02-03&tripType=rt&lang=zh-TW&inDate=2027-02-07",
      "/api/v1/flights/go?origin=TPE&dest=NRT&outDate=2027-01-12&tripType=rt&lang=zh-TW&inDate=2027-01-16",
    ]);
    expect(rows[0]).toHaveTextContent("12/10 – 12/14");
    expect(rows[0]).toHaveTextContent("TPE ⇄ NRT · 樂桃航空 · 直飛 · 紅眼");
    expect(rows[0]).toHaveTextContent("5,680");
    expect(rows[0]).toHaveTextContent("省 45%");
    // Two airports of one city in one card: each row shows its own airport pair
    expect(rows[1]).toHaveTextContent("TSA ⇄ HND");
    expect(rows[2]).toHaveTextContent("KHH ⇄ NRT");
    expect(rows[2]).toHaveTextContent("1 轉機");
    expect(rows[0]).toHaveClass("bg-sprout-50");
    expect(rows[1]).not.toHaveClass("bg-sprout-50");
    expect(rows.every((r) => !/Trip\.com/i.test(r.textContent))).toBe(true);

    // Collapse again
    await user.click(toggle);
    expect(rowsOf(nrt)).toHaveLength(0);
  });

  it("has no sort control, counts active filters, and narrows cards and rows by origin", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findAllByRole("heading", { level: 2 });

    // One fixed order (cheapest fare first): no sort control anywhere
    expect(screen.queryByRole("group", { name: "排序" })).toBeNull();
    expect(screen.queryByRole("button", { name: /最划算|價格最低/ })).toBeNull();
    expect(screen.queryByText(/降幅/)).toBeNull();
    expect(screen.getByText("6 筆")).toBeVisible();
    expect(cityHeadings().map((h) => h.textContent.match(/東京|大阪|首爾/)?.[0])).toEqual([
      "東京",
      "首爾",
      "大阪",
    ]);

    const filterBtn = screen.getByRole("button", { name: /篩選/ });
    expect(within(filterBtn).queryByText("1")).toBeNull();
    await user.click(filterBtn);
    const dialog = await screen.findByRole("dialog", { name: "篩選條件" });
    expect(within(dialog).queryByRole("group", { name: "排序" })).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: /高雄\s*2/ }));
    await user.click(within(dialog).getByRole("button", { name: /查看 2 筆機票/ }));
    expect(within(screen.getByRole("button", { name: /篩選/ })).getByText("1")).toBeVisible();

    // KHH: ICN has no KHH fare so it disappears; NRT keeps only its KHH row
    expect(cityHeadings()).toHaveLength(2);
    expect(screen.queryByText("首爾")).toBeNull();
    const nrt = cityHeadings().find((h) => h.textContent.includes("東京")) as HTMLElement;
    expect(nrt).toHaveTextContent("KHH ⇄ NRT");
    expect(nrt).toHaveTextContent("1 筆");
    await user.click(within(nrt).getByRole("button"));
    const rows = rowsOf(nrt);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute("href", expect.stringContaining("origin=KHH&dest=NRT"));

    // Direct-only now lives in the sheet and counts toward the badge
    await user.click(screen.getByRole("button", { name: /篩選/ }));
    const dialog2 = await screen.findByRole("dialog", { name: "篩選條件" });
    await user.click(within(dialog2).getByRole("button", { name: /只看直飛/ }));
    expect(within(dialog2).getByRole("button", { name: /查看 1 筆機票/ })).toBeVisible();
  });

  it("switches between 來回 and 單程, groups one-way fares per city, and keeps every region tab reachable", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findAllByRole("heading", { level: 2 });

    const oneWay = screen.getByRole("button", { name: "單程" });
    expect(screen.getByRole("button", { name: "來回" })).toHaveAttribute("aria-pressed", "true");
    await user.click(oneWay);
    expect(oneWay).toHaveAttribute("aria-pressed", "true");
    expect(cityHeadings()).toHaveLength(2);
    expect(cityHeadings()[0]).toHaveTextContent("曼谷");
    expect(cityHeadings()[0]).toHaveTextContent("TPE → BKK");
    expect(cityHeadings()[1]).toHaveTextContent("1 轉機");

    const tabs = screen.getByRole("group", { name: "目的地" });
    expect(tabs.className).toContain("overflow-x-auto");
    for (const name of ["全部地區", "日本", "韓國", "東南亞", "港澳", "長程"]) {
      expect(within(tabs).getByRole("button", { name })).toBeVisible();
    }
    expect(screen.getByRole("heading", { level: 1 }).className).toContain("whitespace-nowrap");
  });

  it("shows a solid pill from 40% up, plain green text below it (cards and rows), and nothing for normal fares", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findAllByRole("heading", { level: 2 });

    // Tokyo 45% is solid; Osaka 21% is a signal below 40%: plain text
    expect(screen.getByText("省 45%").className).toContain("bg-sprout-600");
    const quiet = screen.getByText("省 21%");
    expect(quiet.className).not.toContain("bg-sprout-600");
    expect(quiet.className).toContain("text-sprout-700");
    // ICN's cheapest round trip is normal: no badge at all
    expect(cityHeadings()[1]).toHaveTextContent("首爾");
    expect(cityHeadings()[1]).not.toHaveTextContent("省");

    // Expanded rows follow the same threshold: 45% solid, 18% plain
    await user.click(within(cityHeadings()[0] as HTMLElement).getByRole("button"));
    const rows = rowsOf(cityHeadings()[0] as HTMLElement);
    expect(within(rows[0] as HTMLElement).getByText("省 45%").className).toContain("bg-sprout-600");
    const row18 = within(rows[2] as HTMLElement).getByText("省 18%");
    expect(row18.className).not.toContain("bg-sprout-600");
    expect(row18.className).toContain("text-sprout-700");
  });

  it("renders 45% as a solid pill, 25% as 省 text, 12% as a ↓ arrow with an accessible label, and 0% as nothing", async () => {
    const { api } = setup();
    const deal = (dest: string, region: DailyFlightItem["region"], pct: number, price: number) =>
      fare(`d-${dest}`, {
        dest,
        region,
        priceTwd: price,
        discountPct: pct,
        tag: pct >= 30 ? "steal" : pct >= 15 ? "below_market" : "normal",
      });
    api.dailyFlights = {
      date: "2026-11-16",
      updatedAt: "2026-11-16T01:00:00.000Z",
      items: [
        deal("NRT", "jp", 45, 3000),
        deal("KIX", "jp", 25, 3100),
        deal("FUK", "jp", 12, 3200),
        deal("ICN", "kr", 0, 3300),
      ],
      isFallback: false,
    };
    await screen.findAllByRole("heading", { level: 2 });
    const [tokyo, osaka, fukuoka, seoul] = cityHeadings() as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];

    expect(within(tokyo).getByText("省 45%").className).toContain("bg-sprout-600");
    const plain = within(osaka).getByText("省 25%");
    expect(plain.className).toContain("text-sprout-700");
    expect(plain.className).not.toContain("bg-sprout-600");
    const arrow = within(fukuoka).getByText("↓12%");
    expect(arrow.className).not.toContain("bg-sprout-600");
    expect(arrow.getAttribute("aria-hidden")).toBe("true");
    expect(within(fukuoka).getByText("省 12%")).toHaveClass("sr-only");
    expect(seoul).not.toHaveTextContent(/省|↓/);
  });

  it("orders city cards by their cheapest fare, lowest first, with ties going to the higher discount", async () => {
    const { api } = setup();
    const f = (dest: string, region: DailyFlightItem["region"], priceTwd: number, pct: number) =>
      fare(`o-${dest}`, {
        dest,
        region,
        priceTwd,
        discountPct: pct,
        tag: pct >= 30 ? "steal" : "normal",
      });
    api.dailyFlights = {
      date: "2026-11-16",
      updatedAt: "2026-11-16T01:00:00.000Z",
      items: [
        f("KIX", "jp", 9000, 40),
        f("FUK", "jp", 8000, 0),
        f("BKK", "sea", 7000, 0),
        f("NRT", "jp", 8000, 40),
        f("ICN", "kr", 5000, 0),
      ],
      isFallback: false,
    };
    await screen.findAllByRole("heading", { level: 2 });
    expect(cityHeadings().map((h) => h.textContent.match(/東京|大阪|首爾|曼谷|福岡/)?.[0])).toEqual(
      ["首爾", "曼谷", "東京", "福岡", "大阪"],
    );
  });

  it("draws the solid pill at exactly 40% and up, and region filters never change which cards are solid", async () => {
    const user = userEvent.setup();
    const deal = (dest: string, region: DailyFlightItem["region"], pct: number) =>
      fare(`deal-${dest}`, {
        dest,
        region,
        priceTwd: 3000,
        discountPct: pct,
        tag: pct >= 30 ? "steal" : "below_market",
      });
    const { api } = setup();
    api.dailyFlights = {
      date: "2026-11-16",
      updatedAt: "2026-11-16T01:00:00.000Z",
      items: [
        deal("NRT", "jp", 45),
        deal("KIX", "jp", 40),
        deal("FUK", "jp", 39),
        deal("ICN", "kr", 35),
        deal("PUS", "kr", 15),
      ],
      isFallback: false,
    };
    await screen.findAllByRole("heading", { level: 2 });

    const solidCities = () =>
      cityHeadings()
        .filter((h) => h.querySelector(".bg-sprout-600") !== null)
        .map((h) => h.textContent.match(/東京|大阪|福岡|首爾|釜山/)?.[0]);
    expect(solidCities()).toEqual(["東京", "大阪"]);
    expect(screen.getAllByText(/^省 \d+%$/)).toHaveLength(5);

    const regions = screen.getByRole("group", { name: "目的地" });
    await user.click(within(regions).getByRole("button", { name: "日本" }));
    expect(cityHeadings()).toHaveLength(3);
    expect(solidCities()).toEqual(["東京", "大阪"]);
    await user.click(within(regions).getByRole("button", { name: "韓國" }));
    expect(cityHeadings()).toHaveLength(2);
    expect(solidCities()).toEqual([]);
  });

  it("renders English labels and redirect links", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findAllByRole("heading", { level: 2 });
    await user.click(screen.getByRole("button", { name: "切換為英文" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Today's Deals" })).toBeVisible();
    await screen.findAllByRole("heading", { level: 2 });
    // BETA sits beside the title on its row (never moved to the subtitle line) in English too
    const title = screen.getByRole("heading", { level: 1, name: "Today's Deals" });
    expect(within(title.parentElement as HTMLElement).getByText("BETA")).toBeVisible();
    expect(screen.getByText("Updated daily at 8 AM")).toBeVisible();
    expect(screen.queryByRole("group", { name: "Sort" })).toBeNull();
    expect(screen.queryByText(/Drop|Best value|Lowest price/)).toBeNull();
    expect(screen.getByText("6 fares")).toBeVisible();
    const nrt = cityHeadings()[0] as HTMLElement;
    expect(nrt).toHaveTextContent("Tokyo");
    expect(nrt).not.toHaveTextContent("Narita");
    expect(nrt).toHaveTextContent("Peach · Nonstop · 4 fares");
    expect(nrt).toHaveTextContent("Save 45%");
    expect(nrt).toHaveTextContent("Red-eye");
    await user.click(within(nrt).getByRole("button"));
    expect(rowsOf(nrt)[0]).toHaveAttribute("href", expect.stringContaining("lang=en"));
  });

  it("uses singular English counts: 1 fare, 2 stops", async () => {
    const user = userEvent.setup();
    const { api } = setup();
    api.dailyFlights = {
      date: "2026-11-16",
      updatedAt: "2026-11-16T01:00:00.000Z",
      items: [fare("only", { dest: "ICN", region: "kr", priceTwd: 6000, transfers: 2 })],
      isFallback: false,
    };
    await screen.findAllByRole("heading", { level: 2 });
    await user.click(screen.getByRole("button", { name: "切換為英文" }));
    expect(await screen.findByText("1 fare")).toBeVisible();
    expect(cityHeadings()[0]).toHaveTextContent("2 stops · 1 fare");
    expect(screen.queryByText(/1 fares/)).toBeNull();
  });

  it("uses plural English counts: 2 fares, 1 stop", async () => {
    const user = userEvent.setup();
    const { api } = setup();
    api.dailyFlights = {
      date: "2026-11-16",
      updatedAt: "2026-11-16T01:00:00.000Z",
      items: [
        fare("a", { dest: "ICN", region: "kr", priceTwd: 6000, transfers: 1 }),
        fare("b", { dest: "ICN", region: "kr", transfers: 1, priceTwd: 9000 }),
      ],
      isFallback: false,
    };
    await screen.findAllByRole("heading", { level: 2 });
    await user.click(screen.getByRole("button", { name: "切換為英文" }));
    expect(await screen.findByText("2 fares")).toBeVisible();
    expect(cityHeadings()[0]).toHaveTextContent("1 stop · 2 fares");
  });

  it("renders inside AppShell when signed in and supports inline region tabs + empty reset", async () => {
    const user = userEvent.setup();
    setup("/flights", makeUser("小宇"));

    expect(await screen.findByRole("heading", { level: 1, name: "今日低價機票" })).toBeVisible();
    const bottomNav = screen.getByRole("navigation", { name: "底部導覽" });
    expect(within(bottomNav).getByRole("link", { name: "機票" })).toHaveAttribute(
      "href",
      "/flights",
    );

    const regionGroup = screen.getByRole("group", { name: "目的地" });
    await user.click(within(regionGroup).getByRole("button", { name: "港澳" }));
    expect(await screen.findByText("目前沒有符合條件的低價機票")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "重設篩選" }));
    expect(await screen.findByText(/東京/)).toBeVisible();
  });

  it("keeps signed-out PublicHeader free of a redundant flights link and localizes filter drawer Close", async () => {
    const user = userEvent.setup();
    renderApp({ path: "/flights" });

    const header = await screen.findByRole("banner");
    expect(within(header).queryByRole("link", { name: /低價機票/ })).toBeNull();
    // One header row: mascot logo only (no 小芽 wordmark), the title block inside it, no second title card
    expect(within(header).getByRole("heading", { level: 1, name: "今日低價機票" })).toBeVisible();
    expect(within(header).getByRole("link", { name: "小芽" })).toHaveAttribute("href", "/");
    expect(within(header).queryByText("小芽")).toBeNull();
    expect(within(header).getByText("每天 08:00 更新")).toBeVisible();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);

    await user.click(await screen.findByRole("button", { name: /篩選/ }));
    expect(await screen.findByRole("button", { name: "關閉篩選" })).toBeVisible();
  });

  it("prevents mobile grid/drawer clipping and shows only the update date in the footer", async () => {
    const user = userEvent.setup();
    setup();

    const firstCard = (await screen.findAllByRole("heading", { level: 2 }))[0] as HTMLElement;
    const list = firstCard.closest("ul");
    const listItem = firstCard.closest("li");
    expect(list).toHaveClass("grid-cols-1", "md:grid-cols-2");
    expect(listItem).toHaveClass("min-w-0");
    // Lines never wrap: ellipsis fallback on the title and secondary lines
    expect(firstCard.querySelector(".flight-card-city")?.className).toContain("truncate");
    expect(within(firstCard).getByText("樂桃航空").className).toContain("truncate");
    // Footer carries only the digest date (no tagline, no disclaimer)
    expect(screen.getByText("11/16 更新")).toBeVisible();
    expect(screen.queryByText(/參考價格為浮動/)).toBeNull();

    await user.click(screen.getByRole("button", { name: /篩選/ }));
    const dialog = await screen.findByRole("dialog", { name: "篩選條件" });
    const applyBtn = within(dialog).getByRole("button", { name: /查看 \d+ 筆機票/ });
    const resetBtn = within(dialog).getByRole("button", { name: "重設" });
    const footer = applyBtn.closest("div");
    const scrollableBody = footer?.previousElementSibling;
    expect(footer).toHaveClass("shrink-0");
    expect(resetBtn).toBeVisible();
    expect(scrollableBody).toHaveClass("min-h-0", "flex-1", "overflow-y-auto");
  });

  it("opens booking links in the external browser when inside LINE", async () => {
    const user = userEvent.setup();
    const view = renderApp({
      path: "/flights",
      insideLine: { idToken: null },
    });
    view.api.dailyFlights = {
      date: "2026-11-16",
      updatedAt: "2026-11-16T00:00:00.000Z",
      items: SAMPLE_FLIGHTS,
      isFallback: false,
    };

    const tokyoToggle = await screen.findByRole("button", { name: /東京/ });
    await user.click(tokyoToggle);

    const card = tokyoToggle.closest(".flight-card") as HTMLElement;
    const [firstLink] = within(card).getAllByRole("link");
    if (!firstLink) throw new Error("Expected booking link");
    await user.click(firstLink);

    expect(view.lineExternalOpens).toHaveLength(1);
    expect(view.lineExternalOpens[0]).toMatch(/^https?:\/\/[^/]+\/api\/v1\/flights\/go\?/);
  });

  it("uses plain booking anchors outside LINE without calling openExternal", async () => {
    const user = userEvent.setup();
    const view = setup();

    const tokyoToggle = await screen.findByRole("button", { name: /東京/ });
    await user.click(tokyoToggle);

    const card = tokyoToggle.closest(".flight-card") as HTMLElement;
    const [firstLink] = within(card).getAllByRole("link");
    if (!firstLink) throw new Error("Expected booking link");
    await user.click(firstLink);

    expect(view.lineExternalOpens).toEqual([]);
  });
});
