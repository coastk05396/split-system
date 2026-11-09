import { readFileSync } from "node:fs";
import { flightSearchRequestSchema, type FlightSearchIntent } from "@split/shared";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { contrast } from "../../test/contrast.js";
import { makeUser } from "../../test/fake-api.js";
import { openSearchPanel } from "../../test/flight-panel.js";
import { renderApp } from "../../test/render-app.js";

const css = readFileSync("src/styles.css", "utf8"); // vitest runs with apps/web as cwd
const theme = Object.fromEntries(
  [
    ...(/@theme\s*\{([^}]*)\}/.exec(css)?.[1] ?? "").matchAll(
      /(--[\w-]+)\s*:\s*(#[0-9a-f]{6})\s*;/gi,
    ),
  ].map((m) => [m[1], m[2]]),
) as Record<string, string>;
const color = (name: string) => theme[name] ?? "#ffffff";

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
  const app = renderApp({ path: "/travel/flights", cookieUser: { ...makeUser("Rick"), language } });
  app.api.flightPromptIntent = intent;
  app.api.flightFares = [fare];
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
const searches = (app: Awaited<ReturnType<typeof setup>>) =>
  app.api.requests.filter((r) => r.route === "POST /api/v1/flights/search");
const lastBody = (app: Awaited<ReturnType<typeof setup>>) =>
  JSON.parse(searches(app).at(-1)?.body ?? "{}") as Record<string, unknown>;
const summary = () => screen.getByRole("button", { name: /^Passengers and cabin/ });
const sheet = () => screen.getByRole("dialog", { name: "Passengers and cabin" });
const openParty = () => {
  fireEvent.click(summary());
};
const closeParty = () => {
  fireEvent.click(within(sheet()).getByRole("button", { name: "Done" }));
};
const submit = async (app: Awaited<ReturnType<typeof setup>>, count: number) => {
  fireEvent.click(
    within(screen.getByRole("region", { name: "Search bar" })).getByRole("button", {
      name: "Search flights",
    }),
  );
  await waitFor(() => {
    expect(searches(app)).toHaveLength(count);
  });
};

describe("Passengers, cabin and trip type panel", () => {
  it("shows a summary row of the current choice and a sheet behind it", async () => {
    await setup();
    expect(summary()).toHaveTextContent("1 adult · Economy · Round trip");
    expect(summary()).toHaveAttribute("aria-haspopup", "dialog");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("group", { name: "Adults" })).toBeNull();
    openParty();
    expect(sheet()).toHaveAttribute("aria-modal", "true");
    for (const name of ["Adults", "Children (2–11)", "Infants (under 2)", "Cabin"])
      expect(within(sheet()).getByRole("group", { name })).toBeVisible();
  });

  it("counts adults and children with steppers, keeps one adult and nine travellers at most", async () => {
    await setup();
    openParty();
    const adults = screen.getByRole("group", { name: "Adults" });
    const children = screen.getByRole("group", { name: "Children (2–11)" });
    expect(within(adults).getByRole("button", { name: "Remove an adult" })).toBeDisabled();
    expect(within(children).getByRole("button", { name: "Remove a child" })).toBeDisabled();
    fireEvent.click(within(adults).getByRole("button", { name: "Add an adult" }));
    fireEvent.click(within(children).getByRole("button", { name: "Add a child" }));
    expect(summary()).toHaveTextContent("2 adults, 1 child · Economy · Round trip");
    for (let i = 0; i < 6; i++)
      fireEvent.click(within(adults).getByRole("button", { name: "Add an adult" }));
    expect(within(adults).getByRole("button", { name: "Add an adult" })).toBeDisabled();
    expect(within(children).getByRole("button", { name: "Add a child" })).toBeDisabled();
    expect(screen.getByText("Up to 9 travellers")).toBeVisible();
    fireEvent.click(within(adults).getByRole("button", { name: "Remove an adult" }));
    expect(within(children).getByRole("button", { name: "Add a child" })).toBeEnabled();
  });

  it("offers four cabins", async () => {
    await setup();
    openParty();
    const cabins = screen.getByRole("group", { name: "Cabin" });
    expect(
      within(cabins)
        .getAllByRole("radio")
        .map((r) => (r as HTMLInputElement).value),
    ).toEqual(["economy", "premium-economy", "business", "first"]);
  });

  it("sends the party and cabin, shows the people on the chip and names the party in the note", async () => {
    const app = await setup();
    openParty();
    fireEvent.click(
      within(screen.getByRole("group", { name: "Adults" })).getByRole("button", {
        name: "Add an adult",
      }),
    );
    fireEvent.click(
      within(screen.getByRole("group", { name: "Children (2–11)" })).getByRole("button", {
        name: "Add a child",
      }),
    );
    fireEvent.click(screen.getByRole("radio", { name: "Business" }));
    closeParty();
    await submit(app, 2);
    expect(flightSearchRequestSchema.parse(lastBody(app))).toMatchObject({
      adults: 2,
      children: 1,
      cabin: "business",
    });
    const card = screen.getByRole("region", { name: "Search summary" });
    expect(
      within(card).getByRole("button", { name: /Jan 8 – Jan 11 · 3 travellers$/ }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Prices are round-trip totals for all 2 adults, 1 child, Business, from Google Flights. Check again before you book.",
      ),
    ).toBeVisible();
  });

  it("sends a plain search without any of the new fields and keeps the chip and note as before", async () => {
    const app = await setup();
    await submit(app, 2);
    const body = lastBody(app);
    for (const key of ["adults", "children", "cabin", "tripType"])
      expect(body).not.toHaveProperty(key);
    const card = screen.getByRole("region", { name: "Search summary" });
    expect(
      within(card).getByRole("button", { name: "Taipei Taoyuan → Okinawa Jan 8 – Jan 11" }),
    ).toBeVisible();
    expect(screen.getByText(/round-trip totals for 1 adult from Google Flights/)).toBeVisible();
  });

  it("searches one way: no return date field, none sent, and the chip says so", async () => {
    const app = await setup();
    expect(screen.getByLabelText("Return date")).toBeVisible();
    fireEvent.click(screen.getByRole("radio", { name: "One way" }));
    expect(screen.queryByLabelText("Return date")).toBeNull();
    expect(summary()).toHaveTextContent("1 adult · Economy · One way");
    await submit(app, 2);
    const body = lastBody(app);
    expect(body).toMatchObject({ tripType: "one-way" });
    expect(body).not.toHaveProperty("returnDate");
    const card = screen.getByRole("region", { name: "Search summary" });
    expect(
      within(card).getByRole("button", { name: "Taipei Taoyuan → Okinawa Jan 8 · One-way" }),
    ).toBeVisible();
    // Back to a round trip: the return date field returns with a usable date.
    await openSearchPanel();
    fireEvent.click(screen.getByRole("radio", { name: "Round trip" }));
    expect(screen.getByLabelText("Return date")).toHaveValue("2027-01-11");
  });

  it("shows the Chinese labels and chip suffixes", async () => {
    const app = renderApp({
      path: "/travel/flights",
      cookieUser: { ...makeUser("Rick"), language: "zh-TW" },
    });
    app.api.flightPromptIntent = { ...intent, adults: 2, tripType: "one-way" };
    delete app.api.flightPromptIntent.returnDate;
    app.api.flightFares = [fare];
    fireEvent.change(await screen.findByLabelText("想去哪裡？"), { target: { value: "okinawa" } });
    fireEvent.click(screen.getByRole("button", { name: "探索航班" }));
    await screen.findByText("Example Air");
    const card = screen.getByRole("region", { name: "搜尋摘要" });
    expect(
      within(card).getByRole("button", { name: "台北桃園 → 沖繩 1/8（五） · 單程 · 2 人" }),
    ).toBeVisible();
    await openSearchPanel();
    expect(screen.getByRole("button", { name: /^旅客與艙等/ })).toHaveTextContent(
      "2 位成人・經濟艙・單程",
    );
  });

  it("explains an empty cabin instead of calling it an error", async () => {
    const app = await setup();
    app.api.flightFares = [];
    openParty();
    fireEvent.click(screen.getByRole("radio", { name: "First" }));
    closeParty();
    await submit(app, 2);
    expect(await screen.findByText(/No verified First fares for this search/)).toBeVisible();
    expect(screen.queryByText(/temporarily unavailable/)).toBeNull();
  });

  it("keeps targets at 44 px, nothing dimmed, no colour transitions and no horizontal scroll", async () => {
    await setup();
    openParty();
    const panel = sheet();
    for (const button of [summary(), ...within(panel).getAllByRole("button")]) {
      expect(button.className).toMatch(/min-h-1[12]|size-11/);
      expect(button.className).not.toMatch(/opacity|transition-colors|transition-all/);
    }
    for (const label of panel.querySelectorAll("label span")) {
      expect(label).toHaveClass("min-h-11");
      expect(label.className).not.toMatch(/opacity|transition/);
    }
    expect(summary()).toHaveClass("min-w-0", "w-full");
    expect(summary().querySelector(".break-words")).not.toBeNull();
    expect(panel.className).not.toMatch(/overflow-x|w-\[/);
  });

  it("keeps every panel text and background pair at 4.5:1 at rest, hover and disabled", () => {
    const pairs: [string, string][] = [
      [color("--color-sprout-900"), "#ffffff"], // choice and summary at rest
      [color("--color-sprout-900"), color("--color-sprout-100")], // hover
      ["#ffffff", color("--color-travel-action")], // selected
      ["#ffffff", color("--color-travel-action-hover")], // selected hover
      [color("--color-travel-disabled-ink"), color("--color-travel-disabled")], // disabled stepper
      [color("--color-ink-muted"), "#ffffff"], // summary label
      [color("--color-ink-muted"), color("--color-sprout-100")], // summary label on hover
      [color("--color-ink-muted"), color("--color-sprout-50")], // limit hint on the panel
      [color("--color-sprout-900"), color("--color-sprout-50")], // labels on the panel
    ];
    for (const [fg, bg] of pairs) expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("Passengers sheet", () => {
  const stepper = (name: string) => within(sheet()).getByRole("group", { name });
  const press = (group: string, button: string) => {
    fireEvent.click(within(stepper(group)).getByRole("button", { name: button }));
  };

  it("never lets infants exceed adults, drops below one adult, or passes nine travellers", async () => {
    await setup();
    openParty();
    const addInfant = () =>
      within(stepper("Infants (under 2)")).getByRole("button", { name: "Add an infant" });
    expect(addInfant()).toBeEnabled();
    press("Infants (under 2)", "Add an infant");
    expect(addInfant()).toBeDisabled(); // 1 infant, 1 adult
    expect(screen.getByText("One infant per adult at most")).toBeVisible();
    expect(
      within(stepper("Adults")).getByRole("button", { name: "Remove an adult" }),
    ).toBeDisabled();
    expect(summary()).toHaveTextContent("1 adult, 1 infant · Economy · Round trip");
    for (let i = 0; i < 4; i++) press("Adults", "Add an adult"); // 5 adults
    press("Children (2–11)", "Add a child");
    press("Children (2–11)", "Add a child"); // 5 + 2 + 1 = 8
    press("Infants (under 2)", "Add an infant"); // 9
    expect(addInfant()).toBeDisabled();
    for (const [group, button] of [
      ["Adults", "Add an adult"],
      ["Children (2–11)", "Add a child"],
    ] as const)
      expect(within(stepper(group)).getByRole("button", { name: button })).toBeDisabled();
    expect(screen.getByText("Up to 9 travellers")).toBeVisible();
    // Dropping adults to the infant count is refused; removing an infant frees it again.
    for (let i = 0; i < 3; i++) press("Adults", "Remove an adult");
    expect(within(stepper("Adults")).getByText("2")).toBeVisible();
    press("Infants (under 2)", "Remove an infant");
    press("Infants (under 2)", "Remove an infant");
    press("Adults", "Remove an adult");
    expect(within(stepper("Adults")).getByText("1")).toBeVisible();
  });

  it("says the price excludes infants only when there are some", async () => {
    await setup();
    openParty();
    expect(within(sheet()).queryByText("Price excludes infants")).toBeNull();
    press("Infants (under 2)", "Add an infant");
    expect(within(sheet()).getByText("Price excludes infants")).toBeVisible();
  });

  it("sends infants, keeps the shown fare, and repeats the note under the fares", async () => {
    const app = await setup();
    openParty();
    press("Adults", "Add an adult");
    press("Infants (under 2)", "Add an infant");
    closeParty();
    await submit(app, 2);
    expect(flightSearchRequestSchema.parse(lastBody(app))).toMatchObject({
      adults: 2,
      infants: 1,
    });
    expect(screen.getByText(/Price excludes infants\./)).toBeVisible();
    expect(screen.getAllByText(/21,000/).length).toBeGreaterThan(0); // not multiplied
    expect(
      screen.getByText(/Prices are round-trip totals for all 2 adults, Economy/),
    ).toBeVisible();
    // A plain search again: no infants key, no note.
    await openSearchPanel();
    openParty();
    press("Infants (under 2)", "Remove an infant");
    closeParty();
    await submit(app, 3);
    expect(lastBody(app)).not.toHaveProperty("infants");
    expect(screen.queryByText(/Price excludes infants/)).toBeNull();
  });

  it("moves focus into the sheet, traps Tab, closes on Escape and returns focus to the row", async () => {
    await setup();
    const row = summary();
    row.focus();
    openParty();
    expect(sheet()).toContainElement(document.activeElement as HTMLElement);
    const focusable = Array.from(
      sheet().querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)"),
    );
    const first = focusable[0] as HTMLElement;
    const last = focusable.at(-1) as HTMLElement;
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(summary());
  });

  it("closes with Done and keeps the choice", async () => {
    await setup();
    openParty();
    press("Adults", "Add an adult");
    closeParty();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(summary()).toHaveTextContent("2 adults · Economy · Round trip");
    expect(document.activeElement).toBe(summary());
  });

  it("shows the Chinese labels and the infant note", async () => {
    renderApp({ path: "/travel/flights", cookieUser: { ...makeUser("Rick"), language: "zh-TW" } });
    fireEvent.change(await screen.findByLabelText("想去哪裡？"), { target: { value: "okinawa" } });
    fireEvent.click(screen.getByRole("button", { name: "探索航班" }));
    await screen.findByText("Example Air");
    await openSearchPanel();
    fireEvent.click(screen.getByRole("button", { name: /^旅客與艙等/ }));
    const dialog = screen.getByRole("dialog", { name: "旅客與艙等" });
    fireEvent.click(within(dialog).getByRole("button", { name: "增加嬰兒" }));
    expect(within(dialog).getByRole("group", { name: "嬰兒（2 歲以下）" })).toBeVisible();
    expect(within(dialog).getByText("價格不含嬰兒")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "完成" })).toBeVisible();
  });

  it("keeps the new text pairs at 4.5:1", () => {
    const pairs: [string, string][] = [
      [color("--color-sprout-900"), color("--color-sprout-50")], // sheet title and rows
      [color("--color-ink-muted"), color("--color-sprout-50")], // hints and the infant note
      ["#ffffff", color("--color-travel-action")], // Done, selected cabin and trip
      [color("--color-sprout-900"), color("--color-sprout-100")], // idle trip segment
    ];
    for (const [fg, bg] of pairs) expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});
