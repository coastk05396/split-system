import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeUser } from "../../test/fake-api.js";
import { openSearchPanel } from "../../test/flight-panel.js";
import { renderApp } from "../../test/render-app.js";

const languages = ["en", "zh-TW"] as const;
type Language = (typeof languages)[number];
const words = {
  en: {
    card: "Search summary",
    destination: "Destination airport",
    okinawa: "Globe turned to Okinawa",
    tokyo: "Globe turned to Tokyo",
    osaka: "Globe turned to Osaka",
    typeTokyo: "tokyo",
    typeOsaka: "Osaka",
  },
  "zh-TW": {
    card: "搜尋摘要",
    destination: "目的地機場",
    okinawa: "地球儀轉向沖繩",
    tokyo: "地球儀轉向東京",
    osaka: "地球儀轉向大阪",
    typeTokyo: "東京",
    typeOsaka: "大阪",
  },
} as const;

const reduced = window.matchMedia.bind(window);
afterEach(() => {
  window.matchMedia = reduced;
  // eslint-disable-next-line @typescript-eslint/unbound-method -- vitest mock
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
});
const allowMotion = () => {
  window.matchMedia = (query) => ({ matches: false, media: query }) as MediaQueryList;
};

function setup(language: Language) {
  renderApp({ path: "/travel/flights", cookieUser: { ...makeUser("Rick"), language } });
}
const globe = (name: string) => screen.findByRole("img", { name });
const centre = (el: HTMLElement) => el.dataset.centre;

async function typeDestination(language: Language, value: string) {
  await openSearchPanel();
  fireEvent.change(screen.getByRole("combobox", { name: words[language].destination }), {
    target: { value },
  });
}

describe("Flight Radar globe", () => {
  it.each(languages)("sits in the header, turned to the searched place, in %s", async (l) => {
    setup(l);
    const card = await screen.findByRole("region", { name: words[l].card });
    const el = await globe(words[l].okinawa);
    // In the header above the route card, not in it.
    expect(card).not.toContainElement(el);
    expect(el.closest("header")).not.toBeNull();
    expect(el.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(centre(el)).toBe("26.2,127.7");
    expect(el).toHaveAttribute("height", "200");
    expect(el.style.height).toBe("118px");
  });

  it.each(languages)("turns to a catalogue code, then a city name, in %s", async (l) => {
    setup(l);
    await globe(words[l].okinawa);
    await typeDestination(l, "nrt");
    expect(centre(await globe(words[l].tokyo))).toBe("35.8,140.4");
    await typeDestination(l, words[l].typeOsaka);
    expect(centre(await globe(words[l].osaka))).toBe("34.4,135.2");
    await typeDestination(l, words[l].typeTokyo);
    expect(await globe(words[l].tokyo)).toBeVisible();
  });

  it("turns when a suggestion is picked", async () => {
    setup("en");
    await globe(words.en.okinawa);
    await openSearchPanel();
    const field = screen.getByRole("combobox", { name: words.en.destination });
    fireEvent.change(field, { target: { value: "osa" } });
    fireEvent.click(await screen.findByRole("option", { name: /Osaka/ }));
    expect(centre(await globe(words.en.osaka))).toBe("34.4,135.2");
  });

  it("stays where it is for input it does not know", async () => {
    setup("en");
    const el = await globe(words.en.okinawa);
    await typeDestination("en", "Atlantis");
    await typeDestination("en", "ZZZ");
    await typeDestination("en", "To");
    expect(await globe(words.en.okinawa)).toBe(el);
    expect(centre(el)).toBe("26.2,127.7");
  });

  it("jumps under reduced motion and turns smoothly otherwise", async () => {
    setup("en");
    await globe(words.en.okinawa);
    await typeDestination("en", "NRT");
    // The test environment asks for reduced motion: the end state is immediate.
    expect(centre(await globe(words.en.tokyo))).toBe("35.8,140.4");

    window.matchMedia = reduced;
    allowMotion();
    await typeDestination("en", "KIX");
    const el = await globe(words.en.osaka);
    expect(centre(el)).not.toBe("34.4,135.2");
    await waitFor(() => {
      expect(centre(el)).toBe("34.4,135.2");
    });
  });

  it("draws the mock's pale sphere with a dot lattice, a route arc and markers", async () => {
    const calls: string[] = [];
    const fillStyles: unknown[] = [];
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- the index type is needed
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (target, key: string) =>
        key in target
          ? target[key]
          : () => {
              calls.push(key);
            },
      set: (target, key: string, value: unknown) => {
        if (key === "fillStyle") fillStyles.push(value);
        target[key] = value;
        return true;
      },
    });
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vitest mock
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(ctx as never);
    setup("en");
    await globe(words.en.okinawa);
    // Reduced motion in tests: the globe has arrived, so the lattice, the arc and both markers are drawn.
    await waitFor(() => {
      expect(fillStyles).toContain("#e4f9e9");
    });
    expect(fillStyles).toContain("#143f2a");
    expect(calls.filter((c) => c === "fillRect").length).toBeGreaterThan(100);
    expect(calls.filter((c) => c === "lineTo").length).toBeGreaterThan(10);
    expect(calls).toContain("arc");
  });

  it("repaints the route arc when only the origin changes", async () => {
    let clears = 0;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- the index type is needed
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (target, key: string) =>
        key in target
          ? target[key]
          : () => {
              if (key === "clearRect") clears += 1;
            },
      set: (target, key: string, value: unknown) => {
        target[key] = value;
        return true;
      },
    });
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vitest mock
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(ctx as never);
    setup("en");
    await globe(words.en.okinawa);
    await waitFor(() => {
      expect(clears).toBeGreaterThan(0);
    });
    const before = clears;
    await openSearchPanel();
    fireEvent.change(screen.getByRole("combobox", { name: "Origin airport" }), {
      target: { value: "khh" },
    });
    // The header follows the submitted search, not the draft.
    fireEvent.click(screen.getByRole("button", { name: "Search flights" }));
    await waitFor(() => {
      expect(clears).toBeGreaterThan(before);
    });
  });
});
