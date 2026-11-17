"""Run: python -I -m unittest discover apps/worker/scripts/google-live-price"""

import unittest

from adapter import read_page

RESULTS = (
    '<html><script class="ds:1">AF_initDataCallback({key: \'ds:1\', hash: \'2\', '
    "data:[null,null,null,[null],null,null,null,[null,[[],[]]]], sideChannel: {}});</script></html>"
)


class ReadPage(unittest.TestCase):
    def test_bare_429_page_is_blocked(self):
        self.assertEqual(read_page("Too Many Requests"), ("blocked", []))

    def test_empty_body_is_blocked(self):
        self.assertEqual(read_page(""), ("blocked", []))

    def test_consent_page_is_blocked(self):
        html = "<html><body><form action='https://consent.google.com/save'></form></body></html>"
        self.assertEqual(read_page(html), ("blocked", []))

    def test_genuine_no_result_page_is_no_result(self):
        self.assertEqual(read_page(RESULTS), ("no_result", []))


if __name__ == "__main__":
    unittest.main()
