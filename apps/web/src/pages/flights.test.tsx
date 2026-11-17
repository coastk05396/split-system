import type { DailyFlightItem, FlightRegion } from "@split/shared";
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

/** Round trips: Tokyo has 4 fares over two airports (cheapest is a 45% deal at NRT), KIX 1, ICN 1; one-ways: ICN, BKK. */
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

/** The page-level `N 筆` count (cards carry their own per-city fare pill). */
const pageCount = () => screen.getByRole("group", { name: /^(排序|Sort)$/ }).previousElementSibling;

const cityHeadings = () => screen.getAllByRole("heading", { level: 2 });

/** The fare rows a card lists once expanded (none while collapsed). */
function rowsOf(card: HTMLElement): HTMLElement[] {
  const panelId = within(card).getByRole("button").getAttribute("aria-controls") ?? "";
  const panel = document.getElementById(panelId);
  return panel === null ? [] : within(panel).getAllByRole("link");
}

const cityOf = (h: HTMLElement) => h.textContent.match(/東京|大阪|首爾|曼谷|福岡|釜山/)?.[0];
const cityOrder = () => cityHeadings().map(cityOf);
const setItems = (api: { dailyFlights?: unknown }, items: DailyFlightItem[]) => {
  api.dailyFlights = {
    date: "2026-11-16",
    updatedAt: "2026-11-16T01:00:00.000Z",
    items,
    isFallback: false,
  };
};

describe("daily flights page", () => {
  it("shows the v3 title block: highlighted 去哪, amber BETA, and the refresh note", async () => {
    setup();
    await screen.findAllByRole("heading", { level: 2 });
    const heading = screen.getByRole("heading", { level: 1, name: "今天想飛去哪？" });
    expect(heading).toHaveClass("font-extrabold", "whitespace-nowrap");
    const mark = within(heading).getByText("去哪");
    expect(mark.className).toContain("linear-gradient(transparent_60%,#d3ebdf_60%)");
    const row = heading.parentElement as HTMLElement;
    const beta = within(row).getByText("BETA");
    expect(beta.className).toMatch(/bg-\[#fef3c7\].*text-\[#92400e\]/);
    expect(beta.className).toContain("tracking-[0.06em]");
    expect(beta.className).not.toContain("border");
    expect(screen.getByText("每天 08:00 更新")).toBeVisible();
    expect(screen.queryByText(/低價機票/)).toBeNull();
  });

  it("shows one card per city from its cheapest fare, collapsed with a fare-count pill and no 直飛, and expands to every fare by price", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findAllByRole("heading", { level: 2 });

    // Default 來回 tab: 3 cities (NRT, KIX, ICN) from 6 round-trip fares; 最划算 order
    expect(cityOrder()).toEqual(["東京", "大阪", "首爾"]);
    const nrt = cityHeadings()[0] as HTMLElement;
    // Everything on the card belongs to the cheapest NRT fare (TPE, 樂桃航空, 5,680, 省 45%)
    expect(nrt).toHaveTextContent("TPE ⇄ NRT");
    expect(nrt).toHaveTextContent("樂桃航空");
    expect(nrt).toHaveTextContent("5,680");
    expect(nrt).toHaveTextContent("省 45%");
    // 4 fares pill; no directness while collapsed, no dates
    const pill = within(nrt).getByText("4 筆");
    expect(pill.className).toMatch(/bg-\[#eef2f0\].*text-fl-muted/);
    expect(nrt).not.toHaveTextContent(/直飛|轉|成田/);
    expect(nrt.textContent).not.toMatch(/\d{1,2}\/\d{1,2}/);
    expect(document.querySelectorAll('svg[data-country="JP"]').length).toBe(2);

    // Expand: header line reads 航空公司 · 直飛 · N 筆; all NRT-city fares, price ascending
    const toggle = within(nrt).getByRole("button");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(rowsOf(nrt)).toHaveLength(0);
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(nrt).toHaveTextContent("樂桃航空 · 直飛 · 4 筆");
    // Count is plain text when expanded, not the collapsed grey pill
    expect(nrt.querySelector('[class*="bg-[#eef2f0]"]')).toBeNull();
    const card = nrt.closest(".flight-card") as HTMLElement;
    expect(card.className).toContain("border-[#c4e3d3]");
    expect(card.className).toContain("overflow-hidden");
    const rows = rowsOf(nrt);
    expect(rows.map((r) => r.getAttribute("href"))).toEqual([
      "/api/v1/flights/go?origin=TPE&dest=NRT&outDate=2026-12-10&tripType=rt&lang=zh-TW&inDate=2026-12-14",
      "/api/v1/flights/go?origin=TSA&dest=HND&outDate=2027-03-05&tripType=rt&lang=zh-TW&inDate=2027-03-09",
      "/api/v1/flights/go?origin=KHH&dest=NRT&outDate=2027-02-03&tripType=rt&lang=zh-TW&inDate=2027-02-07",
      "/api/v1/flights/go?origin=TPE&dest=NRT&outDate=2027-01-12&tripType=rt&lang=zh-TW&inDate=2027-01-16",
    ]);
    expect(rows[0]).toHaveTextContent("12/10–12/14");
    expect(rows[0]).toHaveTextContent("桃園出發 · 樂桃航空 · 直飛");
    expect(rows[0]).toHaveTextContent("NT$5,680");
    expect(rows[1]).toHaveTextContent("03/05–03/09");
    expect(rows[1]).toHaveTextContent("松山出發 · 中華航空 · 直飛");
    expect(rows[2]).toHaveTextContent("高雄出發 · 台灣虎航 · 轉 1");
    expect(rows[3]).toHaveTextContent("01/12–01/16");
    expect(rows[3]).toHaveTextContent("桃園出發");
    // The route chip stays on the card header, never on rows
    expect(rows.every((r) => !/⇄|→/.test(r.textContent))).toBe(true);
    // First row is mint, others white, separated by dashed hairlines
    expect(rows[0]?.closest("li")).toHaveClass("bg-fl-tint", "border-dashed");
    expect(rows[1]?.closest("li")).toHaveClass("bg-white", "border-dashed");
    // Footer note; 4 fares fit so there is no 看全部 button
    expect(
      screen.getByText("點日期前往 Trip.com · 參考價每日 08:00 更新，以訂票頁為準"),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: /看全部/ })).toBeNull();

    // Collapse again
    await user.click(toggle);
    expect(rowsOf(nrt)).toHaveLength(0);
  });

  it("counts fares (not cities), sorts cards by 最划算 or 價格最低, and keeps fares price-ascending inside a card", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findAllByRole("heading", { level: 2 });

    // N 筆 counts the fares shown (6 round trips), never the 3 destinations
    expect(pageCount()).toHaveTextContent(/^6 筆$/);
    expect(screen.queryByText(/個目的地|價格由低到高/)).toBeNull();
    const sort = screen.getByRole("group", { name: "排序" });
    const best = within(sort).getByRole("button", { name: "最划算" });
    const price = within(sort).getByRole("button", { name: "價格最低" });
    expect(best).toHaveAttribute("aria-pressed", "true");
    expect(price).toHaveAttribute("aria-pressed", "false");
    expect(best.className).toMatch(/border-fl-green.*bg-fl-tint.*font-bold.*text-fl-green/);
    expect(price.className).toMatch(/border-fl-hair.*bg-white/);
    expect(best.className).toContain("min-h-9");
    expect(best.className).toContain("after:-inset-y-[5.5px]");
    // 東京 45% > 大阪 21% > 首爾 0%
    expect(cityOrder()).toEqual(["東京", "大阪", "首爾"]);

    await user.click(price);
    expect(price).toHaveAttribute("aria-pressed", "true");
    expect(best).toHaveAttribute("aria-pressed", "false");
    // 東京 5,680 < 首爾 6,100 < 大阪 8,900
    expect(cityOrder()).toEqual(["東京", "首爾", "大阪"]);
    expect(pageCount()).toHaveTextContent(/^6 筆$/);
    await user.click(within(cityHeadings()[0] as HTMLElement).getByRole("button"));
    expect(
      rowsOf(cityHeadings()[0] as HTMLElement).map((r) => r.textContent.match(/NT\$[\d,]+/)?.[0]),
    ).toEqual(["NT$5,680", "NT$6,200", "NT$6,900", "NT$7,200"]);

    await user.click(best);
    expect(cityOrder()).toEqual(["東京", "大阪", "首爾"]);
  });

  it("orders 最划算 by the cheapest fare's discount (ties: cheaper first) and 價格最低 by price (ties: bigger discount)", async () => {
    const user = userEvent.setup();
    const { api } = setup();
    const f = (dest: string, region: DailyFlightItem["region"], priceTwd: number, pct: number) =>
      fare(`o-${dest}`, { dest, region, priceTwd, discountPct: pct });
    setItems(api, [
      f("KIX", "jp", 9000, 40),
      f("FUK", "jp", 8000, 0),
      f("BKK", "sea", 7000, 0),
      f("NRT", "jp", 8000, 40),
      f("ICN", "kr", 5000, 0),
    ]);
    await screen.findAllByRole("heading", { level: 2 });
    expect(cityOrder()).toEqual(["東京", "大阪", "首爾", "曼谷", "福岡"]);
    await user.click(screen.getByRole("button", { name: "價格最低" }));
    expect(cityOrder()).toEqual(["首爾", "曼谷", "東京", "福岡", "大阪"]);
  });

  it("counts active filters, narrows cards and the N 筆 count by origin, and shows live option counts", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findAllByRole("heading", { level: 2 });

    const filterBtn = screen.getByRole("button", { name: /篩選/ });
    expect(filterBtn.className).toMatch(/min-h-11.*border-\[#a9d6c1\].*text-fl-green/);
    expect(within(filterBtn).queryByText("1")).toBeNull();
    await user.click(filterBtn);
    const dialog = await screen.findByRole("dialog", { name: "篩選條件" });
    expect(within(dialog).queryByRole("group", { name: "排序" })).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: /高雄 KHH\s*2/ }));
    await user.click(within(dialog).getByRole("button", { name: /查看 2 筆機票/ }));
    const badge = within(screen.getByRole("button", { name: /篩選/ })).getByText("1");
    expect(badge.className).toContain("bg-fl-green");

    // KHH: ICN has no KHH fare so it disappears; NRT keeps only its KHH row
    expect(cityHeadings()).toHaveLength(2);
    expect(pageCount()).toHaveTextContent(/^2 筆$/);
    expect(screen.queryByText("首爾")).toBeNull();
    const nrt = cityHeadings().find((h) => h.textContent.includes("東京")) as HTMLElement;
    expect(nrt).toHaveTextContent("KHH ⇄ NRT");
    await user.click(within(nrt).getByRole("button"));
    const rows = rowsOf(nrt);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute("href", expect.stringContaining("origin=KHH&dest=NRT"));
  });

  it("filters stops tri-state (不指定 / 只看直飛 / 需轉機) and counts it as one active filter", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findAllByRole("heading", { level: 2 });
    await user.click(screen.getByRole("button", { name: /篩選/ }));
    const dialog = await screen.findByRole("dialog", { name: "篩選條件" });
    const stops = within(dialog).getByRole("group", { name: "直飛 / 轉機" });
    const [any, direct, connecting] = ["不指定", "只看直飛", "需轉機"].map((name) =>
      within(stops).getByRole("button", { name: new RegExp(name) }),
    ) as [HTMLElement, HTMLElement, HTMLElement];
    expect(any).toHaveAttribute("aria-pressed", "true");
    // Live counts: 6 round trips, 5 nonstop, 1 with a stop (KHH nrt-c)
    expect(direct).toHaveTextContent("5");
    expect(connecting).toHaveTextContent("1");

    await user.click(direct);
    expect(direct).toHaveAttribute("aria-pressed", "true");
    expect(any).toHaveAttribute("aria-pressed", "false");
    expect(within(dialog).getByRole("button", { name: "查看 5 筆機票" })).toBeVisible();

    await user.click(connecting);
    expect(connecting).toHaveAttribute("aria-pressed", "true");
    expect(direct).toHaveAttribute("aria-pressed", "false");
    expect(within(dialog).getByRole("button", { name: "查看 1 筆機票" })).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "查看 1 筆機票" }));
    expect(pageCount()).toHaveTextContent(/^1 筆$/);
    expect(within(screen.getByRole("button", { name: /篩選/ })).getByText("1")).toBeVisible();
    expect(cityHeadings()).toHaveLength(1);
    expect(cityHeadings()[0]).toHaveTextContent("東京");

    await user.click(screen.getByRole("button", { name: /篩選/ }));
    const dialog2 = await screen.findByRole("dialog", { name: "篩選條件" });
    await user.click(within(dialog2).getByRole("button", { name: /不指定/ }));
    expect(within(dialog2).getByRole("button", { name: "查看 6 筆機票" })).toBeVisible();
  });

  it("offers budget caps of $5,000 and $10,000, month-only labels, and no red-eye row", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findAllByRole("heading", { level: 2 });
    await user.click(screen.getByRole("button", { name: /篩選/ }));
    const dialog = await screen.findByRole("dialog", { name: "篩選條件" });

    const budget = within(dialog).getByRole("group", { name: "預算上限" });
    expect(
      within(budget)
        .getAllByRole("button")
        .map((b) => b.textContent.replace(/\d+$/, "")),
    ).toEqual(["不限", "$5,000 以下", "$10,000 以下"]);
    expect(within(dialog).queryByText(/\$8,000|\$12,000|\$20,000/)).toBeNull();
    await user.click(within(budget).getByRole("button", { name: /\$10,000 以下/ }));
    expect(within(dialog).getByRole("button", { name: "查看 6 筆機票" })).toBeVisible();
    await user.click(within(budget).getByRole("button", { name: /\$5,000 以下/ }));
    expect(within(dialog).getByRole("button", { name: "查看 0 筆機票" })).toBeVisible();
    await user.click(within(budget).getByRole("button", { name: /不限/ }));

    const months = within(dialog).getByRole("group", { name: "出發月份" });
    expect(
      within(months)
        .getAllByRole("button")
        .map((b) => b.textContent.replace(/\d+$/, "")),
    ).toEqual(["全部", "12月", "1月", "2月", "3月"]);

    // Red-eye was removed from the product: no row or checkbox for it
    expect(within(dialog).queryByRole("checkbox")).toBeNull();
    expect(dialog).not.toHaveTextContent(/紅眼/);
  });

  it("switches between 來回 and 單程, groups one-way fares per city, and keeps every region tab visible without scrolling", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findAllByRole("heading", { level: 2 });

    const trip = screen.getByRole("group", { name: "行程" });
    expect(trip.className).toContain("bg-fl-track");
    expect(trip.className).toContain("p-[3px]");
    const oneWay = within(trip).getByRole("button", { name: "單程" });
    const roundTrip = within(trip).getByRole("button", { name: "來回" });
    expect(roundTrip).toHaveAttribute("aria-pressed", "true");
    expect(roundTrip.className).toMatch(/bg-white.*font-bold.*shadow-\[0_1px_3px/);
    expect(oneWay.className).not.toContain("bg-white");
    // 44px hit areas: 38px thumbs plus a 3px ::after stretch on each side
    expect(oneWay.className).toContain("min-h-[38px]");
    expect(oneWay.className).toContain("after:-inset-y-[3px]");
    await user.click(oneWay);
    expect(oneWay).toHaveAttribute("aria-pressed", "true");
    expect(cityHeadings()).toHaveLength(2);
    expect(cityHeadings()[0]).toHaveTextContent("曼谷");
    expect(cityHeadings()[0]).toHaveTextContent("TPE → BKK");
    await user.click(within(cityHeadings()[1] as HTMLElement).getByRole("button"));
    // One-way rows show the outbound date only; the 1-stop fare says 轉 1
    const row = rowsOf(cityHeadings()[1] as HTMLElement)[0] as HTMLElement;
    expect(row).toHaveTextContent("12/18");
    expect(row).not.toHaveTextContent("–");
    expect(row).toHaveTextContent("桃園出發 · 大韓航空 · 轉 1");

    // All six pill tabs fit at once: the row never scrolls horizontally (no scrollbar at 360/390px)
    const tabs = screen.getByRole("group", { name: "目的地" });
    expect(tabs.className).not.toMatch(/overflow-x-(auto|scroll)/);
    expect(tabs.className).toContain("overflow-hidden");
    expect(tabs.className).toContain("flex-nowrap");
    const buttons = within(tabs).getAllByRole("button");
    expect(buttons).toHaveLength(6);
    for (const name of ["全部", "日本", "韓國", "東南亞", "港澳", "長程"]) {
      expect(within(tabs).getByRole("button", { name })).toBeVisible();
    }
    for (const tab of buttons) {
      expect(tab).toHaveClass("min-w-0", "flex-auto", "whitespace-nowrap", "rounded-full");
      expect(tab.className).toContain("after:-inset-y-1");
    }
    // Active = emerald solid with white bold text; inactive = mint track with slate text
    expect(within(tabs).getByRole("button", { name: "全部" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(tabs).getByRole("button", { name: "全部" }).className).toMatch(
      /bg-fl-green.*font-bold.*text-white/,
    );
    expect(within(tabs).getByRole("button", { name: "日本" }).className).toMatch(
      /bg-fl-track.*text-fl-muted/,
    );
    expect(screen.getByRole("heading", { level: 1 }).className).toContain("whitespace-nowrap");
  });

  it.each([
    [14, null],
    [15, "text"],
    [49, "text"],
    [50, "solid"],
    [70, "solid"],
  ] as const)("draws a %i%% discount as %s on the card", async (pct, kind) => {
    const { api } = setup();
    setItems(api, [fare("d", { dest: "NRT", priceTwd: 3000, discountPct: pct })]);
    await screen.findAllByRole("heading", { level: 2 });
    const card = cityHeadings()[0] as HTMLElement;
    if (kind === null) {
      expect(card).not.toHaveTextContent(/省|%/);
      return;
    }
    const badge = within(card).getByText(`省 ${String(pct)}%`);
    if (kind === "solid") {
      expect(badge.className).toMatch(/rounded-full.*bg-fl-green.*font-bold.*text-white/);
    }
    expect(badge.className).toContain("text-[11px]"); // smaller than the 26px price
    if (kind === "text") {
      expect(badge.className).toContain("text-fl-green");
      expect(badge.className).not.toContain("bg-");
    }
    expect(within(card).getByText("3,000").className).toContain("text-[26px]");
  });

  it("applies the 15/50 thresholds on expanded rows too, with a smaller badge", async () => {
    const user = userEvent.setup();
    const { api } = setup();
    setItems(
      api,
      [70, 50, 49, 15, 14].map((pct, i) =>
        fare(`r${String(pct)}`, {
          dest: "ICN",
          region: "kr",
          priceTwd: 4000 + i * 100,
          discountPct: pct,
        }),
      ),
    );
    await screen.findAllByRole("heading", { level: 2 });
    await user.click(within(cityHeadings()[0] as HTMLElement).getByRole("button"));
    const rows = rowsOf(cityHeadings()[0] as HTMLElement);
    const badge = (row: HTMLElement | undefined, pct: number) =>
      within(row as HTMLElement).queryByText(`省 ${String(pct)}%`);
    expect(badge(rows[0], 70)?.className).toMatch(/bg-fl-green.*text-\[11px\]/);
    expect(badge(rows[1], 50)?.className).toContain("bg-fl-green");
    expect(badge(rows[2], 49)?.className).toMatch(/text-fl-green/);
    expect(badge(rows[2], 49)?.className).not.toContain("bg-");
    expect(badge(rows[3], 15)?.className).not.toContain("bg-");
    expect(rows[4]).not.toHaveTextContent("省");
  });

  it("draws 直飛 only in the expanded state: 直飛 / 轉 N on rows, never on a collapsed card", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findAllByRole("heading", { level: 2 });
    expect(screen.queryByText(/直飛|Nonstop|轉/)).toBeNull();
    for (const card of cityHeadings()) {
      await user.click(within(card).getByRole("button"));
      expect(card).toHaveTextContent(/ · 直飛 · \d 筆|轉 \d · \d 筆/);
      for (const row of rowsOf(card)) {
        const detail = row.querySelector(".fare-row-detail") as HTMLElement;
        expect(detail.textContent).toMatch(/出發 · .+ · (直飛|轉 \d)$/);
        // Origin is always named; dots are decoration only
        expect(detail.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2);
      }
    }
    const stopRows = screen.getAllByRole("link").filter((a) => /轉/.test(a.textContent));
    expect(stopRows.map((a) => a.querySelector(".fare-row-detail")?.textContent)).toEqual([
      "高雄出發 · 台灣虎航 · 轉 1",
    ]);
    const stop = within(stopRows[0] as HTMLElement).getByText("轉 1");
    expect(stop.className).toMatch(/font-bold.*text-\[#92400e\]/);
    const direct = within(rowsOf(cityHeadings()[0] as HTMLElement)[0] as HTMLElement).getByText(
      "直飛",
    );
    expect(direct.className).toMatch(/font-bold.*text-fl-green/);
    expect(cityHeadings()[0]).toHaveTextContent("樂桃航空 · 直飛 · 4 筆");
  });

  it("formats fare dates as MM/DD–MM/DD, one-way MM/DD, and same-day MM/DD", async () => {
    const user = userEvent.setup();
    const { api } = setup();
    setItems(api, [
      fare("a", {
        dest: "ICN",
        region: "kr",
        priceTwd: 4000,
        outDate: "2026-12-09",
        inDate: "2026-12-12",
      }),
      fare("b", {
        dest: "ICN",
        region: "kr",
        priceTwd: 4100,
        outDate: "2026-12-28",
        inDate: "2027-01-03",
      }),
      fare("c", {
        dest: "ICN",
        region: "kr",
        priceTwd: 4200,
        outDate: "2026-12-09",
        inDate: "2026-12-09",
      }),
    ]);
    await screen.findAllByRole("heading", { level: 2 });
    await user.click(within(cityHeadings()[0] as HTMLElement).getByRole("button"));
    const dates = rowsOf(cityHeadings()[0] as HTMLElement).map(
      (r) => r.querySelector(".fare-row-date")?.textContent,
    );
    expect(dates).toEqual(["12/09–12/12", "12/28–01/03", "12/09"]);
  });

  it("caps an expanded card at 5 fares with a 看全部 N 筆 footer that expands and collapses", async () => {
    const user = userEvent.setup();
    const { api } = setup();
    setItems(
      api,
      Array.from({ length: 7 }, (_, i) =>
        fare(`s-${String(i)}`, {
          dest: "ICN",
          region: "kr",
          priceTwd: 4000 + i * 100,
          outDate: `2026-12-${String(10 + i).padStart(2, "0")}`,
          inDate: `2026-12-${String(14 + i).padStart(2, "0")}`,
        }),
      ),
    );
    await screen.findAllByRole("heading", { level: 2 });
    const card = cityHeadings()[0] as HTMLElement;
    await user.click(within(card).getByRole("button"));
    expect(rowsOf(card)).toHaveLength(5);
    expect(card).toHaveTextContent("7 筆");

    const more = screen.getByRole("button", { name: "看全部 7 筆" });
    expect(more.className).toMatch(/border-dashed.*bg-white.*font-bold.*text-fl-green/);
    await user.click(more);
    expect(rowsOf(card)).toHaveLength(7);
    expect(rowsOf(card)[6]).toHaveTextContent("12/16–12/20");
    await user.click(screen.getByRole("button", { name: "收合" }));
    expect(rowsOf(card)).toHaveLength(5);
    expect(screen.getByRole("button", { name: "看全部 7 筆" })).toBeVisible();
  });

  const chipCases = [
    ["NRT", "jp"],
    ["ICN", "kr"],
    ["BKK", "sea"],
    ["HKG", "hkmo"],
    ["LHR", "longhaul"],
  ] as const satisfies readonly (readonly [string, FlightRegion])[];
  it.each(chipCases)(
    "renders the %s (%s) route chip in the single orange chip style",
    async (dest, region) => {
      const { api } = setup();
      setItems(api, [fare("x", { dest, region, priceTwd: 5000 })]);
      await screen.findAllByRole("heading", { level: 2 });
      const chip = within(cityHeadings()[0] as HTMLElement).getByText(`TPE ⇄ ${dest}`);
      expect(chip).toHaveClass("bg-[#ffedd5]", "text-[#9a3412]", "rounded-full", "font-bold");
    },
  );

  it("renders English labels, sort chips and redirect links", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findAllByRole("heading", { level: 2 });
    await user.click(screen.getByRole("button", { name: "切換為英文" }));

    const title = await screen.findByRole("heading", { level: 1, name: "Where to fly today?" });
    await screen.findAllByRole("heading", { level: 2 });
    expect(within(title).getByText("fly").className).toContain("linear-gradient");
    expect(within(title.parentElement as HTMLElement).getByText("BETA")).toBeVisible();
    expect(screen.getByText("Updated daily at 8 AM")).toBeVisible();
    const sort = screen.getByRole("group", { name: "Sort" });
    expect(within(sort).getByRole("button", { name: "Best deals" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(sort).getByRole("button", { name: "Lowest price" })).toBeVisible();
    expect(pageCount()).toHaveTextContent(/^6 fares$/);
    const nrt = cityHeadings()[0] as HTMLElement;
    expect(nrt).toHaveTextContent("Tokyo");
    expect(nrt).not.toHaveTextContent("Narita");
    expect(nrt).toHaveTextContent("Peach");
    expect(nrt).toHaveTextContent("Save 45%");
    expect(nrt).toHaveTextContent("4 fares");
    expect(nrt).not.toHaveTextContent(/Nonstop/);
    await user.click(within(nrt).getByRole("button"));
    expect(nrt).toHaveTextContent("Peach · Nonstop · 4 fares");
    expect(rowsOf(nrt)[0]).toHaveAttribute("href", expect.stringContaining("lang=en"));
    expect(rowsOf(nrt)[0]).toHaveTextContent("12/10–12/14");
    expect(rowsOf(nrt)[0]).toHaveTextContent("From Taoyuan · Peach · Nonstop");
    expect(rowsOf(nrt)[2]).toHaveTextContent("From Kaohsiung · Tigerair Taiwan · 1 stop");
    expect(
      screen.getByText(
        "Tap a date to open Trip.com · Reference prices refresh daily at 08:00; the booking page is final",
      ),
    ).toBeVisible();
  });

  it("uses singular English counts: 1 fare, 2 stops", async () => {
    const user = userEvent.setup();
    const { api } = setup();
    setItems(api, [fare("only", { dest: "ICN", region: "kr", priceTwd: 6000, transfers: 2 })]);
    await screen.findAllByRole("heading", { level: 2 });
    await user.click(screen.getByRole("button", { name: "切換為英文" }));
    await screen.findByRole("heading", { level: 1, name: "Where to fly today?" });
    expect(pageCount()).toHaveTextContent(/^1 fare$/);
    expect(cityHeadings()[0]).toHaveTextContent("1 fare");
    expect(cityHeadings()[0]).toHaveTextContent("China Airlines");
    await user.click(within(cityHeadings()[0] as HTMLElement).getByRole("button"));
    expect(rowsOf(cityHeadings()[0] as HTMLElement)[0]).toHaveTextContent("2 stops");
    expect(screen.queryByText(/1 fares/)).toBeNull();
  });

  it("uses singular English stops: 1 stop across two fares of one destination", async () => {
    const user = userEvent.setup();
    const { api } = setup();
    setItems(api, [
      fare("a", { dest: "ICN", region: "kr", priceTwd: 6000, transfers: 1 }),
      fare("b", { dest: "ICN", region: "kr", transfers: 1, priceTwd: 9000 }),
    ]);
    await screen.findAllByRole("heading", { level: 2 });
    await user.click(screen.getByRole("button", { name: "切換為英文" }));
    await screen.findByRole("heading", { level: 1, name: "Where to fly today?" });
    expect(pageCount()).toHaveTextContent(/^2 fares$/);
    await user.click(within(cityHeadings()[0] as HTMLElement).getByRole("button"));
    expect(rowsOf(cityHeadings()[0] as HTMLElement)).toHaveLength(2);
    expect(rowsOf(cityHeadings()[0] as HTMLElement)[0]).toHaveTextContent("1 stop");
  });

  it("renders inside AppShell when signed in with the title and note only, and supports inline region tabs + empty reset", async () => {
    const user = userEvent.setup();
    setup("/flights", makeUser("小宇"));

    const title = await screen.findByRole("heading", { level: 1, name: "今天想飛去哪？" });
    const header = title.closest("header") as HTMLElement;
    expect(within(header).getByText("BETA")).toBeVisible();
    expect(within(header).getByText("每天 08:00 更新")).toBeVisible();
    // AppShell keeps its own navigation: no logo, language toggle or sign-in in the page header
    expect(within(header).queryByRole("link")).toBeNull();
    expect(within(header).queryByRole("button")).toBeNull();
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

  describe("Long-haul sub-region and country filters", () => {
    const longhaul = (id: string, dest: string, priceTwd: number) =>
      fare(id, { dest, region: "longhaul", priceTwd, airlines: ["BR"] });
    const LONGHAUL_FLIGHTS = [
      longhaul("fco", "FCO", 30000),
      longhaul("vce", "VCE", 31000),
      longhaul("cdg", "CDG", 32000),
      longhaul("lax", "LAX", 28000),
      longhaul("ord", "ORD", 29000),
      longhaul("per", "PER", 20000),
      longhaul("dxb", "DXB", 25000),
    ];

    async function openFilters(user: ReturnType<typeof userEvent.setup>) {
      await user.click(screen.getByRole("button", { name: /^篩選/ }));
      return screen.findByRole("dialog", { name: "篩選條件" });
    }

    async function openLonghaul() {
      const user = userEvent.setup();
      const { api } = setup();
      setItems(api, [...SAMPLE_FLIGHTS, ...LONGHAUL_FLIGHTS]);
      await screen.findAllByRole("heading", { level: 2 });
      const dialog = await openFilters(user);
      expect(within(dialog).queryByText("長程地區")).toBeNull();
      await user.click(within(dialog).getByRole("button", { name: /Close|關閉/ }));
      await user.click(
        within(screen.getByRole("group", { name: "目的地" })).getByRole("button", { name: "長程" }),
      );
      return { user, dialog: await openFilters(user) };
    }

    it("shows the group only for the Long-haul tab", async () => {
      const { dialog } = await openLonghaul();
      expect(within(dialog).getByText("長程地區")).toBeVisible();
      expect(within(dialog).getByText("國家")).toBeVisible();
    });

    it("narrows cards by sub-region then country, counts them as active filters, and clears them on reset", async () => {
      const { user, dialog } = await openLonghaul();

      await user.click(within(dialog).getByRole("button", { name: /^歐洲/ }));
      // Countries narrow to the sub-region: Italy and France, not the US or Australia
      expect(within(dialog).getByRole("button", { name: /^義大利/ })).toBeVisible();
      expect(within(dialog).getByRole("button", { name: /^法國/ })).toBeVisible();
      expect(within(dialog).queryByRole("button", { name: /^美國/ })).toBeNull();
      await user.click(within(dialog).getByRole("button", { name: /^義大利/ }));
      await user.click(within(dialog).getByRole("button", { name: /查看 2 筆機票/ }));

      // FCO + VCE: two cities, with the filter badge counting both new filters
      expect(cityHeadings()).toHaveLength(2);
      expect(pageCount()).toHaveTextContent(/^2 筆$/);
      expect(within(screen.getByRole("button", { name: /^篩選/ })).getByText("2")).toBeVisible();

      const again = await openFilters(user);
      await user.click(within(again).getByRole("button", { name: /重設/ }));
      await user.click(within(again).getByRole("button", { name: /查看 7 筆機票/ }));
      expect(cityHeadings()).toHaveLength(7);
      expect(within(screen.getByRole("button", { name: /^篩選/ })).queryByText("2")).toBeNull();
    });

    it("clears a country that the new sub-region does not contain", async () => {
      const { user, dialog } = await openLonghaul();
      await user.click(within(dialog).getByRole("button", { name: /^美國/ }));
      await user.click(within(dialog).getByRole("button", { name: /^大洋洲/ }));

      expect(within(dialog).getByRole("button", { name: /^澳洲/ })).toBeVisible();
      expect(within(dialog).queryByRole("button", { name: /^美國/ })).toBeNull();
      await user.click(within(dialog).getByRole("button", { name: /查看 1 筆機票/ }));
      expect(cityHeadings()).toHaveLength(1);
      expect(cityHeadings()[0]).toHaveTextContent("伯斯");
    });

    it("drops the filters when leaving the Long-haul tab", async () => {
      const { user, dialog } = await openLonghaul();
      await user.click(within(dialog).getByRole("button", { name: /^歐洲/ }));
      await user.click(within(dialog).getByRole("button", { name: /Close|關閉/ }));
      await user.click(
        within(screen.getByRole("group", { name: "目的地" })).getByRole("button", { name: "全部" }),
      );
      expect(within(screen.getByRole("button", { name: /^篩選/ })).queryByText("1")).toBeNull();
      expect(cityHeadings().length).toBeGreaterThan(7);
    });
  });

  it("explains an empty one-way view and offers a way back to round trips", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findAllByRole("heading", { level: 2 });
    const trip = screen.getByRole("group", { name: "行程" });
    await user.click(within(trip).getByRole("button", { name: "單程" }));
    await user.click(
      within(screen.getByRole("group", { name: "目的地" })).getByRole("button", { name: "日本" }),
    );

    // Japan has round trips on the board but no one-way fares
    expect(
      await screen.findByRole("heading", { level: 2, name: "這個地區目前沒有單程票" }),
    ).toBeVisible();
    expect(screen.getByText("單程票只有少數幾筆，改看來回票或換個地區試試。")).toBeVisible();
    expect(screen.queryByRole("button", { name: "重設篩選" })).toBeNull();
    expect(pageCount()).toHaveTextContent(/^0 筆$/);

    await user.click(screen.getByRole("button", { name: "改看來回" }));
    expect(within(trip).getByRole("button", { name: "來回" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(await screen.findByRole("heading", { level: 2, name: /東京/ })).toBeVisible();
    expect(screen.queryByText("這個地區目前沒有單程票")).toBeNull();
  });

  it("shows the one-way empty state in English", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findAllByRole("heading", { level: 2 });
    await user.click(screen.getByRole("button", { name: "切換為英文" }));
    await screen.findByRole("heading", { level: 1, name: "Where to fly today?" });
    await user.click(
      within(screen.getByRole("group", { name: "Trip" })).getByRole("button", { name: "One-way" }),
    );
    await user.click(
      within(screen.getByRole("group", { name: "Region" })).getByRole("button", { name: "Japan" }),
    );

    expect(
      await screen.findByRole("heading", { level: 2, name: "No one-way fares here right now" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Show round trips" })).toBeVisible();
  });

  it("shows the generic empty state with a reset when drawer filters remove every fare", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findAllByRole("heading", { level: 2 });
    await user.click(screen.getByRole("button", { name: /篩選/ }));
    const dialog = await screen.findByRole("dialog", { name: "篩選條件" });
    await user.click(within(dialog).getByRole("button", { name: /台南 TNN\s*0/ }));
    await user.click(within(dialog).getByRole("button", { name: /查看 0 筆機票/ }));

    expect(await screen.findByText("目前沒有符合條件的低價機票")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "重設篩選" }));
    expect(await screen.findByRole("heading", { level: 2, name: /東京/ })).toBeVisible();
    expect(within(screen.getByRole("button", { name: /篩選/ })).queryByText("1")).toBeNull();
  });

  it("lays out the signed-out header as logo + title + BETA, then the note with EN and 登入, and localizes filter sheet Close", async () => {
    const user = userEvent.setup();
    renderApp({ path: "/flights" });

    const header = await screen.findByRole("banner");
    expect(within(header).queryByRole("link", { name: /低價機票/ })).toBeNull();
    // Row 1: 40px mascot link (name is its aria-label, not visible text) + title + BETA
    const title = within(header).getByRole("heading", { level: 1, name: "今天想飛去哪？" });
    const logo = within(header).getByRole("link", { name: "小芽" });
    expect(logo).toHaveAttribute("href", "/");
    expect(logo.querySelector("svg")).toHaveClass("size-10");
    expect(within(header).queryByText("小芽")).toBeNull();
    expect(within(header).queryByText("LOGO")).toBeNull();
    expect(within(header).getByText("BETA")).toBeVisible();
    // Row 2: update note left, EN and 登入 right
    const note = within(header).getByText("每天 08:00 更新");
    const lang = within(header).getByRole("button", { name: "切換為英文" });
    expect(lang).toHaveTextContent("EN");
    expect(lang.className).toMatch(/rounded-full.*border-\[1\.5px\].*border-fl-hair.*bg-white/);
    expect(lang.className).toContain("min-h-10");
    expect(lang.className).toContain("after:-inset-y-[3.5px]");
    const login = within(header).getByRole("link", { name: "登入" });
    expect(login).toHaveAttribute("href", "/sign-in");
    expect(login.className).toMatch(/rounded-full.*bg-fl-green.*font-bold.*text-white.*shadow-/);
    expect(login.className).toContain("min-h-10");
    expect(login.className).toContain("after:-inset-y-0.5");
    const after = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(title.compareDocumentPosition(note) & after).toBeTruthy();
    expect(note.compareDocumentPosition(lang) & after).toBeTruthy();
    expect(lang.compareDocumentPosition(login) & after).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);

    await user.click(await screen.findByRole("button", { name: /篩選/ }));
    expect(await screen.findByRole("button", { name: "關閉篩選" })).toBeVisible();
  });

  it("never ellipsizes the expanded date or detail lines and keeps the price column from shrinking", async () => {
    const user = userEvent.setup();
    setup();

    const firstCard = (await screen.findAllByRole("heading", { level: 2 }))[0] as HTMLElement;
    await user.click(within(firstCard).getByRole("button"));
    const row = rowsOf(firstCard)[0] as HTMLElement;
    for (const line of [".fare-row-date", ".fare-row-detail"]) {
      const el = row.querySelector(line) as HTMLElement;
      expect(el).not.toHaveClass("truncate");
      expect(el).not.toHaveClass("whitespace-nowrap");
    }
    expect(row.querySelector(".fare-row-detail")).toHaveClass("flex-wrap");
    const priceColumn = within(row).getByText("NT$").closest("span.flex-col")?.parentElement;
    expect(priceColumn).toHaveClass("shrink-0");
    // The 28px circular external-link icon is decoration
    expect(row.querySelector('span[aria-hidden="true"].size-7')).not.toBeNull();
  });

  it("prevents mobile grid/sheet clipping and shows only the update date in the footer", async () => {
    const user = userEvent.setup();
    setup();

    const firstCard = (await screen.findAllByRole("heading", { level: 2 }))[0] as HTMLElement;
    const list = firstCard.closest("ul");
    const listItem = firstCard.closest("li");
    expect(list).toHaveClass("grid-cols-1", "md:grid-cols-2");
    expect(listItem).toHaveClass("min-w-0");
    // City shrinks/truncates inside the row; the route chip stays intact and wraps instead of collapsing
    const city = firstCard.querySelector(".flight-card-city");
    expect(city?.className).toContain("truncate");
    expect(city).toHaveClass("min-w-0", "max-w-full");
    expect(city).not.toHaveClass("shrink-0");
    expect(firstCard.querySelector(".flight-card-route")).toHaveClass("shrink-0");
    expect(firstCard.querySelector(".flight-card-route")).not.toHaveClass("truncate");
    expect(firstCard.querySelector(".flight-card-route")?.parentElement).toHaveClass("flex-wrap");
    // Airline ellipsizes before it can push the price column; the price column never shrinks
    expect(within(firstCard).getByText("樂桃航空").className).toContain("truncate");
    expect(within(firstCard).getByText("NT$").closest("span.flex-col")).toHaveClass("shrink-0");
    // Footer carries only the digest date (no tagline, no disclaimer)
    expect(screen.getByText("11/16 更新")).toBeVisible();
    expect(screen.queryByText(/參考價格為浮動/)).toBeNull();

    await user.click(screen.getByRole("button", { name: /篩選/ }));
    const dialog = await screen.findByRole("dialog", { name: "篩選條件" });
    expect(dialog.className).toMatch(/max-h-\[82dvh\].*rounded-t-\[28px\].*bg-fl-paper/);
    expect(dialog.querySelector(".h-\\[5px\\].w-11")).not.toBeNull();
    const closeBtn = within(dialog).getByRole("button", { name: "關閉篩選" });
    expect(closeBtn).toHaveClass("size-11", "rounded-full", "bg-fl-track");
    const applyBtn = within(dialog).getByRole("button", { name: /查看 \d+ 筆機票/ });
    expect(applyBtn.className).toMatch(/min-h-\[50px\].*flex-1.*bg-fl-green/);
    const resetBtn = within(dialog).getByRole("button", { name: "重設" });
    expect(resetBtn.className).toMatch(/min-h-\[50px\].*border-\[#cbd5e1\]/);
    const footer = applyBtn.closest("div");
    const scrollableBody = footer?.previousElementSibling;
    expect(footer).toHaveClass("shrink-0");
    expect(footer?.className).toContain("env(safe-area-inset-bottom)");
    expect(resetBtn).toBeVisible();
    expect(scrollableBody).toHaveClass("min-h-0", "flex-1", "overflow-y-auto");

    // Group order: mock groups first, then the kept 目的地 / 航空公司, then 預算
    const groups = [...(scrollableBody as HTMLElement).querySelectorAll('[role="group"]')];
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual([
      "出發地",
      "出發月份",
      "直飛 / 轉機",
      "目的地",
      "航空公司",
      "預算上限",
    ]);
    const origins = within(groups[0] as HTMLElement).getAllByRole("button");
    expect(origins.map((b) => b.textContent.replace(/\d+$/, ""))).toEqual([
      "全部",
      "桃園 TPE",
      "松山 TSA",
      "高雄 KHH",
      "台中 RMQ",
      "台南 TNN",
    ]);
    const chip = within(dialog).getByRole("button", { name: /^桃園 TPE/ });
    expect(chip.className).toMatch(/min-h-10.*rounded-full.*border-\[1\.5px\]/);
    expect(chip.className).toContain("px-[15px]");
    expect(
      within(groups[0] as HTMLElement).getByRole("button", { name: /^全部/ }).className,
    ).toMatch(/border-fl-green.*bg-fl-tint.*font-bold.*text-fl-green/);
    expect(within(dialog).getByRole("button", { name: /^東京\s*4$/ })).toBeVisible();
    expect(within(dialog).queryByRole("button", { name: /東京成田|東京羽田|大阪關西/ })).toBeNull();
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
