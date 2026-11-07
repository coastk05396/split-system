"""Private container HTTP adapter. Challenges are failures, never retried or bypassed."""
from dataclasses import asdict
from decimal import Decimal
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from html.parser import HTMLParser


def normalize(flights: list[dict], currency: str) -> list[dict]:
    multiplier = 100 if currency in ("USD", "THB") else 1
    def timestamp(value: dict) -> str:
        year, month, day = value["date"]
        hour, minute = value["time"]
        return f"{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}"
    fares = []
    for flight in flights:
        legs = flight["flights"]
        if flight["price"] is None or not legs:
            continue
        price = int(Decimal(str(flight["price"])) * multiplier)
        if price <= 0:
            continue
        fares.append({
            "price": price,
            "airline": ", ".join(flight["airlines"]),
            "outboundDeparture": timestamp(legs[0]["departure"]),
            "outboundArrival": timestamp(legs[-1]["arrival"]),
            # Google returns outbound options priced for the round trip, before return selection.
            "inboundDeparture": None,
            "inboundArrival": None,
            "stops": len(legs) - 1,
            "durationMinutes": sum(leg["duration"] for leg in legs) + sum(
                int((datetime.fromisoformat(timestamp(nxt["departure"])) - datetime.fromisoformat(timestamp(prev["arrival"]))).total_seconds() // 60)
                for prev, nxt in zip(legs, legs[1:])
            ),
            "priceLevel": flight.get("current_price", "unknown"),
        })
    return fares[:20]


def native_price_level(html: str) -> str:
    class Indicator(HTMLParser):
        active = False
        level = "unknown"
        def handle_starttag(self, tag, attrs):
            if tag == "span":
                self.active = "gOatQ" in dict(attrs).get("class", "").split()
        def handle_endtag(self, tag):
            if tag == "span":
                self.active = False
        def handle_data(self, data):
            value = data.strip().lower()
            if self.active and value in ("low", "typical", "high"):
                self.level = value
    indicator = Indicator()
    indicator.feed(html)
    return indicator.level


def search(intent: dict) -> list[dict]:
    from fast_flights import FlightQuery, Passengers, create_query
    from fast_flights.parser import parse
    from primp import Client
    origin, destination = intent["origin"], intent["destination"]
    filters = {}
    if intent.get("directOnly"):
        filters["max_stops"] = 0
    if intent.get("excludeRedEye"):
        filters.update(earliest_departure_hour=6, latest_departure_hour=21)
    query = create_query(
        flights=[
            FlightQuery(date=intent["departureDate"], from_airport=origin, to_airport=destination, **filters),
            FlightQuery(date=intent["returnDate"], from_airport=destination, to_airport=origin, **filters),
        ],
        seat="economy", trip="round-trip", passengers=Passengers(adults=1),
        currency=intent["currency"], language="en",
    )
    client = Client(impersonate="chrome_145", impersonate_os="macos", referer=True, cookie_store=True, timeout=20)
    response = client.get("https://www.google.com/travel/flights", params=query.params())
    if response.status_code != 200:
        raise ValueError("source unavailable")
    results = parse(response.text)
    level = native_price_level(response.text)
    return normalize([{**asdict(flight), "current_price": level} for flight in results], intent["currency"])


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_POST(self):
        if self.path != "/search":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 1 or length > 4096:
                raise ValueError("invalid request")
            result = search(json.loads(self.rfile.read(length)))
            body = json.dumps(result).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception:
            self.send_error(503, "Flight source unavailable")


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
