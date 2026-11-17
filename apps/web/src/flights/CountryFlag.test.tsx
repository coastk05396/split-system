import { DESTINATION_CATALOG } from "@split/shared";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CountryFlag } from "./CountryFlag.js";

describe("CountryFlag", () => {
  it("renders a crisp SVG emblem for every country in DESTINATION_CATALOG without text fallback", () => {
    const codes = Array.from(new Set(DESTINATION_CATALOG.map((d) => d.countryCode)));
    expect(codes.length).toBe(26);

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
});
