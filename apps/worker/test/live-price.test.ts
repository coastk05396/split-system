import { describe, expect, it, vi } from "vitest";
import {
  MAX_RETRIES_PER_RUN,
  PARSE_STREAK_STOP,
  SWEEP_MAX,
  SWEEP_PAUSE_MS,
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
    sweepMax: 0, // the sweep has its own describe
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
        { sweepMax: 0 },
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
        errorReasons: { unknown: 1 },
        retried: 0,
        swept: 0,
        sweptRecovered: 0,
      });
      expect(collected.live).toMatchObject({ kept: 5, blocked: 2 });
    } finally {
      vi.useRealTimers();
    }
  });

  describe("payload-less pages (no_payload errors)", () => {
    // "np" = a page without Google's results payload, "ok" = a page with results.
    const run = async (pattern: ("np" | "ok" | "blocked")[]) => {
      vi.useFakeTimers();
      try {
        const queried: string[] = [];
        const lookup: LiveLookup = (batch) => {
          const kind = pattern[queried.length] ?? "ok";
          queried.push(...batch.map((c) => c.id));
          return Promise.resolve(
            batch.map((c) => ({
              id: c.id,
              reason:
                kind === "np"
                  ? ("error" as const)
                  : kind === "blocked"
                    ? ("blocked" as const)
                    : null,
              ...(kind === "np" ? { errorReason: "no_payload", retried: true } : {}),
              ...(kind === "blocked" ? { blockedReason: "consent" } : {}),
              itineraries: [],
            })),
          );
        };
        const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
        const source = googleLiveFlightSource(
          { fetchCandidates: () => Promise.resolve(ids.map((id) => candidate(id))) },
          lookup,
          { sweepMax: 0 },
        );
        const pending = collectVerifiedDailyFlights(source, now);
        await vi.advanceTimersByTimeAsync(60_000);
        return { queried, collected: await pending };
      } finally {
        vi.useRealTimers();
      }
    };

    it("does not stop on a single payload-less page", async () => {
      const { queried } = await run(["ok", "np", "ok"]);
      expect(queried).toHaveLength(8);
    });

    it("stops after 3 consecutive payload-less pages and keeps the rest cached", async () => {
      const { queried, collected } = await run(["np", "np", "np"]);
      expect(queried).toEqual(["a", "b", "c"]);
      expect(collected.live).toMatchObject({ kept: 8, blocked: 5 });
      expect(collected.live?.queries).toMatchObject({
        error: 3,
        blockedReasons: { no_payload: 1 },
      });
    });

    it("resets the counter on any page with a payload", async () => {
      const { queried } = await run(["np", "np", "ok", "np", "np", "ok"]);
      expect(queried).toHaveLength(8);
    });

    it("still stops at once on an explicit block", async () => {
      const { queried } = await run(["ok", "blocked"]);
      expect(queried).toEqual(["a", "b"]);
    });
  });

  it("tallies the error category of each failed query, counts only", async () => {
    const reasons = [
      "server_error",
      "no_payload",
      "parse",
      "exception:RuntimeError",
      undefined,
      "server_error",
    ];
    const lookup: LiveLookup = (batch) =>
      Promise.resolve(
        batch.map((c) => ({
          id: c.id,
          reason: "error" as const,
          errorReason: reasons[Number(c.id)],
          itineraries: [],
        })),
      );
    const collected = await collectVerifiedDailyFlights(
      sourceOf(
        ["0", "1", "2", "3", "4", "5"].map((id) => candidate(id)),
        lookup,
        { batchSize: 1, maxQueries: 6 },
      ),
      now,
    );
    expect(collected.live?.queries).toMatchObject({
      error: 6,
      errorReasons: {
        server_error: 2,
        no_payload: 1,
        parse: 1,
        "exception:RuntimeError": 1,
        unknown: 1,
      },
    });
  });

  describe("retried payload-less pages", () => {
    const outcome = (kind: "np" | "ok" | "parse" | "np-retried" | "ok-retried") => {
      const retried = kind.endsWith("retried");
      return {
        reason: kind.startsWith("np") || kind === "parse" ? ("error" as const) : null,
        ...(kind.startsWith("np") ? { errorReason: "no_payload" } : {}),
        ...(kind === "parse" ? { errorReason: "parse" } : {}),
        ...(retried ? { retried: true as const } : {}),
      };
    };
    const run = async (kinds: ("np" | "ok" | "parse" | "np-retried" | "ok-retried")[]) => {
      vi.useFakeTimers();
      try {
        const queried: string[] = [];
        const lookup: LiveLookup = (batch) => {
          const kind = kinds[queried.length] ?? "ok";
          queried.push(...batch.map((c) => c.id));
          return Promise.resolve(
            batch.map((c) => ({ id: c.id, itineraries: [], ...outcome(kind) })),
          );
        };
        const ids = ["a", "b", "c", "d", "e", "f"];
        const source = googleLiveFlightSource(
          { fetchCandidates: () => Promise.resolve(ids.map((id) => candidate(id))) },
          lookup,
          { sweepMax: 0 },
        );
        const pending = collectVerifiedDailyFlights(source, now);
        await vi.advanceTimersByTimeAsync(60_000);
        return { queried, collected: await pending };
      } finally {
        vi.useRealTimers();
      }
    };

    it("counts a no_payload that was not retried as a streak of 0 (adapter always retries it first)", async () => {
      const { queried } = await run(["np", "np", "np"]);
      expect(queried).toHaveLength(6);
    });

    it("stops after 3 consecutive results that are still payload-less after their retry", async () => {
      const { queried } = await run(["np-retried", "np-retried", "np-retried"]);
      expect(queried).toEqual(["a", "b", "c"]);
    });

    it("a recovered retry resets the streak", async () => {
      const { queried } = await run([
        "np-retried",
        "np-retried",
        "ok-retried",
        "np-retried",
        "np-retried",
      ]);
      expect(queried).toHaveLength(6);
    });

    it("a parse failure does not reset the transient failure streak", async () => {
      const { queried } = await run(["np-retried", "parse", "np-retried", "np-retried"]);
      expect(queried).toHaveLength(4); // three transient failures stop the run despite the parse in between
    });

    it("tallies how many queries were retried", async () => {
      const { collected } = await run(["ok", "ok-retried", "np-retried", "ok"]);
      expect(collected.live?.queries).toMatchObject({ retried: 2, error: 1 });
    });
  });

  describe("run-wide retry budget and 5xx streak", () => {
    type Kind = "ok" | "5xx" | "np";
    /** Fakes the adapter: a failing page is retried (and fails again) only when allowed. */
    const fakeAdapter = (kinds: (id: number) => Kind) => {
      const calls = { lookups: 0, requests: 0, allowed: [] as boolean[] };
      const lookup: LiveLookup = (batch, opts) => {
        calls.lookups += 1;
        calls.allowed.push(opts.allowRetry);
        return Promise.resolve(
          batch.map((c) => {
            const kind = kinds(Number(c.id));
            calls.requests += 1;
            if (kind === "ok") return { id: c.id, reason: null, itineraries: [] };
            const errorReason = kind === "5xx" ? "server_error" : "no_payload";
            if (!opts.allowRetry)
              return { id: c.id, reason: "error" as const, errorReason, itineraries: [] };
            calls.requests += 1;
            return {
              id: c.id,
              reason: "error" as const,
              errorReason,
              retried: true,
              itineraries: [],
            };
          }),
        );
      };
      return { lookup, calls };
    };
    const run = async (n: number, lookup: LiveLookup, opts = {}) => {
      vi.useFakeTimers();
      try {
        const ids = Array.from({ length: n }, (_, k) => String(k));
        const source = googleLiveFlightSource(
          { fetchCandidates: () => Promise.resolve(ids.map((id) => candidate(id))) },
          lookup,
          { maxQueries: 240, sweepMax: 0, ...opts },
        );
        const pending = collectVerifiedDailyFlights(source, now);
        await vi.advanceTimersByTimeAsync(2_000_000);
        return await pending;
      } finally {
        vi.useRealTimers();
      }
    };

    it("stops after 3 consecutive 5xx that still fail after their retry: at most 3 + 3 requests", async () => {
      const { lookup, calls } = fakeAdapter(() => "5xx");
      const collected = await run(240, lookup);
      expect(calls.lookups).toBe(3);
      expect(calls.requests).toBe(6);
      expect(collected.items).toHaveLength(240); // the rest keep their cached price
      expect(collected.live?.queries).toMatchObject({
        retried: 3,
        errorReasons: { server_error: 3 },
      });
    });

    it("spends at most MAX_RETRIES_PER_RUN retries and never exceeds cap + budget requests", async () => {
      expect(MAX_RETRIES_PER_RUN).toBe(20);
      // fail, fail, ok, ...: the streak never reaches 3, so only the budget bounds the retries
      const { lookup, calls } = fakeAdapter((id) => (id % 3 === 2 ? "ok" : id % 2 ? "5xx" : "np"));
      const collected = await run(240, lookup);
      expect(collected.live?.queries).toMatchObject({ retried: MAX_RETRIES_PER_RUN });
      expect(calls.requests).toBeLessThanOrEqual(240 + MAX_RETRIES_PER_RUN);
      expect(calls.lookups).toBe(240);
      expect(calls.allowed.lastIndexOf(true)).toBeLessThan(calls.allowed.indexOf(false));
    });

    it("once the budget is spent a failing page still counts toward the streak and stops the run", async () => {
      // queries 0-29 (fail, fail, ok) spend the 20 retries; 30, 31, 32 then fail without a retry
      const { lookup, calls } = fakeAdapter((id) => (id >= 30 || id % 3 !== 2 ? "5xx" : "ok"));
      await run(240, lookup);
      expect(calls.lookups).toBe(33);
    });
  });

  describe("parse errors and the failure streaks", () => {
    type Kind = "np" | "parse" | "ok";
    const run = async (kindOf: (n: number) => Kind, total = 30) => {
      vi.useFakeTimers();
      try {
        let calls = 0;
        const lookup: LiveLookup = (batch) => {
          const kind = kindOf(calls);
          calls += 1;
          return Promise.resolve(
            batch.map((c) => ({
              id: c.id,
              itineraries: [],
              reason: kind === "ok" ? null : ("error" as const),
              ...(kind === "np" ? { errorReason: "no_payload", retried: true } : {}),
              ...(kind === "parse" ? { errorReason: "parse" } : {}),
            })),
          );
        };
        const ids = Array.from({ length: total }, (_, k) => String(k));
        const source = googleLiveFlightSource(
          { fetchCandidates: () => Promise.resolve(ids.map((id) => candidate(id))) },
          lookup,
          { sweepMax: 0 },
        );
        const pending = collectVerifiedDailyFlights(source, now);
        await vi.advanceTimersByTimeAsync(200_000);
        return { calls, collected: await pending };
      } finally {
        vi.useRealTimers();
      }
    };

    it("a parse error neither resets nor adds to the transient streak: alternating np/parse still stops", async () => {
      const { calls } = await run((n) => (n % 2 === 0 ? "np" : "parse"));
      expect(calls).toBe(5); // np, parse, np, parse, np: three transient failures
    });

    it("stops after PARSE_STREAK_STOP consecutive parse errors and keeps cached prices", async () => {
      expect(PARSE_STREAK_STOP).toBe(10);
      const { calls, collected } = await run(() => "parse");
      expect(calls).toBe(10);
      expect(collected.items).toHaveLength(30);
      expect(collected.live?.queries).toMatchObject({ blockedReasons: { parse: 1 } });
    });

    it("a good result resets both counters", async () => {
      const { calls } = await run((n) => (n === 9 || n === 19 ? "ok" : "parse"), 25);
      expect(calls).toBe(25); // 9 + ok + 9 + ok + 5: neither streak ever reaches its limit
    });
  });

  describe("final sweep of transient errors", () => {
    type Outcome = "ok" | "np" | "5xx" | "parse" | "blocked";
    /** attempts[id] = outcome of its 1st, 2nd, ... query (the last repeats). np/5xx count as already retried. */
    const sweepRun = async (
      attempts: Record<string, Outcome[]>,
      ids: string[],
      opts: { sweepPauseMs?: number } = {},
    ) => {
      vi.useFakeTimers();
      try {
        const seen: { id: string; allowRetry: boolean; at: number }[] = [];
        const lookup: LiveLookup = (batch, { allowRetry }) =>
          Promise.resolve(
            batch.map((c) => {
              const n = seen.filter((x) => x.id === c.id).length;
              seen.push({ id: c.id, allowRetry, at: Date.now() });
              const list = attempts[c.id] ?? ["ok"];
              const kind = list[Math.min(n, list.length - 1)] ?? "ok";
              if (kind === "ok")
                return { id: c.id, reason: null, itineraries: [itinerary({ priceTwd: 5000 })] };
              if (kind === "blocked")
                return {
                  id: c.id,
                  reason: "blocked" as const,
                  blockedReason: "consent",
                  itineraries: [],
                };
              const errorReason =
                kind === "np" ? "no_payload" : kind === "5xx" ? "server_error" : "parse";
              return {
                id: c.id,
                reason: "error" as const,
                errorReason,
                ...(allowRetry && kind !== "parse" ? { retried: true } : {}),
                itineraries: [],
              };
            }),
          );
        const source = googleLiveFlightSource(
          { fetchCandidates: () => Promise.resolve(ids.map((id) => candidate(id))) },
          lookup,
          { ...opts },
        );
        const start = Date.now();
        const pending = collectVerifiedDailyFlights(source, now);
        await vi.advanceTimersByTimeAsync(2_000_000);
        return { seen, collected: await pending, start };
      } finally {
        vi.useRealTimers();
      }
    };

    it("re-queries a still-failed fare once after a 60 s pause, without in-line retry, and reprices it", async () => {
      expect(SWEEP_PAUSE_MS).toBe(60_000);
      const { seen, collected, start } = await sweepRun({ b: ["np", "ok"] }, ["a", "b", "c"]);
      const second = seen.filter((x) => x.id === "b");
      expect(second).toHaveLength(2);
      expect(second[1]?.allowRetry).toBe(false);
      expect((second[1]?.at ?? 0) - start).toBeGreaterThanOrEqual(SWEEP_PAUSE_MS);
      expect(collected.items.find((i) => i.id === "b")?.priceTwd).toBe(5000);
      expect(collected.live?.queries).toMatchObject({
        swept: 1,
        sweptRecovered: 1,
        error: 0,
        errorReasons: {},
      });
    });

    it("a fare that fails again stays an error and keeps its cached price", async () => {
      const { seen, collected } = await sweepRun({ b: ["np"] }, ["a", "b", "c"]);
      expect(seen.filter((x) => x.id === "b")).toHaveLength(2);
      expect(collected.items.find((i) => i.id === "b")?.priceTwd).toBe(6000);
      expect(collected.live?.queries).toMatchObject({ swept: 1, sweptRecovered: 0, error: 1 });
    });

    it("sweeps only no_payload and server_error, never parse errors", async () => {
      const { seen, collected } = await sweepRun(
        { a: ["parse"], b: ["5xx", "ok"], c: ["np", "ok"] },
        ["a", "b", "c", "d"],
      );
      expect(seen.filter((x) => x.id === "a")).toHaveLength(1);
      expect(collected.live?.queries).toMatchObject({ swept: 2, sweptRecovered: 2 });
    });

    it("does not sweep after an explicit block stopped the run", async () => {
      const { seen } = await sweepRun({ a: ["np"], b: ["blocked"] }, ["a", "b", "c"]);
      expect(seen.map((x) => x.id)).toEqual(["a", "b"]);
    });

    it("does not sweep after a failure streak stopped the run", async () => {
      const { seen } = await sweepRun({ a: ["np"], b: ["np"], c: ["np"] }, ["a", "b", "c", "d"]);
      expect(seen.map((x) => x.id)).toEqual(["a", "b", "c"]);
    });

    it("an explicit block during the sweep stops it at once", async () => {
      const { seen, collected } = await sweepRun(
        { a: ["np", "blocked"], c: ["np", "ok"], e: ["np", "ok"] },
        ["a", "b", "c", "d", "e"],
      );
      expect(seen.map((x) => x.id)).toEqual(["a", "b", "c", "d", "e", "a"]);
      expect(collected.live?.queries).toMatchObject({
        swept: 1,
        sweptRecovered: 0,
        blockedReasons: { consent: 1 },
      });
    });

    it("sweeps at most SWEEP_MAX fares and keeps total requests within cap + retries + sweep", async () => {
      expect(SWEEP_MAX).toBe(10);
      const ids = Array.from({ length: 240 }, (_, k) => String(k));
      // every third fare fails (never 3 in a row), all of them keep failing
      const attempts = Object.fromEntries(
        ids.filter((id) => Number(id) % 3 === 0).map((id) => [id, ["np" as const]]),
      );
      const { seen, collected } = await sweepRun(attempts, ids);
      const sweptQueries = seen.length - 240;
      expect(sweptQueries).toBe(SWEEP_MAX);
      const retried = (collected.live?.queries as { retried?: number } | undefined)?.retried ?? 0;
      expect(retried).toBeLessThanOrEqual(MAX_RETRIES_PER_RUN);
      // Google requests: one per lookup plus one per in-line retry
      expect(seen.length + retried).toBeLessThanOrEqual(240 + MAX_RETRIES_PER_RUN + SWEEP_MAX);
    });
  });

  it("never queries more than the hard cap", async () => {
    const seen: string[] = [];
    const lookup: LiveLookup = (batch) => {
      seen.push(...batch.map((c) => c.id));
      return hit()(batch, { allowRetry: true });
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
