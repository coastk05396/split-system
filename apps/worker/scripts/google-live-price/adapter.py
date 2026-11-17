"""Google Flights Live Price adapter (ADR 0012).

stdin : JSON array of candidates {id, origin, dest, tripType, outDate, inDate}
stdout: JSON array with one result per candidate, in order:
        {id, reason: null | "no_result" | "error" | "blocked", itineraries: [...]}
Matching and pricing decisions stay in TypeScript. No retries, no proxies, no evasion:
a block signal is reported as "blocked" and the caller stops querying.
"""

import json
import sys
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from fast_flights import FlightQuery, FlightsNotFound, create_query, fetch_flights_html
from fast_flights.parser import parse

MAX_ITINERARIES = 15
BLOCK_MARKERS = ("consent.google.com", "/sorry/", "unusual traffic")


def hm(time: tuple[int, int]) -> str:
    return f"{time[0]:02d}:{time[1]:02d}"


def read_page(html: str) -> tuple[str | None, list[dict[str, Any]]]:
    """Turn a fetched page into (reason, itineraries).

    fast-flights returns the body without a status, so a 429/403/5xx or interstitial page is
    recognised by lacking Google's results payload (`ds:1`): that is "blocked". A page that has
    the payload but no flights is a genuine "no_result".
    """
    if "ds:1" not in html or any(m in html for m in BLOCK_MARKERS):
        return "blocked", []
    try:
        flights = parse(html)
    except FlightsNotFound:
        return "no_result", []
    # Google lists airline names; the board stores IATA codes, so map through the page metadata.
    codes = {a.name: a.code for a in getattr(getattr(flights, "metadata", None), "airlines", [])}
    itineraries = []
    for f in flights[:MAX_ITINERARIES]:
        first, last = f.flights[0], f.flights[-1]
        itineraries.append(
            {
                "priceTwd": f.price,
                "airlines": [codes.get(n, n) for n in f.airlines],
                "transfers": len(f.flights) - 1,
                "outboundDep": hm(first.departure.time),
                "outboundArr": hm(last.arrival.time),
            }
        )
    return (None, itineraries) if itineraries else ("no_result", [])


def query_one(c: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {"id": c["id"], "reason": None, "itineraries": []}
    try:
        legs = [FlightQuery(date=c["outDate"], from_airport=c["origin"], to_airport=c["dest"])]
        if c["tripType"] == "rt" and c.get("inDate"):
            legs.append(FlightQuery(date=c["inDate"], from_airport=c["dest"], to_airport=c["origin"]))
        q = create_query(
            flights=legs,
            trip="round-trip" if len(legs) == 2 else "one-way",
            language="en-US",
            currency="TWD",
        )
        result["reason"], result["itineraries"] = read_page(fetch_flights_html(q))
    except FlightsNotFound:
        result["reason"] = "no_result"
    except Exception as e:  # noqa: BLE001 - report, never crash the batch
        text = str(e)
        result["reason"] = "blocked" if "429" in text else "error"
        if result["reason"] == "error":
            # Only the exception type is reported: messages may echo request details.
            print(f"adapter error for {c['id']}: {type(e).__name__}", file=sys.stderr)
    return result


def main() -> None:
    candidates = json.load(sys.stdin)
    with ThreadPoolExecutor(max_workers=3) as pool:
        print(json.dumps(list(pool.map(query_one, candidates))))


if __name__ == "__main__":
    main()
