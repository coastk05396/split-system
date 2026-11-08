# Price Strip reads background Fare Snapshots, not live searches

The Price Strip shows the cheapest fare of every day of a month. `fast-flights` only searches one date per call, so a live month view would mean about thirty Google requests behind one page visit, a wait of many seconds, and a request burst Google is likely to challenge (see ADR 0006).

A scheduled job, an extension of the existing daily handler, fills Fare Snapshots instead. Each run takes a rotating few popular routes from the catalogue, asks the flight source for the next thirty days one date at a time, and pauses between requests. A failing date is skipped and keeps its older snapshot. The Price Strip reads only the stored snapshots and shows how old they are. A route with none shows an "unavailable" line, and no User request ever triggers a fetch.

Considered and rejected: a live month search on page open (slow, a burst of requests, gives the User a spinner), and filling the strip from the existing fare history (one price per day of observation, not per departure day).

The cost is that prices can be up to a few days old, and a route outside the rotation has no strip until its turn. A snapshot is a round-trip outbound price for a three-day stay, because the source only supports round trips.
