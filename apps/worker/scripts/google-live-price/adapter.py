"""Google Flights Live Price adapter (ADR 0012).

stdin : JSON array of candidates {id, origin, dest, tripType, outDate, inDate}
stdout: JSON array with one result per candidate, in order:
        {id, reason: null | "no_result" | "error" | "blocked", itineraries: [...]}
Matching and pricing decisions stay in TypeScript. No retries, no proxies, no evasion:
a block signal is reported as "blocked" and the caller stops querying.
"""

import json
import re
import sys
import time
from typing import Any

from fast_flights import FlightQuery, FlightsNotFound, create_query, fetch_flights_html
from fast_flights.parser import parse_js
from selectolax.lexbor import LexborHTMLParser

MAX_ITINERARIES = 15
# Pause between queries; the TS caller also spaces its calls, this keeps a multi-candidate stdin polite.
QUERY_GAP_SECONDS = 3.0
# Explicit block signals only. Anything else that goes wrong is an "error", never "blocked".
BLOCK_MARKERS = (
    ("consent", "consent.google.com"),
    ("sorry", "/sorry/"),
    ("sorry", "unusual traffic"),
)
HTTP_BLOCK = re.compile(r"\b(?:HTTP|status)\D{0,12}(?:429|403)\b|Too Many Requests", re.IGNORECASE)


def hm(time_pair: tuple[int, int]) -> str:
    return f"{time_pair[0]:02d}:{time_pair[1]:02d}"


def block_reason(html: str) -> str | None:
    """consent | sorry | no_payload when the page is an explicit block or lacks Google's results payload."""
    for reason, marker in BLOCK_MARKERS:
        if marker in html:
            return reason
    return None if "ds:1" in html else "no_payload"


def exception_block_reason(e: Exception) -> str | None:
    return "http" if HTTP_BLOCK.search(str(e)) else None


def has_price(entry: Any) -> bool:
    try:
        return isinstance(entry[1][0][1], (int, float))
    except (IndexError, TypeError, KeyError):
        return False


def parse_tolerant(html: str) -> tuple[list[Any], dict[str, str]]:
    """Like fast_flights.parser.parse, but one malformed itinerary (e.g. no price) is skipped
    instead of crashing the page (fast-flights 3.1.0 raises IndexError on `k[1][0][1]`)."""
    script = LexborHTMLParser(html).css_first(r"script.ds\:1")
    if script is None:
        raise ValueError("results script missing")
    js = script.text()
    data = js.split("data:", 1)[1].rsplit(",", 1)[0]
    if data.endswith("errorHasStatus: true"):
        raise FlightsNotFound("no flights found; received error")
    payload = json.loads(data)
    entries = payload[3][0]
    if entries is None:
        return [], {}
    found: list[Any] = []
    codes: dict[str, str] = {}
    priced = 0
    for entry in entries:
        if not has_price(entry):
            continue
        priced += 1
        single = list(payload)
        single[3] = list(payload[3])
        single[3][0] = [entry]
        try:
            one = parse_js("data:" + json.dumps(single) + ",")
            found.extend(one)
            # Google lists airline names; the board stores IATA codes, so map through the page metadata.
            codes.update({a.name: a.code for a in one.metadata.airlines})
        except (IndexError, TypeError, KeyError, ValueError):
            continue
    if priced and not found:
        raise ValueError("no itinerary could be parsed")
    return found, codes


def read_page(html: str) -> tuple[str | None, list[dict[str, Any]], str | None]:
    """Turn a fetched page into (reason, itineraries, blocked_reason).

    fast-flights returns the body without a status, so an interstitial or HTTP-error body is
    recognised by an explicit marker or by lacking Google's results payload (`ds:1`).
    A page with the payload but no flights is a genuine "no_result".
    """
    blocked = block_reason(html)
    if blocked:
        return "blocked", [], blocked
    try:
        flights, codes = parse_tolerant(html)
    except FlightsNotFound:
        return "no_result", [], None
    if not flights:
        return "no_result", [], None
    return None, [itinerary(f, codes) for f in flights[:MAX_ITINERARIES]], None


def itinerary(f: Any, codes: dict[str, str]) -> dict[str, Any]:
    first, last = f.flights[0], f.flights[-1]
    return {
        "priceTwd": f.price,
        "airlines": [codes.get(n, n) for n in f.airlines],
        "transfers": len(f.flights) - 1,
        "outboundDep": hm(first.departure.time),
        "outboundArr": hm(last.arrival.time),
    }


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
        reason, itineraries, blocked = read_page(fetch_flights_html(q))
        result["reason"], result["itineraries"] = reason, itineraries
        if blocked:
            result["blockedReason"] = blocked
    except Exception as e:  # noqa: BLE001 - report, never crash the run
        blocked = exception_block_reason(e)
        result["reason"] = "blocked" if blocked else "error"
        if blocked:
            result["blockedReason"] = blocked
        else:
            # Only the exception type is reported: messages may echo request details.
            print(f"adapter error for {c['id']}: {type(e).__name__}", file=sys.stderr)
    return result


def main() -> None:
    """One query at a time; stop at the first explicit block (the rest are not queried)."""
    results: list[dict[str, Any]] = []
    for i, c in enumerate(json.load(sys.stdin)):
        if i > 0:
            time.sleep(QUERY_GAP_SECONDS)
        results.append(query_one(c))
        if results[-1]["reason"] == "blocked":
            break
    print(json.dumps(results))


if __name__ == "__main__":
    main()
