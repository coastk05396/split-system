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


if __name__ == "__main__":
    unittest.main()
