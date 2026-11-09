import { formatAmount, type FlightSearchIntent, type FlightTickerReply } from "@split/shared";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthProvider.js";
import { readWithRev } from "../groups/data.js";
import { t } from "../i18n/messages.js";
import { prefersReducedMotion } from "../shell/motion.js";
import { airportName } from "./AirportPicker.js";

/** Read-only: the endpoint serves stored Fare Snapshots and history, never the flight source. */
function useTicker(origin: string, currency: string) {
  const { session } = useAuth();
  return useQuery({
    queryKey: ["flights", "ticker", origin, currency],
    // No ticker beats a spinner or a retry wait.
    retry: false,
    queryFn: ({ signal }) =>
      readWithRev<FlightTickerReply>(
        session.fetch(
          `/api/v1/flights/ticker?${new URLSearchParams({ origin, currency }).toString()}`,
          { signal },
        ),
      ),
  });
}

/**
 * The Fare Ticker: a drifting strip of chips, the cheapest saved fare to each Fare Snapshot
 * destination, with a green −N% where Deal Signal history says it beats the usual price. Tapping a
 * chip sets the destination (it does not search). Renders nothing without saved fares. Under reduced
 * motion it stands still and scrolls by hand; otherwise the second copy of the chips only exists to
 * make the loop seamless and is hidden from assistive tech and the keyboard.
 */
export function FareTicker({
  intent,
  onPick,
}: {
  intent: FlightSearchIntent;
  onPick: (destination: string) => void;
}) {
  const { data } = useTicker(intent.origin, intent.currency);
  const chips = data?.chips ?? [];
  if (chips.length === 0) return null;
  const still = prefersReducedMotion();
  const copy = (hidden: boolean) =>
    chips.map(({ destination, price, percentBelow }) => {
      const place = airportName(destination);
      const amount = formatAmount(price, intent.currency);
      const current = destination === intent.destination;
      return (
        <button
          key={destination}
          type="button"
          tabIndex={hidden ? -1 : undefined}
          aria-current={current && !hidden ? "true" : undefined}
          aria-label={
            percentBelow === undefined
              ? t("flight.tickerChip", { place, price: amount })
              : t("flight.tickerChipDeal", { place, price: amount, percent: percentBelow })
          }
          onClick={() => {
            onPick(destination);
          }}
          className={`fr-tk fr-hit${percentBelow === undefined ? "" : " lo"}`}
        >
          <b>{destination}</b>
          {amount}
          {percentBelow !== undefined && (
            <span aria-hidden="true">{`−${String(percentBelow)}%`}</span>
          )}
        </button>
      );
    });
  return (
    <section
      aria-label={t("flight.ticker")}
      className={`fr-tick ${still ? "overflow-x-auto" : ""}`}
    >
      {still ? (
        <div className="inline-block">{copy(false)}</div>
      ) : (
        <div className="fr-track">
          <div className="inline-block">{copy(false)}</div>
          <div aria-hidden="true" className="inline-block">
            {copy(true)}
          </div>
        </div>
      )}
    </section>
  );
}
