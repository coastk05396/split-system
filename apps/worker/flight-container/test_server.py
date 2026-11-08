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


class MissingSource(unittest.TestCase):
    def test_page_without_the_data_script_is_503(self):
        import threading
        from http.client import HTTPConnection
        from http.server import ThreadingHTTPServer
        from unittest.mock import MagicMock, patch
        from server import Handler
        client = MagicMock()
        client.get.return_value = MagicMock(status_code=200, text="<html></html>")
        body = json.dumps({"origin": "TPE", "destination": "OKA", "departureDate": "2027-01-08",
                           "returnDate": "2027-01-11", "currency": "TWD"})
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        try:
            with patch("primp.Client", return_value=client):
                conn = HTTPConnection("127.0.0.1", httpd.server_port)
                conn.request("POST", "/search", body, {"Content-Length": str(len(body))})
                response = conn.getresponse()
                conn.close()
                self.assertEqual((response.status, response.reason), (503, "Flight source unavailable"))
        finally:
            httpd.shutdown()
            httpd.server_close()


if __name__ == "__main__":
    unittest.main()
