import { expect, type Page, test } from "@playwright/test";

// Layout a jsdom test cannot see: the board's desktop grid and the Nonstop Fare line, on a fixed board.
const fare = (
  id: string,
  dest: string,
  priceTwd: number,
  transfers: number,
  outDate: string,
  inDate: string,
) => ({
  id,
  origin: "TPE",
  dest,
  region: "longhaul",
  outDate,
  inDate,
  priceTwd,
  discountPct: 20,
  tag: "below_market",
  airlines: ["UA"],
  transfers,
});

const BOARD = {
  date: "2026-11-26",
  updatedAt: "2026-11-26T00:00:00Z",
  items: [
    fare("spn", "SPN", 17836, 1, "2026-12-05", "2026-12-12"),
    fare("sea", "SEA", 21924, 1, "2026-12-10", "2026-12-17"),
    fare("sea-nonstop", "SEA", 22654, 0, "2027-02-18", "2027-02-24"),
  ],
};

const cardBox = async (page: Page, city: string) => {
  const box = await page.locator(".flight-card").filter({ hasText: city }).boundingBox();
  if (box === null) throw new Error(`No City Card for ${city}`);
  return { top: Math.round(box.y), bottom: Math.round(box.y + box.height) };
};

test.describe("Daily Flights board (desktop)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test.beforeEach(async ({ page }) => {
    await page.route("**/api/v1/flights/daily", (route) => route.fulfill({ json: BOARD }));
    await page.goto("/flights");
    await expect(page.getByRole("heading", { name: /西雅圖/ })).toBeVisible();
  });

  test("collapsed cards in a row share a height; an open card's neighbour keeps its own", async ({
    page,
  }) => {
    // Seattle's Nonstop Fare line makes it the taller card; Saipan beside it stretches to match.
    const seattle = await cardBox(page, "西雅圖");
    expect(await cardBox(page, "塞班")).toEqual(seattle);

    await page.getByRole("button", { name: /塞班/ }).click();
    const saipanOpen = await cardBox(page, "塞班");
    expect(saipanOpen.bottom).toBeGreaterThan(seattle.bottom);
    expect(await cardBox(page, "西雅圖")).toEqual(seattle);
  });

  test("the Nonstop Fare line opens Trip.com filtered to nonstop flights on its own dates", async ({
    page,
  }) => {
    const href = await page.getByRole("link", { name: /^直飛 NT\$22,654/ }).getAttribute("href");
    const url = new URL(href ?? "", "http://localhost");
    expect(url.pathname).toBe("/api/v1/flights/go");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      origin: "TPE",
      dest: "SEA",
      outDate: "2027-02-18",
      inDate: "2027-02-24",
      lang: "zh-TW",
      nonstopOnly: "1",
    });
  });
});
