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
  itineraries: LiveItinerary[];
}

/** Looks up one batch of candidates; the production one runs the Python adapter. */
export type LiveLookup = (batch: readonly FlightCandidate[]) => Promise<LiveResult[]>;

export interface LiveOptions {
  /** Concurrent queries per batch (ADR 0012: 2 to 3). */
  batchSize?: number;
  /** Hard cap on candidates queried per run. */
  maxQueries?: number;
  minGapMs?: number;
  maxGapMs?: number;
  random?: () => number;
}

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
    batchSize = 3,
    maxQueries = 240,
    minGapMs = 500,
    maxGapMs = 1000,
    random = Math.random,
  } = options;
  let live = new Map<string, LiveResult>();
  let stats = { repriced: 0, kept: 0, blocked: 0 };
  let blockedIds = new Set<string>();

  return {
    ...(base.upstreamCalls ? { upstreamCalls: () => base.upstreamCalls?.() ?? 0 } : {}),
    discoveredCandidates: () => base.discoveredCandidates?.() ?? 0,
    liveStats: () => stats,

    async fetchCandidates(digestDate, now) {
      const candidates = await base.fetchCandidates(digestDate, now);
      live = new Map();
      stats = { repriced: 0, kept: 0, blocked: 0 };
      blockedIds = new Set();
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
        for (const r of results) {
          live.set(r.id, r);
          blocked ||= r.reason === "blocked";
        }
        if (blocked) {
          for (const c of queried.slice(i)) blockedIds.add(c.id);
          console.warn(JSON.stringify({ event: "live_price_blocked", queried: i + batch.length }));
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
