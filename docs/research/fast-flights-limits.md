# fast-flights 3.1.0: speed and passenger/cabin limits

Research for #118 (spec #115). No product code changed. Measured 2026-11-08.

## Method

- Library read from the installed source (`fast_flights/querying.py`, `pb` enums), not only the README. Pinned `fast-flights==3.1.0` as in `apps/worker/flight-container/requirements.txt`.
- Host python (pyenv 3.14.4) has no working `ssl`, so a throwaway venv was made with `uv venv --python 3.12`.
- Requests mirror `server.py search()`: primp `Client(impersonate="chrome_145", impersonate_os="macos", referer=True, cookie_store=True, timeout=20)`, `GET https://www.google.com/travel/flights`, TPE to OKA round trip, 2026-12-08 out / 2026-12-13 back, TWD, `hl=en`. A new `Client` per request, as `search()` does.
- 12 requests in total, one at a time, about 6 s apart. No retries, no proxies. Google never blocked, consent-walled or captcha'd any request (all HTTP 200 with the `script.ds:1` payload).

## Latency

Timer covers the HTTP GET only (request sent to response received). It excludes parsing and the container hop.

| Request | Seconds |
| --- | --- |
| economy, 1st call | 0.28 |
| economy, repeat 1 | 0.22 |
| economy, repeat 2 | 0.20 |
| economy, repeat 3 | 0.25 |
| premium-economy | 0.19 |
| business | 0.20 |
| first | 0.35 |
| 2 adults | 0.19 |
| 1 adult + 1 child | 0.18 |
| 1 adult + 1 infant on lap | 0.17 |
| 1 adult + 1 infant in seat | 0.32 |
| 2 adults + 1 infant on lap | 0.21 |

- All 12: median 0.205 s, worst 0.35 s.
- Four identical economy searches: median 0.235 s, worst 0.28 s.
- Not measured: **container cold start** (boot of the container, which the issue calls "cold container"), the Worker-to-container hop, and parse time. Everything above ran from this machine (WSL, residential network) against Google directly, from a Python process that had already imported the libraries. The first economy call (0.28 s) was about the same as repeats (0.20 to 0.25 s), but that is not a cold container. The one failed parse (first class, below) took 0.53 s wall including its 0.35 s fetch.
- Google never throttled in this sample, but 12 requests spaced 6 s says nothing about the rate the Fare Snapshot job (dozens of dates per route) would hit. Pacing and block behaviour at that volume are unmeasured.

## Parameters

The library accepts all of them when building the query. Whether Google honours them was checked by comparing returned prices (same route and dates; economy, 1 adult baseline: cheapest 5590 TWD, 11 itineraries kept by `normalize`).

| Parameter | Library | Evidence from live search | Verdict |
| --- | --- | --- | --- |
| adults | `Passengers(adults=n)` | 2 adults: cheapest 11180 = 2 x 5590 (total for the party). | Supported |
| children | `Passengers(children=n)` | 1 adult + 1 child: cheapest 11180 (priced like a second adult seat; fewer itineraries, 7). | Supported |
| infants | `infants_in_seat`, `infants_on_lap` (two fields; asserts `infants_on_lap <= adults` and total <= 9) | Accepted, HTTP 200, but pricing is counter-intuitive: `infants_on_lap=1` with 1 adult cost 11180 (a full seat); `infants_in_seat=1` cost 5590 (infant not priced). 2 adults + 1 lap infant cost 16770 (3 x 5590). The library enum is 3 = in seat, 4 = on lap; I could not tell whether this is a mapping bug or Google behaviour. | Accepted, price semantics unverified; do not rely on it |
| cabin: economy | `seat="economy"` | Baseline, 11 itineraries. | Supported |
| cabin: premium-economy | `seat="premium-economy"` | Cheapest 12611, only 2 itineraries. | Supported (sparse on this route) |
| cabin: business | `seat="business"` | Cheapest 28419, 6 itineraries. | Supported |
| cabin: first | `seat="first"` | Google returned a payload with `payload[2]` and `payload[3]` both `None` (no first-class itineraries on TPE-OKA). `server.parse_both` then raised `TypeError: 'NoneType' object is not subscriptable`, which `Handler.do_POST` turns into a 503. | Accepted by the library; an empty result crashes the parser. Needs a "no results" path |
| round trip / one way | `trip="round-trip"` / `"one-way"` | `round-trip` used throughout. `one-way` not run live. | Library accepts; not verified live |

Other library facts relevant to the spec:

- Prices are for the whole party, so a per-person figure needs dividing.
- The library has no month or date-range query; `FlightQuery.date` is one date. This confirms the spec's claim that the Price Strip needs one request per date.
- Round-trip results are outbound options priced for the round trip (existing comment in `server.py`).

## What ticket 9 (passengers and cabin) can and cannot include

Can include (`search()` currently hard-codes `Passengers(adults=1)` and `seat="economy"`, so the intent needs new fields plumbed through):

- Adults (1 to 9) and children.
- Cabin: 經濟艙 (`economy`), 豪華經濟艙 (`premium-economy`), 商務艙 (`business`), 頭等艙 (`first`), once the parser fix below is made.
- One way, subject to a live check when implemented.

Cannot include yet, or only with extra work:

- Infants: the library splits "in seat" and "on lap", the spec has one infants count, and live pricing of both was surprising (see table). Either leave infants out of the PR, or first resolve which field Google treats as which (for example by comparing with the Google Flights page for the same query) and settle on one mapping. The spec's rule "infants never exceed adults" matches the library's assertion only for lap infants.
- Cabins with no itineraries (first class on a thin route, possibly premium-economy): `parse_both` must tolerate `payload[2]` and `payload[3]` being `None` and return an empty list; today the container answers 503. The UI needs an empty-cabin message instead of an error.
- Any claim about cold-container latency, or about sustained request volume, until measured inside the container and at job pace.

Also: prices change with the passenger count and cabin, so Fare Snapshots (and the Price Strip) should stay keyed to a fixed 1 adult economy search; they cannot honestly reflect a User's party or cabin.
