"""Google Flights Live Price adapter (ADR 0012).

stdin : JSON array of candidates {id, origin, dest, tripType, outDate, inDate}
stdout: JSON array with one result per candidate, in order:
        {id, reason: null | "no_result" | "error" | "blocked", itineraries: [...]}
Matching and pricing decisions stay in TypeScript. No proxies, no evasion, no challenge solving:
a block signal is reported as "blocked" and the caller stops querying. The only retry is one plain
re-request after RETRY_PAUSE_SECONDS for a payload-less page or a 5xx (Google's soft "Verifying..."
interstitial clears on its own); a result that was retried carries `retried: true`.
"""

import json
import re
import sys
import time
from typing import Any

from fast_flights import FlightQuery, FlightsNotFound, create_query
from fast_flights.fetcher import URL
from fast_flights.parser import parse_js
from primp import Client
from selectolax.lexbor import LexborHTMLParser

# All priced itineraries are sorted cheapest first before this cap, so it never cuts off the best fare.
MAX_ITINERARIES = 40
# Pause between queries; the TS caller also spaces its calls, this keeps a multi-candidate stdin polite.
QUERY_GAP_SECONDS = 3.0
# One re-request after this pause for a transient error (payload-less page or confirmed 5xx).
RETRY_PAUSE_SECONDS = 10
TRANSIENT = ("no_payload", "server_error")
# Explicit block signals only. Anything else that goes wrong is an "error", never "blocked".
BLOCK_MARKERS = (
    ("consent", "consent.google.com"),
    ("sorry", "/sorry/"),
    ("sorry", "unusual traffic"),
)
HTTP_BLOCK = re.compile(
    r"\bHTTP(?:/\d(?:\.\d)?)?\s*(?:429|403)\b|\bstatus(?: code)?\W{0,4}(?:429|403)\b|Too Many Requests",
    re.IGNORECASE,
)


def hm(time_pair: tuple[int, int]) -> str:
    return f"{time_pair[0]:02d}:{time_pair[1]:02d}"


def fetch_page(q: Any) -> tuple[int, str]:
    """GET the results page with fast-flights' own client settings, keeping the HTTP status
    (fast_flights.fetch_flights_html returns only the body)."""
    client = Client(
        impersonate="chrome_145", impersonate_os="macos", referer=True, cookie_store=True
    )
    res = client.get(URL, params=q.params())
    return res.status_code, res.text


def block_reason(html: str, status: int | None = None) -> str | None:
    """consent | sorry (explicit blocks) | server_error (confirmed 5xx) | no_payload (ambiguous) for a page without results."""
    for reason, marker in BLOCK_MARKERS:
        if marker in html:
            return reason
    if status is not None and status >= 500:
        return "server_error"
    return None if "ds:1" in html else "no_payload"


class ParseError(ValueError):
    """The page has priced fares but none could be read."""


def exception_block_reason(e: Exception) -> str | None:
    return "http" if HTTP_BLOCK.search(str(e)) else None


def has_price(entry: Any) -> bool:
    try:
        return isinstance(entry[1][0][1], (int, float))
    except (IndexError, TypeError, KeyError):
        return False


def group(payload: Any, index: int) -> list[Any]:
    """Itineraries of one result group, or [] when the group is missing or empty."""
    try:
        return payload[index][0] or []
    except (IndexError, TypeError, KeyError):
        return []


def parse_tolerant(html: str) -> list[dict[str, Any]]:
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
    # Google splits results in "best flights" (payload[2][0]: where the low-cost carriers sit) and
    # "other flights" (payload[3][0]); fast-flights only reads the latter. Either may be missing.
    entries = group(payload, 2) + group(payload, 3)
    found: list[dict[str, Any]] = []
    seen: set[tuple[Any, ...]] = set()
    priced = 0
    for entry in entries:
        if not has_price(entry):
            continue
        priced += 1
        single = list(payload)
        single[3] = [[entry]]
        try:
            one = parse_js("data:" + json.dumps(single) + ",")
            # Google lists airline names; the board stores IATA codes, so map through the page metadata.
            codes = {a.name: a.code for a in one.metadata.airlines}
            built = [itinerary(f, codes) for f in one]
        except (IndexError, TypeError, KeyError, ValueError, AttributeError):
            continue  # one malformed entry (e.g. no flight legs) never costs the page's valid fares
        for it in built:
            key = (it["priceTwd"], tuple(it["airlines"]), it["outboundDep"], it["outboundArr"], it["transfers"])
            if key not in seen:
                seen.add(key)
                found.append(it)
    # Priced fares we cannot read at all mean a parse failure ("error"), not an honest "no result".
    if priced and not found:
        raise ParseError("no itinerary could be parsed")
    found.sort(key=lambda it: it["priceTwd"])
    return found


def read_page(
    html: str, status: int | None = None
) -> tuple[str | None, list[dict[str, Any]], str | None]:
    """Turn a fetched page into (reason, itineraries, detail): the block reason when blocked,
    `no_payload` for a payload-less error.

    fast-flights returns the body without a status, so an interstitial or HTTP-error body is
    recognised by an explicit marker. A page lacking Google's results payload (`ds:1`) is an
    "error" tagged `no_payload`.
    A page with the payload but no flights is a genuine "no_result".
    """
    if status in (429, 403):
        return "blocked", [], "http"
    blocked = block_reason(html, status)
    if blocked == "server_error":
        return "error", [], "server_error"  # a confirmed 5xx is transient, not a block
    if blocked == "no_payload":
        # One payload-less page is ambiguous; the caller stops after 3 in a row.
        return "error", [], "no_payload"
    if blocked:
        return "blocked", [], blocked
    try:
        flights = parse_tolerant(html)
    except FlightsNotFound:
        return "no_result", [], None
    if not flights:
        return "no_result", [], None
    return None, flights[:MAX_ITINERARIES], None


def itinerary(f: Any, codes: dict[str, str]) -> dict[str, Any]:
    first, last = f.flights[0], f.flights[-1]
    return {
        "priceTwd": f.price,
        "airlines": [codes.get(n, n) for n in f.airlines],
        "transfers": len(f.flights) - 1,
        "outboundDep": hm(first.departure.time),
        "outboundArr": hm(last.arrival.time),
    }


def attempt(c: dict[str, Any]) -> dict[str, Any]:
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
        status, html = fetch_page(q)
        reason, itineraries, detail = read_page(html, status)
        result["reason"], result["itineraries"] = reason, itineraries
        if detail:
            result["blockedReason" if reason == "blocked" else "errorReason"] = detail
    except Exception as e:  # noqa: BLE001 - report, never crash the run
        blocked = exception_block_reason(e)
        if blocked:
            result["reason"], result["blockedReason"] = "blocked", blocked
        else:
            result["reason"] = "error"
            # Category only (the type name): messages may echo request details.
            result["errorReason"] = "parse" if isinstance(e, ParseError) else f"exception:{type(e).__name__}"
    return result


def query_one(c: dict[str, Any]) -> dict[str, Any]:
    result = attempt(c)
    if result["reason"] == "error" and result.get("errorReason") in TRANSIENT:
        time.sleep(RETRY_PAUSE_SECONDS)  # just wait and ask again, once: no tricks
        result = attempt(c)
        result["retried"] = True
    if result["reason"] == "error":
        print(f"adapter error for {c['id']}: {result['errorReason']}", file=sys.stderr)
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
