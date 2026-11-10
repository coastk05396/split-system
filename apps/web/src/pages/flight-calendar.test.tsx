import { readFileSync } from "node:fs";
import { flightSearchRequestSchema, type FlightSearchIntent } from "@split/shared";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { contrast } from "../../test/contrast.js";
import { makeUser } from "../../test/fake-api.js";
import { openSearchPanel, askPrompt } from "../../test/flight-panel.js";
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
async function setup(language: "en" | "zh-TW" = "en") {
  const app = renderApp({ path: "/travel", cookieUser: { ...makeUser("Rick"), language } });
  app.api.flightPromptIntent = intent;
  app.api.flightFares = [fare];
  await askPrompt("okinawa");
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

  it("moves between months and disables past days", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2027-01-05T04:00:00Z") });
    await setup();
    const calendar = await openCalendar();
    expect(day(calendar, /^Jan 4/)).toBeDisabled();
    expect(day(calendar, /^Jan 5/)).toBeEnabled();
    fireEvent.click(within(calendar).getByRole("button", { name: "Next month" }));
    expect(within(calendar).getByText("February 2027")).toBeVisible();
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
  });

  it("keeps 44 px targets, no dimming and no sideways scroll, with 4.5:1 text", async () => {
    await setup();
    const calendar = await openCalendar();
    for (const button of [toggle(), ...within(calendar).getAllByRole("button")]) {
      // Day cells are square grid cells of about 45 px at 390 px (the mock's own cells); other controls
      // keep the mock's visible size with a 44 px hit area from .fr-hit.
      expect(button.className).toMatch(/fr-hit|fr-d\b/);
      expect(button.className).not.toMatch(/opacity|transition-colors|transition-all/);
    }
    expect(calendar.className).not.toMatch(/overflow-x|w-\[/);
    const pairs: [string, string][] = [
      [color("--color-sprout-900"), "#ffffff"], // day numbers
      ["#ffffff", color("--color-travel-action")], // picked days
      [color("--color-sprout-900"), color("--color-sprout-100")], // days inside the range
      [color("--color-travel-disabled-ink"), color("--color-sprout-50")], // past days
      [color("--color-ink-muted"), color("--color-sprout-50")], // weekdays
    ];
    for (const [fg, bg] of pairs) expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});
