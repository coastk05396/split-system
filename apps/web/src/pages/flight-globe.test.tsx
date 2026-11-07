import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeUser } from "../../test/fake-api.js";
import { openSearchPanel } from "../../test/flight-panel.js";
import { renderApp } from "../../test/render-app.js";

const languages = ["en", "zh-TW"] as const;
type Language = (typeof languages)[number];
// Worked examples, not recomputed: TPE-OKA is about 655 km and TPE-NRT about 2182 km great-circle;
// flight time is 30 minutes of taxi and climb plus the distance at 800 km/h.
const words = {
  en: {
    destination: "Destination airport",
    search: "Search flights",
    oka: "655 km · ≈ 1 h 19 min",
    nrt: "2,182 km · ≈ 3 h 14 min",
    globe: "Globe turned to TPE → NRT",
  },
  "zh-TW": {
    destination: "目的地機場",
    search: "搜尋航班",
    oka: "655 公里・約 1 小時 19 分",
    nrt: "2,182 公里・約 3 小時 14 分",
    globe: "地球轉向 TPE → NRT",
  },
} as const;

async function chooseDestination(language: Language, query: string) {
  await openSearchPanel();
  const field = await screen.findByRole("combobox", { name: words[language].destination });
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value: query } });
  const option = within(screen.getByRole("listbox")).queryAllByRole("option")[0];
  if (option) fireEvent.click(option);
  else fireEvent.blur(field); // tapping Search moves focus, which commits a typed code
  fireEvent.click(screen.getByRole("button", { name: words[language].search }));
  await screen.findByText("Example Air");
}

describe.each(languages)("Flight Radar route globe in %s", (language) => {
  const w = words[language];
  const open = () => renderApp({ path: "/travel", cookieUser: { ...makeUser("Rick"), language } });

  it("shows the distance and rough flight time of the searched route", async () => {
    open();
    expect(await screen.findByText(w.oka)).toBeInTheDocument();
    await chooseDestination(language, "nrt");
    expect(await screen.findByText(w.nrt)).toBeInTheDocument();
    expect(screen.queryByText(w.oka)).toBeNull();
    expect(screen.getByRole("img", { name: w.globe })).toBeInTheDocument();
  });

  it("shows nothing when an airport has no known location", async () => {
    open();
    await screen.findByText(w.oka);
    await chooseDestination(language, "zzz");
    await waitFor(() => {
      expect(screen.queryByText(w.oka)).toBeNull();
    });
    expect(screen.queryByRole("img", { name: /ZZZ/ })).toBeNull();
    expect(screen.queryByText(/NaN|undefined/)).toBeNull();
  });
});
