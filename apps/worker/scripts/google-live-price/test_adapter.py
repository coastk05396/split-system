"""Run: python -I -m unittest discover apps/worker/scripts/google-live-price"""

import json
import unittest

import io
from unittest import mock

import adapter
from adapter import exception_block_reason, read_page


def single_flight(dep=(9, 30)):
    f = [None] * 22
    f[3], f[4], f[5], f[6] = "TPE", "Taoyuan", "Hong Kong", "HKG"
    f[8], f[10], f[11], f[17] = list(dep), [11, 40], 130, "A320"
    f[20], f[21] = [2026, 12, 12], [2026, 12, 12]
    return f


def no_legs(price):
    """A priced entry whose flight-leg list is empty."""
    e = entry(price)
    e[0][2] = []
    return e


def entry(price, airline="Hong Kong Express", dep=(9, 30)):
    flight = [None] * 23
    flight[0], flight[1], flight[2] = "one-way", [airline], [single_flight(dep)]
    flight[22] = [None] * 7 + [100, 120]
    return [flight, [[None, price]] if price is not None else []]


def page(other, best=None, payload3="group"):
    """`best` is payload[2][0] (best flights), `other` is payload[3][0] (other flights)."""
    payload = [None] * 8
    payload[2] = [best] if best is not None else None
    payload[3] = [other] if payload3 == "group" else payload3
    payload[7] = [None, [[], [["UO", "Hong Kong Express"], ["PR", "Philippines AirAsia"]]]]
    return (
        '<html><script class="ds:1">AF_initDataCallback({key: \'ds:1\', hash: \'2\', data:'
        + json.dumps(payload)
        + ", sideChannel: {}});</script></html>"
    )


EMPTY = page(None)


class BothGroups(unittest.TestCase):
    def test_low_cost_carrier_only_in_best_flights_is_found(self):
        reason, items, _ = read_page(page([entry(8066)], best=[entry(4670, "Philippines AirAsia")]))
        self.assertIsNone(reason)
        self.assertEqual([(i["priceTwd"], i["airlines"]) for i in items], [(4670, ["PR"]), (8066, ["UO"])])

    def test_best_flights_alone_with_other_group_empty(self):
        reason, items, _ = read_page(page(None, best=[entry(4670, "Philippines AirAsia")]))
        self.assertEqual((reason, [i["priceTwd"] for i in items]), (None, [4670]))

    def test_cheapest_survives_the_cap_even_when_it_comes_last(self):
        many = [entry(6000 + n, dep=(8, n % 60)) for n in range(60)]
        _, items, _ = read_page(page(many, best=[entry(4670, "Philippines AirAsia")]))
        self.assertEqual(items[0]["priceTwd"], 4670)
        self.assertEqual(len(items), 40)

    def test_same_itinerary_in_both_groups_is_listed_once(self):
        _, items, _ = read_page(page([entry(5000)], best=[entry(5000)]))
        self.assertEqual(len(items), 1)

    def test_price_less_entries_in_either_group_are_skipped(self):
        _, items, _ = read_page(page([entry(None), entry(7000)], best=[entry(None), entry(4670, "Philippines AirAsia")]))
        self.assertEqual([i["priceTwd"] for i in items], [4670, 7000])

    def test_missing_or_empty_groups_are_no_result_not_an_error(self):
        for payload3 in (None, [None], [], "group"):
            self.assertEqual(read_page(page([] if payload3 == "group" else None, payload3=payload3)), ("no_result", [], None), payload3)
        self.assertEqual(read_page(page(None, best=[])), ("no_result", [], None))


class MalformedEntries(unittest.TestCase):
    def test_priced_entry_with_empty_legs_is_skipped_and_the_valid_fare_survives(self):
        reason, items, _ = read_page(page([no_legs(3000), entry(5000)], best=[no_legs(2000)]))
        self.assertIsNone(reason)
        self.assertEqual([i["priceTwd"] for i in items], [5000])

    def test_page_where_every_priced_entry_is_malformed_raises_so_it_is_reported_as_error(self):
        with self.assertRaises(ValueError):
            read_page(page([no_legs(3000)]))


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
        self.assertEqual(read_page("<html>Bad Gateway</html>", 502), ("error", [], "server_error"))
        self.assertEqual(read_page("", 503), ("error", [], "server_error"))

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
        nxt = pages[len(fetched) - 1]
        if isinstance(nxt, Exception):
            raise nxt
        return nxt

    sleeps = []
    out = io.StringIO()
    with mock.patch.object(adapter, "fetch_page", fake_fetch), mock.patch.object(
        adapter.time, "sleep", sleeps.append
    ), mock.patch("sys.stdin", io.StringIO(json.dumps(candidates))), mock.patch("sys.stdout", out):
        adapter.main()
    return json.loads(out.getvalue()), sleeps, len(fetched)


def cand(i, allow_retry=True):
    c = {"id": f"c{i}", "origin": "TPE", "dest": "HKG", "tripType": "ow", "outDate": "2026-12-12", "inDate": None}
    if allow_retry is not None:
        c["allowRetry"] = allow_retry
    return c


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
        pages = [(200, "<html>odd</html>"), (200, "<html>odd</html>"), (200, page([entry(1000)]))]
        results, _, fetched = run_main([cand(1), cand(2)], pages)
        self.assertEqual([r["reason"] for r in results], ["error", None])
        self.assertEqual(results[0]["errorReason"], "no_payload")
        self.assertEqual(fetched, 3)

    def test_every_error_result_carries_its_category(self):
        broken = page([no_legs(3000)])
        pages = [(503, "down"), (503, "down"), (200, "<html>odd</html>"), (200, "<html>odd</html>"), (200, broken)]
        results, _, _ = run_main([cand(1), cand(2), cand(3)], pages)
        self.assertEqual([r["errorReason"] for r in results], ["server_error", "no_payload", "parse"])

    def test_an_unexpected_exception_is_tagged_with_its_type_only(self):
        def boom(_q):
            raise RuntimeError("secret detail https://example.test/?tfs=abc")

        out = io.StringIO()
        with mock.patch.object(adapter, "fetch_page", boom), mock.patch.object(
            adapter.time, "sleep", lambda _s: None
        ), mock.patch("sys.stdin", io.StringIO(json.dumps([cand(1)]))), mock.patch("sys.stdout", out), mock.patch(
            "sys.stderr", io.StringIO()
        ) as err:
            adapter.main()
        result = json.loads(out.getvalue())[0]
        self.assertEqual((result["reason"], result["errorReason"]), ("error", "exception:RuntimeError"))
        self.assertNotIn("secret", out.getvalue() + err.getvalue())

    def test_a_5xx_or_error_does_not_stop_the_run(self):
        pages = [(503, "down"), (503, "down"), (200, page([entry(1000)]))]
        results, _, fetched = run_main([cand(1), cand(2)], pages)
        self.assertEqual([r["reason"] for r in results], ["error", None])
        self.assertEqual(fetched, 3)


VERIFYING = "<html><title>Verifying...</title>Verifying your request... Please wait</html>"
GOOD = page([entry(1000)])


class RetryOnce(unittest.TestCase):
    def test_pause_is_ten_seconds(self):
        self.assertEqual(adapter.RETRY_PAUSE_SECONDS, 10)

    def test_a_payload_less_page_is_re_requested_once_after_10_seconds_and_can_recover(self):
        results, sleeps, fetched = run_main([cand(1)], [(200, VERIFYING), (200, GOOD)])
        self.assertEqual((results[0]["reason"], results[0]["retried"]), (None, True))
        self.assertEqual(results[0]["itineraries"][0]["priceTwd"], 1000)
        self.assertEqual((sleeps, fetched), ([10], 2))

    def test_no_retry_unless_the_caller_allows_it_run_wide_budget(self):
        for allow in (False, None):
            results, sleeps, fetched = run_main([cand(1, allow)], [(200, VERIFYING), (200, GOOD)])
            self.assertEqual((results[0]["reason"], results[0]["errorReason"]), ("error", "no_payload"), allow)
            self.assertEqual((sleeps, fetched), ([], 1), allow)
            self.assertNotIn("retried", results[0])
        results, _, fetched = run_main([cand(1, False)], [(503, "down"), (200, GOOD)])
        self.assertEqual((results[0]["errorReason"], fetched), ("server_error", 1))

    def test_a_5xx_is_retried_too(self):
        results, sleeps, fetched = run_main([cand(1)], [(503, "down"), (200, GOOD)])
        self.assertEqual((results[0]["reason"], sleeps, fetched), (None, [10], 2))

    def test_still_payload_less_after_the_retry_stays_an_error_and_is_not_retried_again(self):
        results, sleeps, fetched = run_main([cand(1)], [(200, VERIFYING), (200, VERIFYING), (200, GOOD)])
        self.assertEqual(
            (results[0]["reason"], results[0]["errorReason"], results[0]["retried"]),
            ("error", "no_payload", True),
        )
        self.assertEqual((sleeps, fetched), ([10], 2))

    def test_a_block_marker_on_the_retry_is_blocked_and_not_retried_again(self):
        consent = "<form action='https://consent.google.com/save'></form>"
        results, sleeps, fetched = run_main([cand(1)], [(200, VERIFYING), (200, consent), (200, GOOD)])
        self.assertEqual((results[0]["reason"], results[0]["blockedReason"]), ("blocked", "consent"))
        self.assertEqual((sleeps, fetched), ([10], 2))

    def test_a_blocked_first_page_is_never_retried(self):
        for first in [(429, "Too Many Requests"), (200, "<a href='/sorry/x'>"), (403, "")]:
            results, sleeps, fetched = run_main([cand(1)], [first, (200, GOOD)])
            self.assertEqual((results[0]["reason"], sleeps, fetched), ("blocked", [], 1), first)
            self.assertNotIn("retried", results[0])

    def test_parse_and_exception_errors_are_not_retried(self):
        for page_or_exc, why in [((200, page([no_legs(3000)])), "parse"), (RuntimeError("x"), "exception:RuntimeError")]:
            results, sleeps, fetched = run_main([cand(1)], [page_or_exc, (200, GOOD)])
            self.assertEqual((results[0]["errorReason"], sleeps, fetched), (why, [], 1))
            self.assertNotIn("retried", results[0])


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
