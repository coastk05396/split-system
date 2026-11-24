---
status: accepted
---

# Direct Trip.com URL Inside the LINE Browser, Affiliate Parameters in the Daily Payload

Inside the LINE in-app browser a fare link goes through our own `/flights/go` redirect, so the URL handed to the external browser is on our domain and the later hop to Trip.com is a plain HTTP redirect that the phone may not pass to the Trip.com app. We now build the localized Trip.com URL on the client and hand it straight to `line.openExternal` in the tap handler. This amends ADR 0007's stateless redirect: `GET /flights/go` stays for external browsers and old links, but is no longer the only way a fare opens.

## Decision

1. `GET /flights/daily` also returns the public Trip.com affiliate parameters (`allianceId`, `sid`, `sub3`) that the redirect already appends (`sub3` is new: Trip.com's own link builder adds a fixed account value as `trip_sub3`, so the builder now appends it too), so the client can build the same URL with the shared URL builder. They are not secrets: they are visible in every final Trip.com URL. They stay Worker configuration, not `VITE_` build values, so changing them needs no web rebuild.
2. Inside LINE, a fare tap (on `/flights` and on the Home marquee, both through one shared anchor) opens the direct Trip.com URL synchronously via `line.openExternal`, with no intermediate request that could lose the user gesture. Outside LINE, links are unchanged.
3. Whether the Trip.com app opens is decided by the phone's operating system, not by us. The decision promises a direct, one-hop URL; app launch is checked on real devices and reported, not asserted in tests.

## Consequences

- Exception: until `GET /flights/daily` has answered (or when the client shows the curated fallback) the client has no affiliate parameters, and a direct URL would carry none, losing the commission. In that case the tap hands `line.openExternal` the absolute `/flights/go` URL (resolved against the page origin, because the LINE adapter rejects relative URLs) so the redirect adds them. This path may not launch the Trip.com app, which is acceptable for a short window.
- Moving the URL builder's use to the client puts the affiliate ids in the client; ADR 0007's open-redirect protection is untouched because the host stays fixed to `tw.trip.com` or `www.trip.com`.
- If real-device testing shows no app launch, the change is still correct (one hop, gesture kept) and the Home marquee still gains LINE handling.
