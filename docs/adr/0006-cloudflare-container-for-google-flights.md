# Cloudflare Container for Google Flights queries

SPEC v1 restricted the deployment to the Cloudflare Free Tier and a single TypeScript Worker. Flight Radar needs live Google Flights fares and Google's own price-level classification (`low`, `typical`, `high`) through `AWeirdDev/flights` (`fast-flights`), whose runtime depends on native Rust and C libraries (`primp` for browser TLS fingerprinting and `selectolax` for HTML parsing) that cannot run inside a TypeScript Worker or Cloudflare's Pyodide Python runtime.

We move to the Cloudflare Workers Paid plan ($5/month) and run `fast-flights` in a Cloudflare Container bound to the Worker. The Worker caches route-and-date results for a short window to limit upstream load and degrades to a pre-filtered Google Flights link (`?tfs=`) whenever upstream rate-limits or challenges a request, rather than attempting to bypass challenges.

Considered and rejected: rewriting the reverse-engineered Protobuf and script parser in TypeScript on plain Worker `fetch` (fragile against markup shifts and exposed to datacenter TLS fingerprinting) and running an external Python service on another cloud (splits secrets, CI/CD, and operations across two providers).

The cost is the $5/month platform floor, requiring Docker when building or testing the container locally, and a cold-start delay of a few seconds when waking an idle container.
