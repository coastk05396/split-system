# Price Strip reads background Fare Snapshots, not live searches

The Price Strip shows the cheapest fare of every day of a month. `fast-flights` only searches one date per call, so a live month view would mean about thirty Google requests behind one page visit, a wait of many seconds, and a request burst Google is likely to challenge (see ADR 0006).

A scheduled job, an extension of the existing daily handler, fills Fare Snapshots instead. Each run covers the same fixed list of popular routes from TPE (NRT, KIX, OKA, ICN, BKK, HKG, a named constant in the job), so every listed route is at most a day old. It asks the flight source for the next thirty days one date at a time, and pauses 1.5 seconds between requests: 6 routes x 30 days = 180 requests, about 4.5 minutes of spacing per run. A failing date is skipped and keeps its older snapshot. The Price Strip reads only the stored snapshots and shows how old they are. A route outside the list, or with no snapshots, shows an "unavailable" line, and no User request ever triggers a fetch.

Considered and rejected: a live month search on page open (slow, a burst of requests, gives the User a spinner), and filling the strip from the existing fare history (one price per day of observation, not per departure day).

Considered and rejected: rotating through all 31 catalogue destinations, three a day, which left a route's snapshots about ten days old and most searched routes without a strip.

The cost is that only the listed routes ever have a strip, and a failing day keeps its older price until a later run succeeds. A snapshot is a round-trip outbound price for a three-day stay, because the source only supports round trips.
