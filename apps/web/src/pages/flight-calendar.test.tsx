import { readFileSync } from "node:fs";
import { flightSearchRequestSchema, type FlightSearchIntent } from "@split/shared";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { contrast } from "../../test/contrast.js";
import { makeUser } from "../../test/fake-api.js";
import { openSearchPanel } from "../../test/flight-panel.js";
import { renderApp } from "../../test/render-app.js";

const css = readFileSync("src/styles.css", "utf8"); // vitest runs with apps/web as cwd
const color = (name: string) =>
  new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, "i").exec(css)?.[1] ?? "#ffffff";

const intent: FlightSearchIntent = {
  origin: "TPE",
  destination: "OKA",
  departureDate: "2027-01-08",
  returnDate: "2027-01-11",
  currency: "TWD",
  excludeRedEye: false,
  directOnly: false,
};
const fare = {
  price: 21000,
  airline: "Example Air",
  outboundDeparture: "08:00",
  outboundArrival: "12:00",
  inboundDeparture: null,
  inboundArrival: null,
  stops: 0,
  durationMinutes: 180,
  priceLevel: "low" as const,
};
/** Jan 2 to 11 saved; the cheapest three-tenths (Jan 2 to 5) are the cheap days. */
const saved = [9000, 9500, 12000, 12500, 13000, 13500, 14000, 15000, 16000, 17000].map(
  (price, n) => ({
    date: `2027-01-${String(n + 2).padStart(2, "0")}`,
    price,
    fetchedAt: Date.now(),
  }),
);

async function setup(language: "en" | "zh-TW" = "en", snapshots = saved) {
  const app = renderApp({ path: "/travel/flights", cookieUser: { ...makeUser("Rick"), language } });
  app.api.flightPromptIntent = intent;
  app.api.flightFares = [fare];
  app.api.flightPriceStrip = snapshots;
  fireEvent.change(
    await screen.findByLabelText(language === "en" ? "Where would you like to go?" : "想去哪裡？"),
    { target: { value: "okinawa" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: language === "en" ? "Explore flights" : "探索航班" }),
  );
  await screen.findByText("Example Air");
  await openSearchPanel();
  return app;
}
const toggle = () =>
  screen.getByRole("button", {
    name: /^(Pick dates on a calendar|Close calendar|用日曆選日期|收起日曆)$/,
  });
const openCalendar = async () => {
  fireEvent.click(toggle());
  return screen.findByRole("group", { name: /^Calendar|^日曆/ });
};
const day = (calendar: HTMLElement, name: RegExp | string) =>
  within(calendar).getByRole("button", { name });
const searches = (app: Awaited<ReturnType<typeof setup>>) =>
  app.api.requests.filter((r) => r.route === "POST /api/v1/flights/search");

afterEach(() => {
  vi.useRealTimers();
});

describe("Calendar picker", () => {
  it("opens on the departure month with the range marked and a close toggle", async () => {
    await setup();
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("group", { name: "Calendar" })).toBeNull();
    const calendar = await openCalendar();
    expect(toggle()).toHaveAccessibleName("Close calendar");
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(within(calendar).getByText("January 2027")).toBeVisible();
    expect(day(calendar, /^Jan 8/)).toHaveAttribute("aria-pressed", "true");
    expect(day(calendar, /^Jan 11/)).toHaveAttribute("aria-pressed", "true");
    expect(day(calendar, /^Jan 9/)).toHaveAttribute("aria-pressed", "false");
    expect(day(calendar, /^Jan 9/)).toHaveAttribute("data-in-range", "true");
    expect(day(calendar, /^Jan 12/)).not.toHaveAttribute("data-in-range");
  });

  it("puts a green dot only on cheap days from the saved prices, none without them", async () => {
    await setup();
    const calendar = await openCalendar();
    await waitFor(() => {
      expect(day(calendar, "Jan 2, lower price")).toBeVisible();
    });
    for (const d of [3, 4, 5]) expect(day(calendar, `Jan ${String(d)}, lower price`)).toBeVisible();
    for (const d of [6, 8, 11, 20]) expect(day(calendar, `Jan ${String(d)}`)).toBeVisible();
    expect(within(calendar).getAllByRole("button", { name: /lower price/ })).toHaveLength(4);
    expect(within(calendar).getByText("Green dots mark cheaper days on this route")).toBeVisible();
  });

  it("draws no dots when the route has fewer than three saved days", async () => {
    await setup("en", saved.slice(0, 2));
    const calendar = await openCalendar();
    await waitFor(() => {
      expect(day(calendar, /^Jan 20/)).toBeVisible();
    });
    expect(within(calendar).queryAllByRole("button", { name: /lower price/ })).toHaveLength(0);
    expect(within(calendar).queryByText(/Green dots/)).toBeNull();
  });

  it("picks a range: the first tap starts it, the second ends it, then searches those dates", async () => {
    const app = await setup();
    const calendar = await openCalendar();
    fireEvent.click(day(calendar, /^Jan 14/));
    expect(screen.getByLabelText("Departure date")).toHaveValue("2027-01-14");
    expect(within(calendar).getByText("Now pick your return date")).toBeVisible();
    expect(day(calendar, /^Jan 14/)).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(day(calendar, /^Jan 20/));
    expect(screen.getByLabelText("Return date")).toHaveValue("2027-01-20");
    expect(screen.queryByRole("group", { name: "Calendar" })).toBeNull();
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "Search flights" }));
    await waitFor(() => {
      expect(searches(app)).toHaveLength(2);
    });
    expect(
      flightSearchRequestSchema.parse(JSON.parse(searches(app).at(-1)?.body ?? "{}")),
    ).toMatchObject({ departureDate: "2027-01-14", returnDate: "2027-01-20" });
  });

  it("restarts the range when the second tap is not after the first", async () => {
    await setup();
    const calendar = await openCalendar();
    fireEvent.click(day(calendar, /^Jan 14/));
    fireEvent.click(day(calendar, /^Jan 13/));
    expect(screen.getByLabelText("Departure date")).toHaveValue("2027-01-13");
    expect(screen.getByRole("group", { name: "Calendar" })).toBeVisible();
    fireEvent.click(day(calendar, /^Jan 13/));
    expect(screen.getByLabelText("Departure date")).toHaveValue("2027-01-13");
  });

  it("picks a single date for a one-way trip and closes", async () => {
    const app = await setup();
    fireEvent.click(screen.getByRole("radio", { name: "One way" }));
    const calendar = await openCalendar();
    expect(day(calendar, /^Jan 8/)).toHaveAttribute("aria-pressed", "true");
    expect(day(calendar, /^Jan 11/)).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(day(calendar, /^Jan 15/));
    expect(screen.getByLabelText("Departure date")).toHaveValue("2027-01-15");
    expect(screen.queryByRole("group", { name: "Calendar" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Search flights" }));
    await waitFor(() => {
      expect(searches(app)).toHaveLength(2);
    });
    const body = JSON.parse(searches(app).at(-1)?.body ?? "{}") as Record<string, unknown>;
    expect(body).toMatchObject({ tripType: "one-way", departureDate: "2027-01-15" });
    expect(body).not.toHaveProperty("returnDate");
  });

  it("moves between months, fetching each month's saved prices, and disables past days", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2027-01-05T04:00:00Z") });
    const app = await setup();
    const calendar = await openCalendar();
    expect(day(calendar, /^Jan 4/)).toBeDisabled();
    expect(day(calendar, /^Jan 5/)).toBeEnabled();
    fireEvent.click(within(calendar).getByRole("button", { name: "Next month" }));
    expect(within(calendar).getByText("February 2027")).toBeVisible();
    await waitFor(() => {
      expect(app.api.flightPriceStripQueries.some((q) => q.includes("month=2027-02"))).toBe(true);
    });
    fireEvent.click(within(calendar).getByRole("button", { name: "Previous month" }));
    expect(within(calendar).getByText("January 2027")).toBeVisible();
    expect(within(calendar).getByRole("button", { name: "Previous month" })).toBeDisabled();
  });

  it("is the way back from a cleared departure date: it opens on today's month", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2027-01-05T04:00:00Z") });
    await setup();
    fireEvent.change(screen.getByLabelText("Departure date"), { target: { value: "" } });
    const calendar = await openCalendar();
    expect(within(calendar).getByText("January 2027")).toBeVisible();
    expect(day(calendar, /^Jan 20/)).toBeEnabled();
    fireEvent.click(day(calendar, /^Jan 20/));
    expect(screen.getByLabelText("Departure date")).toHaveValue("2027-01-20");
    expect(screen.getByLabelText("Return date")).toHaveValue("2027-01-23");
  });

  it("shows the Chinese labels", async () => {
    await setup("zh-TW");
    const calendar = await openCalendar();
    expect(within(calendar).getByText("2027 年 1 月")).toBeVisible();
    expect(within(calendar).getByRole("button", { name: "上個月" })).toBeVisible();
    await waitFor(() => {
      expect(day(calendar, "1/2（六）, 價格較低")).toBeVisible();
    });
    expect(within(calendar).getByText("綠點是這條航線比較便宜的日子")).toBeVisible();
  });

  it("keeps 44 px targets, no dimming and no sideways scroll, with 4.5:1 text and 3:1 dots", async () => {
    await setup();
    const calendar = await openCalendar();
    for (const button of [toggle(), ...within(calendar).getAllByRole("button")]) {
      expect(button.className).toMatch(/min-h-11|size-11/);
      expect(button.className).not.toMatch(/opacity|transition-colors|transition-all/);
    }
    expect(calendar.className).not.toMatch(/overflow-x|w-\[/);
    const pairs: [string, string][] = [
      [color("--color-sprout-900"), "#ffffff"], // day numbers
      ["#ffffff", color("--color-travel-action")], // picked days
      [color("--color-sprout-900"), color("--color-sprout-100")], // days inside the range
      [color("--color-travel-disabled-ink"), color("--color-sprout-50")], // past days
      [color("--color-ink-muted"), color("--color-sprout-50")], // weekdays and the green-dot note
    ];
    for (const [fg, bg] of pairs) expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(color("--color-sprout-700"), color("--color-sprout-100")),
    ).toBeGreaterThanOrEqual(3);
  });
});
