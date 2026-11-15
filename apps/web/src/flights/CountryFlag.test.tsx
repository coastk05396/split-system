import { DESTINATION_CATALOG, type DailyFlightItem } from "@split/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CountryFlag } from "./CountryFlag.js";
import { CompactFlightCard } from "./ui.js";

const SAMPLE_DEAL: DailyFlightItem = {
  id: "tpe-dad-vj",
  origin: "TPE",
  dest: "DAD",
  region: "sea",
  tripType: "ow",
  outDate: "2026-12-05",
  inDate: null,
  priceTwd: 2680,
  discountPct: 50,
  tag: "steal",
  airlines: ["VJ"],
  transfers: 0,
  returnTransfers: null,
  isRedEye: false,
  outboundDep: "15:00",
  inboundDep: null,
};

describe("CountryFlag & CompactFlightCard", () => {
  it("renders a crisp SVG emblem for every country in DESTINATION_CATALOG without text fallback", () => {
    const codes = Array.from(new Set(DESTINATION_CATALOG.map((d) => d.countryCode)));
    expect(codes.length).toBe(21);

    const { container } = render(
      <div>
        {codes.map((code) => (
          <CountryFlag key={code} countryCode={code} />
        ))}
      </div>,
    );

    for (const code of codes) {
      const svg = container.querySelector(`svg[data-country="${code}"]`);
      expect(svg, `expected SVG flag for ${code}`).not.toBeNull();
    }
    expect(container.textContent).toBe("");
  });

  it("renders Sprout single-row deal card with SVG flag, soft-mint route pill, friendly origin subtitle, big price, and zero Trip.com text", () => {
    const { container } = render(<CompactFlightCard item={SAMPLE_DEAL} lang="zh-TW" />);

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute(
      "href",
      "/api/v1/flights/go?origin=TPE&dest=DAD&outDate=2026-12-05&tripType=ow&lang=zh-TW",
    );
    expect(link.className).toContain("flight-card");
    expect(link.innerHTML).not.toContain("group-hover:scale");
    expect(screen.getByRole("heading", { level: 2, name: "峴港" })).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "峴港" }).className).toContain(
      "text-slate-900",
    );
    const routePill = screen.getByText(/TPE\s*→\s*DAD/);
    expect(routePill).toBeVisible();
    expect(routePill.parentElement?.className).toContain("bg-sprout-50");
    expect(routePill.parentElement?.className).toContain("text-sprout-700");
    expect(screen.getByText("12/05 桃園出發 · 單程 · 直飛")).toBeVisible();
    expect(screen.queryByText(/15:00/)).toBeNull();
    expect(screen.queryByText(/越捷/)).toBeNull();
    expect(screen.queryByText(/連假/)).toBeNull();
    const price = screen.getByText("2,680");
    expect(price).toBeVisible();
    expect(price.className).toContain("text-slate-900");
    expect(price.className).toContain("text-2xl");
    const discountText = screen.getByText("省 50%");
    expect(discountText).toBeVisible();
    expect(discountText.className).toContain("text-[11px]");
    expect(discountText.className).toContain("text-sprout-600");
    expect(discountText.className).not.toContain("bg-amber-");
    expect(discountText.className).not.toContain("bg-rose-");
    expect(container.querySelector('svg[data-country="VN"]')).not.toBeNull();
    expect(container.textContent).not.toMatch(/Trip\.com/i);
    expect(link.getAttribute("aria-label") ?? "").not.toMatch(/Trip\.com/i);
  });

  it("formats round-trip duration as N天M夜 with airport route pill and omits holiday labels", () => {
    const rtDeal: DailyFlightItem = {
      ...SAMPLE_DEAL,
      id: "kix-rt",
      dest: "KIX",
      region: "jp",
      tripType: "rt",
      outDate: "2027-02-26",
      inDate: "2027-03-02",
      priceTwd: 8900,
      discountPct: 21,
      tag: "below_market",
      returnTransfers: 0,
      inboundDep: "16:15",
    };

    render(<CompactFlightCard item={rtDeal} lang="zh-TW" />);

    expect(screen.getByRole("heading", { level: 2, name: "大阪關西" })).toBeVisible();
    expect(screen.getByText(/TPE\s*⇄\s*KIX/)).toBeVisible();
    expect(screen.getByText("02/26 桃園出發 · 5天4夜 · 直飛")).toBeVisible();
    expect(screen.getByText("省 21%")).toBeVisible();
    expect(screen.queryByText(/連假/)).toBeNull();
  });
});
