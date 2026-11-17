"""Run: python -I -m unittest discover apps/worker/scripts/google-live-price"""

import json
import unittest

import io
from unittest import mock

import adapter
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

    def test_bare_429_and_403_pages_are_blocked(self):
        self.assertEqual(read_page("Too Many Requests", 429), ("blocked", [], "http"))
        self.assertEqual(read_page("", 403), ("blocked", [], "http"))

    def test_explicit_markers_are_blocked(self):
        consent = "<form action='https://consent.google.com/save'></form>"
        self.assertEqual(read_page(consent), ("blocked", [], "consent"))
        self.assertEqual(read_page("<a href='/sorry/index'>x</a>" + EMPTY), ("blocked", [], "sorry"))
        self.assertEqual(read_page("Our systems detected unusual traffic"), ("blocked", [], "sorry"))


class Status(unittest.TestCase):
    def test_429_and_403_statuses_are_blocked_even_with_a_payload(self):
        self.assertEqual(read_page(EMPTY, 429), ("blocked", [], "http"))
        self.assertEqual(read_page("", 403), ("blocked", [], "http"))

    def test_confirmed_5xx_is_an_error_not_a_block(self):
        self.assertEqual(read_page("<html>Bad Gateway</html>", 502), ("error", [], None))
        self.assertEqual(read_page("", 503), ("error", [], None))

    def test_payload_less_page_is_an_error_tagged_no_payload_not_a_block(self):
        self.assertEqual(read_page("<html>hi</html>", 200), ("error", [], "no_payload"))
        self.assertEqual(read_page("<html>hi</html>", None), ("error", [], "no_payload"))
        self.assertEqual(read_page(""), ("error", [], "no_payload"))

    def test_a_200_with_results_is_parsed(self):
        reason, items, _ = read_page(page([entry(2260)]), 200)
        self.assertEqual((reason, [i["priceTwd"] for i in items]), (None, [2260]))


def run_main(candidates, pages):
    """Runs main() with fetch and sleep stubbed; returns (results, sleeps, fetch count)."""
    pages = list(pages)
    fetched = []

    def fake_fetch(_q):
        fetched.append(1)
        return pages[len(fetched) - 1]

    sleeps = []
    out = io.StringIO()
    with mock.patch.object(adapter, "fetch_page", fake_fetch), mock.patch.object(
        adapter.time, "sleep", sleeps.append
    ), mock.patch("sys.stdin", io.StringIO(json.dumps(candidates))), mock.patch("sys.stdout", out):
        adapter.main()
    return json.loads(out.getvalue()), sleeps, len(fetched)


def cand(i):
    return {"id": f"c{i}", "origin": "TPE", "dest": "HKG", "tripType": "ow", "outDate": "2026-12-12", "inDate": None}


class MainLoop(unittest.TestCase):
    def test_queries_sequentially_with_a_3_second_pause_between_queries(self):
        results, sleeps, fetched = run_main([cand(1), cand(2), cand(3)], [(200, page([entry(1000)]))] * 3)
        self.assertEqual([r["id"] for r in results], ["c1", "c2", "c3"])
        self.assertEqual([r["reason"] for r in results], [None, None, None])
        self.assertEqual(sleeps, [3.0, 3.0])
        self.assertEqual(fetched, 3)

    def test_stops_at_the_first_block_and_does_not_query_the_rest(self):
        pages = [(200, page([entry(1000)])), (429, "Too Many Requests"), (200, page([entry(1000)]))]
        results, sleeps, fetched = run_main([cand(1), cand(2), cand(3)], pages)
        self.assertEqual([r["reason"] for r in results], [None, "blocked"])
        self.assertEqual(results[1]["blockedReason"], "http")
        self.assertEqual(fetched, 2)
        self.assertEqual(sleeps, [3.0])

    def test_a_payload_less_page_is_tagged_and_does_not_stop_the_run(self):
        pages = [(200, "<html>odd</html>"), (200, page([entry(1000)]))]
        results, _, fetched = run_main([cand(1), cand(2)], pages)
        self.assertEqual([r["reason"] for r in results], ["error", None])
        self.assertEqual(results[0]["errorReason"], "no_payload")
        self.assertEqual(fetched, 2)

    def test_a_5xx_or_error_does_not_stop_the_run(self):
        pages = [(503, "down"), (200, page([entry(1000)]))]
        results, _, fetched = run_main([cand(1), cand(2)], pages)
        self.assertEqual([r["reason"] for r in results], ["error", None])
        self.assertEqual(fetched, 2)


class ExceptionSignals(unittest.TestCase):
    def test_429_inside_an_id_is_not_a_block(self):
        self.assertIsNone(exception_block_reason(ValueError("bad candidate rt-TSA-PUS-4290")))

    def test_http_version_and_status_wording_is_a_block(self):
        for text in ["HTTP/2 429", "HTTP/1.1 403", "HTTP/3 429 Too Many Requests", "status code: 429", "Too Many Requests"]:
            self.assertEqual(exception_block_reason(RuntimeError(text)), "http", text)

    def test_http_wording_is_a_block(self):
        self.assertEqual(exception_block_reason(RuntimeError("HTTP status 429")), "http")
        self.assertEqual(exception_block_reason(RuntimeError("403 Forbidden, status: 403")), "http")
        self.assertEqual(exception_block_reason(RuntimeError("Too Many Requests")), "http")


if __name__ == "__main__":
    unittest.main()
