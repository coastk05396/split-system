# Flight source container

Flight Radar uses the existing shared D1 database. Apply migrations through the normal deployment workflow. The flight source requires Cloudflare Workers Paid and Docker when building its image. No additional flight API keys are required. Wrangler binds `FLIGHT_CONTAINER` in local, staging and production configurations; it sleeps after ten idle minutes. Local flight searches require Docker; the rest of the app and dependency-injected tests can run without it.

The pinned `fast-flights` parser uses native `primp` and `selectolax`. HTTP failures, timeouts, consent walls and unsupported response shapes degrade to Google Flights links. The adapter never retries challenges or uses paid proxy integrations. The native `span.gOatQ` price label is allowlisted to low/typical/high; markup changes make it unknown. No percentage or selected inbound itinerary is inferred from outbound-only responses. Return times are null until a source provides actual selected return details.

Run the offline parser boundary fixture with `python3 -m unittest discover -s apps/worker/flight-container` from the repository root. CI runs this without network access. To smoke-test the image locally, build `docker build -t split-flights apps/worker/flight-container`, run it on port 8080 and submit a future round-trip search to `/search`; live availability remains dependent on Google.

Sources: [Cloudflare container setup](https://developers.cloudflare.com/containers/get-started/) and [fast-flights](https://github.com/AWeirdDev/flights). Live source and deployment tests are distinct from the offline fixture checks.
