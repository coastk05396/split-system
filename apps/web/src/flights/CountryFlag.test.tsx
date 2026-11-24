import { DESTINATION_CATALOG } from "@split/shared";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CountryFlag } from "./CountryFlag.js";

describe("CountryFlag", () => {
  it("renders a crisp SVG emblem for every country in DESTINATION_CATALOG without text fallback", () => {
    const codes = Array.from(new Set(DESTINATION_CATALOG.map((d) => d.countryCode)));
    expect(codes.length).toBe(41);

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
    // The generic globe shown for an unmapped country must not be used by any catalog country
    expect(container.querySelector('circle[fill="#0284C7"]')).toBeNull();
  });

  it("draws Jordan's star with seven points", () => {
    const { container } = render(<CountryFlag countryCode="JO" />);
    const star = container.querySelector('svg[data-country="JO"] polygon');
    // Seven outer points alternate with seven inner points.
    expect(star?.getAttribute("points")?.split(" ")).toHaveLength(14);
  });
});
