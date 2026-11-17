"""Run: python -I -m unittest discover apps/worker/scripts/google-live-price"""

import json
import unittest

from adapter import exception_block_reason, read_page


def single_flight():
    f = [None] * 22
    f[3], f[4], f[5], f[6] = "TPE", "Taoyuan", "Hong Kong", "HKG"
    f[8], f[10], f[11], f[17] = [9, 30], [11, 40], 130, "A320"
    f[20], f[21] = [2026, 12, 12], [2026, 12, 12]
    return f


def entry(price):
    flight = [None] * 23
    flight[0], flight[1], flight[2] = "one-way", ["Hong Kong Express"], [single_flight()]
    flight[22] = [None] * 7 + [100, 120]
    return [flight, [[None, price]] if price is not None else []]


def page(entries):
    payload = [None] * 8
    payload[3] = [entries]
    payload[7] = [None, [[], [["UO", "Hong Kong Express"]]]]
    return (
        '<html><script class="ds:1">AF_initDataCallback({key: \'ds:1\', hash: \'2\', data:'
        + json.dumps(payload)
        + ", sideChannel: {}});</script></html>"
    )


EMPTY = page(None)


class ReadPage(unittest.TestCase):
    def test_price_less_itinerary_is_skipped_and_valid_ones_survive(self):
        reason, items, _ = read_page(page([entry(2260), entry(None), entry(3000)]))
        self.assertIsNone(reason)
        self.assertEqual([i["priceTwd"] for i in items], [2260, 3000])
        self.assertEqual(items[0]["airlines"], ["UO"])
        self.assertEqual(items[0]["transfers"], 0)
        self.assertEqual(items[0]["outboundDep"], "09:30")

    def test_only_price_less_itineraries_is_no_result(self):
        self.assertEqual(read_page(page([entry(None)])), ("no_result", [], None))

    def test_priced_itineraries_that_all_fail_to_parse_raise_so_the_caller_reports_error(self):
        broken = [[None] * 23, [[None, 5000]]]  # priced but malformed flight data
        with self.assertRaises(ValueError):
            read_page(page([broken]))

    def test_genuine_no_result_page(self):
        self.assertEqual(read_page(EMPTY), ("no_result", [], None))

    def test_bare_429_empty_and_payload_less_pages_are_blocked(self):
        self.assertEqual(read_page("Too Many Requests"), ("blocked", [], "no_payload"))
        self.assertEqual(read_page(""), ("blocked", [], "no_payload"))

    def test_explicit_markers_are_blocked(self):
        consent = "<form action='https://consent.google.com/save'></form>"
        self.assertEqual(read_page(consent), ("blocked", [], "consent"))
        self.assertEqual(read_page("<a href='/sorry/index'>x</a>" + EMPTY), ("blocked", [], "sorry"))
        self.assertEqual(read_page("Our systems detected unusual traffic"), ("blocked", [], "sorry"))


class ExceptionSignals(unittest.TestCase):
    def test_429_inside_an_id_is_not_a_block(self):
        self.assertIsNone(exception_block_reason(ValueError("bad candidate rt-TSA-PUS-4290")))

    def test_http_wording_is_a_block(self):
        self.assertEqual(exception_block_reason(RuntimeError("HTTP status 429")), "http")
        self.assertEqual(exception_block_reason(RuntimeError("403 Forbidden, status: 403")), "http")
        self.assertEqual(exception_block_reason(RuntimeError("Too Many Requests")), "http")


if __name__ == "__main__":
    unittest.main()
