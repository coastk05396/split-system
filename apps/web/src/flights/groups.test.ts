import type { DailyFlightItem } from "@split/shared";
import { describe, expect, it } from "vitest";
import { groupByCity } from "./groups.js";

function fare(dest: string, priceTwd: number, discountPct: number): DailyFlightItem {
  return {
    id: `${dest}-${String(priceTwd)}`,
    origin: "TPE",
    dest,
    region: "jp",
    tripType: "rt",
    outDate: "2026-12-10",
    inDate: "2026-12-14",
    priceTwd,
    discountPct,
    tag: "normal",
    airlines: ["CI"],
    transfers: 0,
    returnTransfers: 0,
    isRedEye: false,
    outboundDep: "10:00",
    inboundDep: "15:00",
  };
}

const items = [
  fare("KIX", 9000, 40),
  fare("FUK", 8000, 0),
  fare("NRT", 8000, 40),
  fare("NRT", 7000, 10), // NRT's cheapest fare is this one: 10% at 7,000
  fare("ICN", 5000, 0),
];
const order = () => groupByCity(items).map((g) => g.cheapest.dest);

describe("groupByCity", () => {
  it("orders cards by cheapest fare price, then higher discount", () => {
    expect(order()).toEqual(["ICN", "NRT", "FUK", "KIX"]);
  });

  it("leads each card with its cheapest fare and keeps fares price-ascending", () => {
    const nrt = groupByCity(items).find((g) => g.cityKey === "tyo");
    expect(nrt?.cheapest.priceTwd).toBe(7000);
    expect(nrt?.fares.map((f) => f.priceTwd)).toEqual([7000, 8000]);
  });
});
