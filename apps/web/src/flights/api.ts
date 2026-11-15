import {
  type DailyFlightsResponse,
  dailyFlightsResponseSchema,
  getDefaultDailyFlights,
} from "@split/shared";
import { useEffect, useState } from "react";
import { useDeps } from "../app/AppProviders.js";

export type DailyFlightsData = DailyFlightsResponse;

function buildFallbackData(): DailyFlightsData {
  const now = new Date();
  const date = new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
  return {
    date,
    updatedAt: now.toISOString(),
    items: getDefaultDailyFlights(date),
    isFallback: true,
  };
}

/**
 * Loads today's verified cheap flights from Worker D1 without writing into React Query's cache
 * (keeping auth sign-out cache invariants isolated from public flight browsing).
 */
export function useDailyFlights(): { data: DailyFlightsData; isPending: boolean } {
  const deps = useDeps();
  const [state, setState] = useState<{ data: DailyFlightsData; isPending: boolean }>(() => ({
    data: buildFallbackData(),
    isPending: true,
  }));

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function load() {
      try {
        const res = await deps.fetch("/api/v1/flights/daily", { signal: controller.signal });
        if (!res.ok) {
          if (active) setState({ data: buildFallbackData(), isPending: false });
          return;
        }
        const parsed = dailyFlightsResponseSchema.safeParse(await res.json());
        if (!active) return;
        if (!parsed.success) {
          setState({ data: buildFallbackData(), isPending: false });
          return;
        }
        setState({ data: parsed.data, isPending: false });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (active) setState({ data: buildFallbackData(), isPending: false });
      }
    }

    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [deps]);

  return state;
}
