import json
from pathlib import Path
import unittest
from server import normalize

class ParserFixture(unittest.TestCase):
    def test_roundtrip_quote_does_not_invent_return_details(self):
        result = normalize(json.loads(Path(__file__).with_name("fare-fixture.json").read_text()), "TWD")
        self.assertEqual(result[0]["price"], 7000)
        self.assertIsNone(result[0]["inboundDeparture"])
        self.assertEqual(result[0]["priceLevel"], "unknown")
        self.assertEqual(result[0]["stops"], 0)
        self.assertEqual(result[0]["outboundDeparture"], "2026-12-04T08:00")

if __name__ == "__main__":
    unittest.main()

class NativePriceFixture(unittest.TestCase):
    def test_native_price_level_only_accepts_google_indicator(self):
        from server import native_price_level
        self.assertEqual(native_price_level('<span class="gOatQ">low</span>'), "low")
        self.assertEqual(native_price_level('<p>Low price</p>'), "unknown")
        self.assertEqual(native_price_level('<span class="gOatQ">unavailable</span>'), "unknown")
