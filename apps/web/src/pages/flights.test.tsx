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
  it("allows signed-out visitors to browse deals, toggle filters/red-eye, and switch to English", async () => {
    const user = userEvent.setup();
    const { api, router } = renderApp({ path: "/flights" });
    api.dailyFlights = {
      date: "2026-11-16",
      updatedAt: "2026-11-16T01:00:00.000Z",
      items: SAMPLE_FLIGHTS,
      isFallback: false,
    };

    expect(await screen.findByRole("heading", { level: 1, name: "今日低價機票" })).toBeVisible();
    expect(router.state.location.pathname).toBe("/flights");
    expect(screen.queryByRole("navigation", { name: "側邊導覽" })).toBeNull();

    // Red-eye badge, departure times, deal tag, holiday, and bilingual booking URL are visible
    expect(screen.getByText("🌙 紅眼")).toBeVisible();
    expect(screen.getByText("🔥 神價 ↓38%")).toBeVisible();
    expect(screen.getByText("🕊️ 228連假")).toBeVisible();
    expect(screen.getByText(/02:15 \/ 07:10/)).toBeVisible();
    expect(screen.getByText(/13:05/)).toBeVisible();

    const bookLinks = screen.getAllByRole("link", { name: /去 Trip\.com 訂票/ });
    expect(bookLinks[0]).toHaveAttribute(
      "href",
      "/api/v1/flights/go?origin=TPE&dest=ICN&outDate=2026-12-18&tripType=ow&lang=zh-TW",
    );

    // Filter by month chip -> narrows to KIX in 2027-02, then reset via 全部月份
    await user.click(screen.getByRole("button", { name: "2027-02" }));
    expect(screen.getByText("大阪關西")).toBeVisible();
    expect(screen.queryByText("東京成田")).toBeNull();
    await user.click(screen.getByRole("button", { name: "全部月份" }));
    expect(screen.getByText("東京成田")).toBeVisible();

    // Filter by holiday only -> narrows to KIX
    await user.click(screen.getByRole("button", { name: "只看連假" }));
    expect(screen.getByText("大阪關西")).toBeVisible();
    expect(screen.queryByText("東京成田")).toBeNull();
    expect(screen.queryByText("首爾仁川")).toBeNull();

    // Switch language to English -> labels & booking links become English
    await user.click(screen.getByRole("button", { name: "切換為英文" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Today's Cheap Flights" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Holidays only" }));
    expect(screen.getByText("Osaka Kansai")).toBeVisible();
    expect(screen.getByRole("link", { name: /Book on Trip\.com/ })).toHaveAttribute(
      "href",
      "/api/v1/flights/go?origin=KHH&dest=KIX&outDate=2027-02-26&tripType=rt&lang=en&inDate=2027-03-02",
    );
  });

  it("renders inside AppShell when signed in and supports region/sort and empty reset", async () => {
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

    // Default sort by lowest price puts ICN NT$ 4,100 before NRT NT$ 5,680; switching to discount puts NRT first
    await user.click(screen.getByRole("button", { name: "降幅最多" }));
    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings[0]).toHaveTextContent("東京成田");

    // Combine filters -> empty state -> reset
    await user.click(screen.getByRole("button", { name: "港澳" }));
    expect(await screen.findByText("目前沒有符合條件的低價機票")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "重設篩選" }));
    expect(await screen.findByText("東京成田")).toBeVisible();
  });
});
