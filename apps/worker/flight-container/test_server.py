import json
from pathlib import Path
import unittest
from server import normalize, parse_both


def raw_flight(price, dep_hour, airline="Test Air"):
    leg = [None] * 22
    leg[3], leg[4], leg[5], leg[6] = "KHH", "Kaohsiung", "Narita", "NRT"
    leg[8], leg[10], leg[11] = [dep_hour], [dep_hour + 4], 180
    leg[17], leg[20], leg[21] = "A320", [2026, 12, 4], [2026, 12, 4]
    extras = [None] * 9
    return [[None, [airline], [leg], *[None] * 19, extras], [[None, price]]]


def js(top, other):
    payload = [None, None, [top], [other], None, None, None, [None, [[], []]]]
    return "data:" + json.dumps(payload) + ",x"

class ParserFixture(unittest.TestCase):
    def test_roundtrip_quote_does_not_invent_return_details(self):
        result = normalize(json.loads(Path(__file__).with_name("fare-fixture.json").read_text()), "TWD")
        self.assertEqual(result[0]["price"], 7000)
        self.assertIsNone(result[0]["inboundDeparture"])
        self.assertEqual(result[0]["priceLevel"], "unknown")
        self.assertEqual(result[0]["stops"], 0)
        self.assertEqual(result[0]["outboundDeparture"], "2026-12-04T08:00")

class NativePriceFixture(unittest.TestCase):
    def test_native_price_level_only_accepts_google_indicator(self):
        from server import native_price_level
        self.assertEqual(native_price_level('<span class="gOatQ">low</span>'), "low")
        self.assertEqual(native_price_level('<p>Low price</p>'), "unknown")
        self.assertEqual(native_price_level('<span class="gOatQ">unavailable</span>'), "unknown")


class TopAndOtherFlights(unittest.TestCase):
    def test_union_is_deduplicated_and_marked(self):
        shared = raw_flight(7000, 8)
        fares = normalize(parse_both(js([shared, raw_flight(9000, 9)], [shared, raw_flight(6000, 10)])), "TWD")
        self.assertEqual(
            sorted((f["price"], f["top"]) for f in fares),
            [(6000, False), (7000, True), (9000, True)],
        )

    def test_missing_top_list_is_all_other(self):
        payload = js(None, [raw_flight(6000, 10)])
        self.assertEqual([f["top"] for f in normalize(parse_both(payload), "TWD")], [False])

    def test_cap_keeps_every_top_fare_and_the_cheapest_others(self):
        others = [raw_flight(9000 - i * 100, 8, f"Air{i}") for i in range(24)]  # cheapest is last
        fares = normalize(parse_both(js([raw_flight(9500, 8, "Top")], others)), "TWD")
        self.assertEqual(len(fares), 20)
        self.assertIn(9500, [f["price"] for f in fares if f["top"]])
        self.assertEqual(min(f["price"] for f in fares), 6700)


class EmptyCabin(unittest.TestCase):
    def test_both_lists_null_is_no_fares(self):
        payload = "data:" + json.dumps([None, None, None, None, None, None, None, [None, [[], []]]]) + ",x"
        self.assertEqual(parse_both(payload), [])

    def test_empty_lists_are_no_fares(self):
        self.assertEqual(parse_both(js(None, [])), [])


def decode(query) -> dict:
    """Decode the tfs protobuf blob into (legs, seat, passengers, trip) using the library's own pb module."""
    import base64
    from fast_flights.pb import flights_pb2
    info = flights_pb2.Info()
    info.ParseFromString(base64.urlsafe_b64decode(query.params()["tfs"]))
    return {"legs": [(leg.date, leg.from_airport.airport, leg.to_airport.airport) for leg in info.data],
            "seat": info.seat, "passengers": list(info.passengers), "trip": info.trip}


class QueryConstruction(unittest.TestCase):
    base = {"origin": "TPE", "destination": "OKA", "departureDate": "2027-01-08",
            "returnDate": "2027-01-11", "currency": "TWD"}

    def test_missing_fields_stay_one_adult_economy_round_trip(self):
        from server import build_query
        got = decode(build_query(self.base))
        self.assertEqual(got["passengers"], [1])
        self.assertEqual((got["seat"], got["trip"]), (1, 1))
        self.assertEqual([leg[1:] for leg in got["legs"]], [("TPE", "OKA"), ("OKA", "TPE")])

    def test_party_and_cabin_are_carried(self):
        from server import build_query
        got = decode(build_query({**self.base, "adults": 2, "children": 1, "cabin": "business"}))
        self.assertEqual(sorted(got["passengers"]), [1, 1, 2])
        self.assertEqual(got["seat"], 3)

    def test_infants_are_checked_but_never_sent_to_the_source(self):
        # The source prices infants backwards (docs/research/fast-flights-limits.md): the link carries them, the query does not.
        from server import build_query
        with_infants = decode(build_query({**self.base, "adults": 2, "children": 1, "infants": 2}))
        without = decode(build_query({**self.base, "adults": 2, "children": 1}))
        self.assertEqual(with_infants, without)
        for bad in ({"infants": 2}, {"adults": 5, "children": 3, "infants": 2}, {"infants": "1"}, {"infants": -1}):
            with self.assertRaises(ValueError):
                build_query({**self.base, **bad})

    def test_each_cabin_has_its_own_seat(self):
        from server import build_query
        seats = [decode(build_query({**self.base, "cabin": c}))["seat"] for c in ("economy", "premium-economy", "business", "first")]
        self.assertEqual(seats, [1, 2, 3, 4])

    def test_one_way_has_a_single_leg_and_ignores_return_date(self):
        from server import build_query
        got = decode(build_query({**self.base, "tripType": "one-way"}))
        self.assertEqual(got["trip"], 2)
        self.assertEqual(len(got["legs"]), 1)
        got = decode(build_query({k: v for k, v in self.base.items() if k != "returnDate"} | {"tripType": "one-way"}))
        self.assertEqual(len(got["legs"]), 1)

    def test_rejects_bad_party_and_cabin(self):
        from server import build_query
        for bad in ({"adults": 0}, {"adults": 5, "children": 5}, {"adults": "2"}, {"children": -1}, {"cabin": "infant"}, {"tripType": "multi"}):
            with self.assertRaises(ValueError):
                build_query({**self.base, **bad})


class MissingSource(unittest.TestCase):
    def post(self, html, extra=None):
        import threading
        from http.client import HTTPConnection
        from http.server import ThreadingHTTPServer
        from unittest.mock import MagicMock, patch
        from server import Handler
        client = MagicMock()
        client.get.return_value = MagicMock(status_code=200, text=html)
        body = json.dumps({"origin": "TPE", "destination": "OKA", "departureDate": "2027-01-08",
                           "returnDate": "2027-01-11", "currency": "TWD", **(extra or {})})
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        try:
            with patch("primp.Client", return_value=client):
                conn = HTTPConnection("127.0.0.1", httpd.server_port)
                conn.request("POST", "/search", body, {"Content-Length": str(len(body))})
                response = conn.getresponse()
                result = (response.status, response.reason, response.read())
                conn.close()
                return result
        finally:
            httpd.shutdown()
            httpd.server_close()

    def test_page_without_the_data_script_is_503(self):
        status, reason, _ = self.post("<html></html>")
        self.assertEqual((status, reason), (503, "Flight source unavailable"))

    def test_empty_first_class_answers_200_with_no_fares(self):
        empty = json.dumps([None, None, None, None, None, None, None, [None, [[], []]]])
        status, _, body = self.post(f"<html><script class='ds:1'>data:{empty},x</script></html>", {"cabin": "first"})
        self.assertEqual((status, json.loads(body)), (200, []))

    def test_invalid_party_is_503_not_a_search(self):
        status, _, _ = self.post("<html></html>", {"adults": 0})
        self.assertEqual(status, 503)


if __name__ == "__main__":
    unittest.main()
