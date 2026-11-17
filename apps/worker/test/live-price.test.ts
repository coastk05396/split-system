import { describe, expect, it, vi } from "vitest";
import {
  googleLiveFlightSource,
  type LiveItinerary,
  type LiveLookup,
  type LiveResult,
} from "../src/flights/live-price.js";
import {
  collectVerifiedDailyFlights,
  type FlightCandidate,
  type FlightSource,
} from "../src/flights/pipeline.js";

const now = Date.parse("2026-11-16T00:00:00Z");

function candidate(id: string, over: Partial<FlightCandidate> = {}): FlightCandidate {
  return {
    id,
    origin: "TPE",
    dest: "NRT",
    tripType: "rt",
    outDate: "2026-12-10",
    inDate: "2026-12-14",
    priceTwd: 6000,
    dealBaselineTwd: 10000,
    airlines: ["IT"],
    transfers: 0,
    returnTransfers: 0,
    outboundDep: "09:40",
    inboundDep: "16:20",
    ...over,
  };
}

const itinerary = (over: Partial<LiveItinerary> = {}): LiveItinerary => ({
  priceTwd: 5500,
  airlines: ["IT"],
  transfers: 0,
  ...over,
});

function sourceOf(candidates: FlightCandidate[], lookup: LiveLookup, opts = {}): FlightSource {
  return googleLiveFlightSource({ fetchCandidates: () => Promise.resolve(candidates) }, lookup, {
    minGapMs: 0,
    maxGapMs: 0,
    ...opts,
  });
}

const hit =
  (...itineraries: LiveItinerary[]): LiveLookup =>
  (batch) =>
    Promise.resolve(batch.map((c) => ({ id: c.id, reason: null, itineraries })));

const miss =
  (reason: LiveResult["reason"]): LiveLookup =>
  (batch) =>
    Promise.resolve(batch.map((c) => ({ id: c.id, reason, itineraries: [] })));

describe("Google Live Price reconciliation (ADR 0012)", () => {
  it("reprices a matching itinerary and recomputes the Deal Signal", async () => {
    const collected = await collectVerifiedDailyFlights(
      sourceOf([candidate("a")], hit(itinerary({ priceTwd: 5000 }))),
      now,
    );
    expect(collected.items.map((i) => [i.priceTwd, i.discountPct])).toEqual([[5000, 50]]);
    expect(collected.live).toMatchObject({ repriced: 1, kept: 0, dropped: 0, blocked: 0 });
  });

  it("drops a fare whose Live Price falls under 15% below the Baseline", async () => {
    const collected = await collectVerifiedDailyFlights(
      sourceOf([candidate("a")], hit(itinerary({ priceTwd: 9000 }))),
      now,
    );
    expect(collected.items).toEqual([]);
    expect(collected.live).toMatchObject({ repriced: 0, kept: 0, dropped: 1, blocked: 0 });
  });

  it("reprices a much higher Live Price that stays a Good Deal instead of calling it a Ghost Fare", async () => {
    const collected = await collectVerifiedDailyFlights(
      sourceOf([candidate("a", { priceTwd: 4000 })], hit(itinerary({ priceTwd: 8000 }))),
      now,
    );
    expect(collected.droppedGhost).toBe(0);
    expect(collected.items.map((i) => i.priceTwd)).toEqual([8000]);
  });

  it.each([
    ["no result", miss("no_result")],
    ["an error", miss("error")],
    ["a different airline", hit(itinerary({ airlines: ["BR"], priceTwd: 9500 }))],
    ["a different stop class", hit(itinerary({ transfers: 1, priceTwd: 9500 }))],
  ])("keeps the cached price on %s", async (_name, lookup) => {
    const collected = await collectVerifiedDailyFlights(sourceOf([candidate("a")], lookup), now);
    expect(collected.items.map((i) => i.priceTwd)).toEqual([6000]);
    expect(collected.live).toMatchObject({ repriced: 0, kept: 1, dropped: 0, blocked: 0 });
  });

  it("keeps cached prices when the lookup itself throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const collected = await collectVerifiedDailyFlights(
      sourceOf([candidate("a")], () => Promise.reject(new Error("spawn failed"))),
      now,
    );
    warn.mockRestore();
    expect(collected.items.map((i) => i.priceTwd)).toEqual([6000]);
  });

  it("queries 3 at a time with a gap, stops at the first block and keeps the rest cached", async () => {
    vi.useFakeTimers();
    try {
      const batches: string[][] = [];
      const lookup: LiveLookup = (batch) => {
        batches.push(batch.map((c) => c.id));
        const blocked = batches.length === 2;
        return Promise.resolve(
          batch.map((c) => ({
            id: c.id,
            reason: blocked ? ("blocked" as const) : null,
            itineraries: blocked ? [] : [itinerary({ priceTwd: 5000 })],
          })),
        );
      };
      const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
      const source = sourceOf(
        ids.map((id) => candidate(id)),
        lookup,
        { batchSize: 3, minGapMs: 500, maxGapMs: 500 },
      );
      const pending = collectVerifiedDailyFlights(source, now);

      await vi.advanceTimersByTimeAsync(0);
      expect(batches).toEqual([["a", "b", "c"]]);
      await vi.advanceTimersByTimeAsync(499);
      expect(batches).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(batches).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(5000);

      const collected = await pending;
      expect(batches).toEqual([
        ["a", "b", "c"],
        ["d", "e", "f"],
      ]);
      expect(collected.live).toMatchObject({ repriced: 3, kept: 5, dropped: 0, blocked: 5 });
      expect(collected.items.map((i) => i.priceTwd)).toEqual([
        5000, 5000, 5000, 6000, 6000, 6000, 6000, 6000,
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("by default queries one at a time, 3 s apart, and tallies outcomes with blocked reasons", async () => {
    vi.useFakeTimers();
    try {
      const seen: string[][] = [];
      const reasons: LiveResult["reason"][] = [null, "error", "no_result", "blocked", null];
      const lookup: LiveLookup = (batch) => {
        const reason = reasons[seen.length] ?? null;
        seen.push(batch.map((c) => c.id));
        return Promise.resolve(
          batch.map((c) => ({
            id: c.id,
            reason,
            ...(reason === "blocked" ? { blockedReason: "consent" } : {}),
            itineraries: [],
          })),
        );
      };
      const source = googleLiveFlightSource(
        {
          fetchCandidates: () =>
            Promise.resolve(["a", "b", "c", "d", "e"].map((id) => candidate(id))),
        },
        lookup,
      );
      const pending = collectVerifiedDailyFlights(source, now);
      await vi.advanceTimersByTimeAsync(2999);
      expect(seen).toEqual([["a"]]);
      await vi.advanceTimersByTimeAsync(1);
      expect(seen).toEqual([["a"], ["b"]]);
      await vi.advanceTimersByTimeAsync(20_000);

      const collected = await pending;
      expect(seen).toEqual([["a"], ["b"], ["c"], ["d"]]); // stopped at the block
      expect(collected.live?.queries).toEqual({
        ok: 1,
        no_result: 1,
        error: 1,
        blocked: 1,
        blockedReasons: { consent: 1 },
      });
      expect(collected.live).toMatchObject({ kept: 5, blocked: 2 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("never queries more than the hard cap", async () => {
    const seen: string[] = [];
    const lookup: LiveLookup = (batch) => {
      seen.push(...batch.map((c) => c.id));
      return hit()(batch);
    };
    await collectVerifiedDailyFlights(
      sourceOf(
        ["a", "b", "c", "d", "e"].map((id) => candidate(id)),
        lookup,
        { maxQueries: 4 },
      ),
      now,
    );
    expect(seen).toEqual(["a", "b", "c", "d"]);
  });
});
