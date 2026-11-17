import {
  stopClassOf,
  type FlightCandidate,
  type FlightSource,
  type VerifiedFlightPrice,
} from "./pipeline.js";

/** One Google itinerary for a candidate's Route and dates. */
export interface LiveItinerary {
  priceTwd: number;
  airlines: string[];
  transfers: number;
  outboundDep?: string | null | undefined;
  outboundArr?: string | null | undefined;
}

/** `reason` is set when Google gave nothing usable; `blocked` means a block signal (429, consent, verification page). */
export interface LiveResult {
  id: string;
  reason: "no_result" | "error" | "blocked" | null;
  /** Why it was blocked: `http` (429/403), `consent`, `sorry` or `no_payload`. */
  blockedReason?: string | undefined;
  /** `no_payload`: an error page without Google's results payload (ambiguous, not yet a block). */
  errorReason?: string | undefined;
  itineraries: LiveItinerary[];
}

/** Looks up one batch of candidates; the production one runs the Python adapter. */
export type LiveLookup = (batch: readonly FlightCandidate[]) => Promise<LiveResult[]>;

/** Outcome of each Google query this run (counts only, never URLs or ids). */
export interface LiveQueries {
  ok: number;
  no_result: number;
  error: number;
  blocked: number;
  blockedReasons: Record<string, number>;
  /** Why queries failed: `server_error`, `no_payload`, `parse`, `exception:<Type>` or `unknown`. */
  errorReasons: Record<string, number>;
}

/** Stop after this many payload-less pages in a row (a single one is ambiguous, not a block). */
const MAX_CONSECUTIVE_NO_PAYLOAD = 3;

export interface LiveOptions {
  /** Concurrent queries per batch (ADR 0012: 2 to 3). */
  batchSize?: number;
  /** Hard cap on candidates queried per run. */
  maxQueries?: number;
  minGapMs?: number;
  maxGapMs?: number;
  random?: () => number;
}

const emptyQueries = (): LiveQueries => ({
  ok: 0,
  no_result: 0,
  error: 0,
  blocked: 0,
  blockedReasons: {},
  errorReasons: {},
});

const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  const left = new Set(a.map((x) => x.toUpperCase()));
  const right = new Set(b.map((x) => x.toUpperCase()));
  return left.size === right.size && [...left].every((x) => right.has(x));
};

/**
 * Wraps a source so Stage 2 reads a Google Live Price (ADR 0012). Fares are queried in polite batches
 * up front; a matching itinerary (airline set and stop class; Route and dates are in the query)
 * reprices the fare, anything else keeps the cached price. Never retries and stops at the first block.
 */
export function googleLiveFlightSource(
  base: FlightSource,
  lookup: LiveLookup,
  options: LiveOptions = {},
): FlightSource {
  const {
    // One query at a time, 3 s apart: Google blocked faster pacing from a home IP (ADR 0012).
    batchSize = 1,
    maxQueries = 240,
    minGapMs = 3000,
    maxGapMs = 3000,
    random = Math.random,
  } = options;
  let live = new Map<string, LiveResult>();
  let stats = { repriced: 0, kept: 0, blocked: 0 };
  let blockedIds = new Set<string>();
  let queries = emptyQueries();

  return {
    ...(base.upstreamCalls ? { upstreamCalls: () => base.upstreamCalls?.() ?? 0 } : {}),
    discoveredCandidates: () => base.discoveredCandidates?.() ?? 0,
    liveStats: () => ({ ...stats, queries }),

    async fetchCandidates(digestDate, now) {
      const candidates = await base.fetchCandidates(digestDate, now);
      live = new Map();
      stats = { repriced: 0, kept: 0, blocked: 0 };
      blockedIds = new Set();
      queries = emptyQueries();
      let noPayloadStreak = 0;
      const queried = candidates.slice(0, maxQueries);
      for (let i = 0; i < queried.length; i += batchSize) {
        if (i > 0) {
          const gap = minGapMs + random() * (maxGapMs - minGapMs);
          await new Promise((resolve) => setTimeout(resolve, gap));
        }
        const batch = queried.slice(i, i + batchSize);
        let results: LiveResult[] = [];
        try {
          results = await lookup(batch);
        } catch (error) {
          console.warn(JSON.stringify({ event: "live_price_lookup_failed", error: String(error) }));
        }
        let blocked = false;
        let stopReason = "";
        for (const r of results) {
          live.set(r.id, r);
          const key = r.reason ?? "ok";
          queries[key] += 1;
          if (r.reason === "error") {
            const why = r.errorReason ?? "unknown";
            queries.errorReasons[why] = (queries.errorReasons[why] ?? 0) + 1;
          }
          if (r.reason === "blocked") {
            const why = r.blockedReason ?? "unknown";
            queries.blockedReasons[why] = (queries.blockedReasons[why] ?? 0) + 1;
            blocked = true;
            stopReason = why;
          }
          // Only a page with a payload (results or genuinely none) resets the streak.
          if (r.errorReason === "no_payload") noPayloadStreak += 1;
          else if (r.reason === null || r.reason === "no_result") noPayloadStreak = 0;
        }
        // An explicit block also leaves its own batch unresolved; a payload-less streak only the rest.
        let firstUnresolved = i;
        if (!blocked && noPayloadStreak >= MAX_CONSECUTIVE_NO_PAYLOAD) {
          blocked = true;
          firstUnresolved = i + batch.length;
          stopReason = "no_payload";
          queries.blockedReasons["no_payload"] = (queries.blockedReasons["no_payload"] ?? 0) + 1;
        }
        if (blocked) {
          for (const c of queried.slice(firstUnresolved)) blockedIds.add(c.id);
          console.warn(
            JSON.stringify({
              event: "live_price_blocked",
              reason: stopReason,
              queried: i + batch.length,
            }),
          );
          break;
        }
      }
      return candidates;
    },

    verifyCandidate(candidate): Promise<VerifiedFlightPrice | null> {
      const cached: VerifiedFlightPrice = { priceTwd: candidate.priceTwd };
      const wantedClass = stopClassOf(candidate.transfers, candidate.returnTransfers);
      // The return leg is not read from Google, so the candidate's own return transfers stay in force.
      const match = (live.get(candidate.id)?.itineraries ?? [])
        .filter(
          (it) =>
            sameSet(it.airlines, candidate.airlines) &&
            stopClassOf(it.transfers, candidate.returnTransfers) === wantedClass,
        )
        .sort((a, b) => a.priceTwd - b.priceTwd)[0];
      if (match === undefined) {
        stats.kept += 1;
        if (blockedIds.has(candidate.id)) stats.blocked += 1;
        return Promise.resolve(cached);
      }
      stats.repriced += 1;
      return Promise.resolve({
        priceTwd: Math.round(match.priceTwd),
        airlines: candidate.airlines,
        transfers: match.transfers,
        outboundDep: match.outboundDep ?? candidate.outboundDep,
        outboundArr: match.outboundArr ?? candidate.outboundArr ?? null,
        live: true,
      });
    },
  };
}
