import type { CurrencyCode, FlightHighlightsReply } from "@split/shared";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthProvider.js";
import { readWithRev } from "../groups/data.js";

/** Today's confirmed fares, one cache entry. */
export function useHighlights(currency: CurrencyCode) {
  const { session } = useAuth();
  return useQuery({
    queryKey: ["flights", "highlights", currency],
    queryFn: ({ signal }) =>
      readWithRev<FlightHighlightsReply>(
        session.fetch(`/api/v1/flights/highlights?currency=${currency}`, { signal }),
      ),
  });
}
