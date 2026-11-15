import type { DailyFlightItem } from "@split/shared";
import { screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { makeUser } from "../../test/fake-api.js";
import { renderApp } from "../../test/render-app.js";

const SAMPLE_FLIGHTS: DailyFlightItem[] = [
  {
    id: "nrt-deal",
    origin: "TPE",
    dest: "NRT",
    region: "jp",
    tripType: "rt",
    outDate: "2026-12-10",
    inDate: "2026-12-14",
    priceTwd: 5680,
    discountPct: 38,
    tag: "steal",
    airlines: ["MM"],
    transfers: 0,
    returnTransfers: 0,
    isRedEye: true,
    outboundDep: "02:15",
    inboundDep: "07:10",
  },
  {
    id: "kix-holiday",
    origin: "KHH",
    dest: "KIX",
    region: "jp",
    tripType: "rt",
    outDate: "2027-02-26",
    inDate: "2027-03-02",
    priceTwd: 8900,
    discountPct: 21,
    tag: "below_market",
    airlines: ["IT"],
    transfers: 0,
    returnTransfers: 0,
    isRedEye: false,
    outboundDep: "11:20",
    inboundDep: "16:15",
  },
  {
    id: "icn-ow",
    origin: "TPE",
    dest: "ICN",
    region: "kr",
    tripType: "ow",
    outDate: "2026-12-18",
    inDate: null,
    priceTwd: 4100,
    discountPct: 21,
    tag: "below_market",
    airlines: ["KE"],
    transfers: 1,
    returnTransfers: null,
    isRedEye: false,
    outboundDep: "13:05",
    inboundDep: null,
  },
];

describe("daily flights page", () => {
  it("puts sort alongside region tabs, hides holiday tags, supports concise Sprout filters, and switches to English", async () => {
    const user = userEvent.setup();
    const { api, router } = renderApp({ path: "/flights" });
    api.dailyFlights = {
      date: "2026-11-16",
      updatedAt: "2026-11-16T01:00:00.000Z",
      items: SAMPLE_FLIGHTS,
      isFallback: false,
    };

    const heading = await screen.findByRole("heading", { level: 1, name: "今日低價機票" });
    expect(heading).toBeVisible();
    expect(within(heading.closest("header") as HTMLElement).getByText("BETA")).toBeVisible();
    expect(router.state.location.pathname).toBe("/flights");
    expect(screen.queryByRole("navigation", { name: "側邊導覽" })).toBeNull();

    // Grey descriptive subtitle removed; compact header metadata present
    expect(screen.queryByText(/自動剔除幽靈票/)).toBeNull();
    expect(screen.getByText(/11\/16 更新/)).toBeVisible();

    // SVG country flags, soft-mint airport pills, friendly origin + duration subtitle, red-eye cue, zero holiday/clock clutter
    expect(document.querySelectorAll('svg[data-country="JP"]').length).toBe(2);
    expect(document.querySelectorAll('svg[data-country="KR"]').length).toBe(1);
    expect(screen.getByText("紅眼")).toBeVisible();
    expect(screen.getByText("省 38%")).toBeVisible();
    expect(screen.queryByText(/連假/)).toBeNull();
    expect(screen.getByText(/TPE\s*⇄\s*NRT/)).toBeVisible();
    expect(screen.getByText(/KHH\s*⇄\s*KIX/)).toBeVisible();
    expect(screen.getByText(/TPE\s*→\s*ICN/)).toBeVisible();
    expect(screen.getByText("02/26 高雄出發 · 5天4夜 · 直飛")).toBeVisible();
    expect(screen.queryByText(/02:15|11:20|13:05/)).toBeNull();
    // Prominent large price + smaller secondary savings percentage
    const nrtPrice = within(screen.getByRole("link", { name: /東京成田/ })).getByText("5,680");
    expect(nrtPrice.className).toContain("text-2xl");
    expect(screen.getByText("省 38%").className).toContain("text-[11px]");

    // Region tabs & compact borderless Sort share the single non-wrapping top bar row
    const topBar = screen.getByTestId("flights-top-bar");
    expect(topBar.className).toContain("flex-nowrap");
    const regionGroup = within(topBar).getByRole("group", { name: "目的地" });
    expect(regionGroup.className).toContain("scroll-fade-x");
    const allRegionBtn = within(regionGroup).getByRole("button", { name: "全部地區" });
    expect(allRegionBtn.className).toContain("press-pill");
    expect(allRegionBtn.querySelector(".bg-sprout-500")).not.toBeNull();

    const sortGroup = within(topBar).getByRole("group", { name: "排序" });
    const priceSortBtn = within(sortGroup).getByRole("button", { name: /價格/ });
    const discountSortBtn = within(sortGroup).getByRole("button", { name: /降幅/ });
    expect(priceSortBtn).toHaveAccessibleName("依價格排序（目前由低到高）");
    expect(discountSortBtn).toHaveAccessibleName("依降幅排序");
    expect(screen.getAllByRole("heading", { level: 2 })[0]).toHaveTextContent("首爾仁川");
    await user.click(priceSortBtn);
    expect(priceSortBtn).toHaveAccessibleName("依價格排序（目前由高到低）");
    expect(screen.getAllByRole("heading", { level: 2 })[0]).toHaveTextContent("大阪關西");
    await user.click(discountSortBtn);
    expect(discountSortBtn).toHaveAccessibleName("依降幅排序（目前由高到低）");
    expect(screen.getAllByRole("heading", { level: 2 })[0]).toHaveTextContent("東京成田");
    await user.click(discountSortBtn);
    expect(discountSortBtn).toHaveAccessibleName("依降幅排序（目前由低到高）");
    expect(screen.getAllByRole("heading", { level: 2 })[0]).not.toHaveTextContent("東京成田");
    await user.click(priceSortBtn);
    expect(priceSortBtn).toHaveAccessibleName("依價格排序（目前由低到高）");
    expect(screen.getAllByRole("heading", { level: 2 })[0]).toHaveTextContent("首爾仁川");

    const icnCard = screen.getByRole("link", { name: /首爾仁川/ });
    expect(icnCard).toHaveAttribute(
      "href",
      "/api/v1/flights/go?origin=TPE&dest=ICN&outDate=2026-12-18&tripType=ow&lang=zh-TW",
    );
    expect(icnCard.textContent).not.toMatch(/Trip\.com/i);

    // Quick inline Row 3 toggles ("來回", "單程", "只看直飛") work without opening drawer
    const roundTripBtn = screen.getByRole("button", { name: "來回" });
    await user.click(roundTripBtn);
    expect(screen.queryByText("首爾仁川")).toBeNull();
    expect(screen.getByText("東京成田")).toBeVisible();
    await user.click(roundTripBtn);
    expect(screen.getByText("首爾仁川")).toBeVisible();

    const directToggle = screen.getByRole("button", { name: "只看直飛" });
    await user.click(directToggle);
    expect(screen.queryByText("首爾仁川")).toBeNull();
    expect(screen.getByText("東京成田")).toBeVisible();
    await user.click(directToggle);
    expect(screen.getByText("首爾仁川")).toBeVisible();

    // Open Filter Drawer (Origin, Destination, Month, Airline, Stops, Budget, Extras with live counts; no holidays)
    await user.click(screen.getByRole("button", { name: /篩選/ }));
    const dialog = await screen.findByRole("dialog", { name: "篩選條件" });
    expect(dialog).toHaveClass("dialog-content", "dialog-sheet");
    expect(within(dialog).queryByText(/連假/)).toBeNull();
    expect(within(dialog).getByRole("button", { name: /桃園\s*2/ })).toBeVisible();
    expect(within(dialog).getByRole("group", { name: "目的地" })).toBeVisible();
    expect(within(dialog).getByRole("group", { name: "出發月份" })).toBeVisible();
    expect(within(dialog).getByRole("group", { name: "航空公司" })).toBeVisible();

    // Filter by Airline (樂桃航空 -> NRT only), then Reset
    await user.click(within(dialog).getByRole("button", { name: /樂桃航空\s*1/ }));
    await user.click(within(dialog).getByRole("button", { name: /查看 1 筆機票/ }));
    expect(screen.getByText("東京成田")).toBeVisible();
    expect(screen.queryByText("大阪關西")).toBeNull();
    expect(screen.queryByText("首爾仁川")).toBeNull();

    // Re-open, Reset, and filter by Month (2026年12月 -> NRT + ICN) and Destination (首爾仁川 -> ICN)
    await user.click(screen.getByRole("button", { name: /篩選/ }));
    const dialogMonth = await screen.findByRole("dialog", { name: "篩選條件" });
    await user.click(within(dialogMonth).getByRole("button", { name: "重設" }));
    await user.click(within(dialogMonth).getByRole("button", { name: /2026年12月\s*2/ }));
    await user.click(within(dialogMonth).getByRole("button", { name: /首爾仁川\s*1/ }));
    await user.click(within(dialogMonth).getByRole("button", { name: /查看 1 筆機票/ }));
    expect(screen.getByText("首爾仁川")).toBeVisible();
    expect(screen.queryByText("大阪關西")).toBeNull();
    expect(screen.queryByText("東京成田")).toBeNull();

    // Reset and filter by Origin (高雄 -> KIX)
    await user.click(screen.getByRole("button", { name: /篩選/ }));
    const dialogOrigin = await screen.findByRole("dialog", { name: "篩選條件" });
    await user.click(within(dialogOrigin).getByRole("button", { name: "重設" }));
    await user.click(within(dialogOrigin).getByRole("button", { name: /高雄\s*1/ }));
    await user.click(within(dialogOrigin).getByRole("button", { name: /查看 1 筆機票/ }));
    expect(screen.getByText("大阪關西")).toBeVisible();
    expect(screen.queryByText("東京成田")).toBeNull();

    // Reset drawer -> filter by $5,000 budget + exclude red-eye -> only ICN
    await user.click(screen.getByRole("button", { name: /篩選/ }));
    const dialog2 = await screen.findByRole("dialog", { name: "篩選條件" });
    await user.click(within(dialog2).getByRole("button", { name: "重設" }));
    await user.click(within(dialog2).getByRole("button", { name: /排除紅眼/ }));
    await user.click(within(dialog2).getByRole("button", { name: /\$5,000 以下/ }));
    await user.click(within(dialog2).getByRole("button", { name: /查看 1 筆機票/ }));
    expect(screen.getByText("首爾仁川")).toBeVisible();
    expect(screen.queryByText("東京成田")).toBeNull();
    expect(screen.queryByText("大阪關西")).toBeNull();

    // Reset drawer -> verify toggling direct-only preserves existing <li> DOM nodes without remounting .rise
    await user.click(screen.getByRole("button", { name: /篩選/ }));
    const dialog3 = await screen.findByRole("dialog", { name: "篩選條件" });
    await user.click(within(dialog3).getByRole("button", { name: "重設" }));
    await user.click(within(dialog3).getByRole("button", { name: /查看 3 筆機票/ }));
    const nrtListItemBefore = screen.getByRole("link", { name: /東京成田/ }).closest("li");
    await user.click(screen.getByRole("button", { name: "只看直飛" }));
    const nrtListItemAfter = screen.getByRole("link", { name: /東京成田/ }).closest("li");
    expect(nrtListItemAfter).toBe(nrtListItemBefore);
    expect(document.querySelector(".flight-deal-dot")).toBeNull();

    // Switch language to English -> labels & redirect links switch cleanly without Trip.com text
    await user.click(screen.getByRole("button", { name: "切換為英文" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Today's Cheap Flights" }),
    ).toBeVisible();
    const icnCardEn = screen.getByRole("link", { name: /Seoul Incheon/ });
    expect(icnCardEn).toHaveAttribute(
      "href",
      "/api/v1/flights/go?origin=TPE&dest=ICN&outDate=2026-12-18&tripType=ow&lang=en",
    );
    expect(icnCardEn.textContent).not.toMatch(/Trip\.com/i);
  });

  it("renders inside AppShell when signed in and supports inline region chips + empty reset", async () => {
    const user = userEvent.setup();
    const { api } = renderApp({ path: "/flights", cookieUser: makeUser("小宇") });
    api.dailyFlights = {
      date: "2026-11-16",
      updatedAt: "2026-11-16T01:00:00.000Z",
      items: SAMPLE_FLIGHTS,
      isFallback: false,
    };

    expect(await screen.findByRole("heading", { level: 1, name: "今日低價機票" })).toBeVisible();
    const bottomNav = screen.getByRole("navigation", { name: "底部導覽" });
    expect(within(bottomNav).getByRole("link", { name: "機票" })).toHaveAttribute(
      "href",
      "/flights",
    );

    // Inline region chips directly on page -> click HKMO -> empty state -> reset
    const regionGroup = screen.getByRole("group", { name: "目的地" });
    await user.click(within(regionGroup).getByRole("button", { name: "港澳" }));
    expect(await screen.findByText("目前沒有符合條件的低價機票")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "重設篩選" }));
    expect(await screen.findByText("東京成田")).toBeVisible();
  });

  it("keeps signed-out PublicHeader free of a redundant flights link and localizes filter drawer Close", async () => {
    const user = userEvent.setup();
    renderApp({ path: "/flights" });

    const header = await screen.findByRole("banner");
    expect(within(header).queryByRole("link", { name: /低價機票/ })).toBeNull();

    await user.click(await screen.findByRole("button", { name: /篩選/ }));
    expect(await screen.findByRole("button", { name: "關閉篩選" })).toBeVisible();
  });
});
