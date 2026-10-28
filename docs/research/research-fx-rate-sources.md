# Research: daily FX rate sources for a TWD-home-currency expense app

All facts read on 2026-10-28 from the provider's own pages (URL cited per fact). "Unconfirmed" means the primary page did not state it. Pages were read through a summarising fetch tool, so quoted wording is the tool's rendering; re-verify before relying on any legal term.

Need: daily rate plus historical-date lookup for TWD, USD, JPY, THB, EUR, KRW, HKD, CNY, GBP, AUD (and other travel currencies), callable from a Cloudflare Worker and cacheable.

## Comparison

| | ECB reference rates | Frankfurter | ExchangeRate-API (open access) | Open Exchange Rates (free) | fawazahmed0 currency-api |
|---|---|---|---|---|---|
| TWD covered | **No** | Yes | Yes | Unconfirmed (claims 200+ currencies) | Yes (data for 2025-06-02) |
| Other 9 listed | All yes | All yes (spot check, 2025-06-02) | Yes | Unconfirmed | Yes |
| Cadence | Working days ~16:00 CET | Daily | Daily | Hourly (free) | "Daily Updated", time unstated |
| Historical by date | Yes | Yes, back to 1948 (blended) | Not on open endpoint (unconfirmed elsewhere) | Yes (all accounts) | Yes, `@{date}` |
| Free limits | None stated | No quotas; abuse rate limit, threshold unstated | Rate limited; 429, 20 min block | 1,000 req/month, USD base only | "No rate limits" (claimed) |
| API key | No | No | No (open access) | Yes (app ID) | No |
| Licence / attribution | Free use, must cite ECB, state modifications | Blended rates free incl. commercial; provider terms apply on direct provider queries | **Attribution required** (link); commercial OK; cache OK; **no redistribution** | Restrictive; see flags | CC0-1.0 repo licence |
| Worker fit | Excellent (static files) | Excellent (JSON, self-hostable) | Good | Weak (1k/month fine only with heavy caching) | Good (CDN static files, fallback host) |

## Per-source findings

### ECB euro foreign exchange reference rates
- 29 currencies vs EUR, including USD JPY GBP AUD CNY HKD KRW THB. **TWD is not included** (also no RUB). https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html (2026-10-28)
- Updated about 16:00 CET each working day (not TARGET closing days). Full history as CSV/XML, last 90 days as XML. Start of history not stated on the page. Same URL.
- Page says rates are for information only; use for transactions is strongly discouraged. Same URL.
- Reuse: free use of site information; must cite ECB and say if modified; no general commercial ban. https://www.ecb.europa.eu/services/disclaimer/html/index.en.html (2026-10-28)
- Worker fit: fetch the ZIP/XML feed on a schedule and store in KV or Cache API. Exact feed URL and per-request limits not read: unconfirmed.
- Does not cover TWD, so alone it cannot serve this app.

### Frankfurter (api.frankfurter.dev)
- Blends 106 central banks and official sources; ~228 currencies; daily; history to 1948; `?date=YYYY-MM-DD`; no quotas, abuse-prevention rate limit with no numeric threshold; no key. https://frankfurter.dev/ and https://frankfurter.dev/docs/ (2026-10-28)
- TWD is supported: `/v2/currency/TWD` lists 34 providers (including CBC, ECB, BIS, HKMA) with data 1981-01-02 to 2026-10-28. https://api.frankfurter.dev/v2/currency/TWD (2026-10-28)
- Spot check 2025-06-02 base EUR returned TWD, USD, JPY, THB, KRW, HKD, CNY, GBP, AUD. https://api.frankfurter.dev/v2/rates?date=2025-06-02&base=EUR&quotes=TWD,USD,JPY,THB,KRW,HKD,CNY,GBP,AUD (2026-10-28)
- Licence: project is open source (licence type not named on the page); blended rates free to use commercially; direct provider endpoints subject to each provider's terms. Docs encourage storing daily rates and offer Docker self-hosting. https://frankfurter.dev/ , https://frankfurter.dev/docs/
- Caveat: which provider wins for TWD in the blend, and any SLA/uptime: unconfirmed. Use `providers=` to pin a source.

### ExchangeRate-API
- Open access endpoint: no key, once-daily refresh, response includes next-update time, 429 when rate limited (20 min block), attribution link required, commercial use allowed, caching allowed, redistribution not allowed. https://www.exchangerate-api.com/docs/free (2026-10-28)
- 165 currencies; all ten target codes listed. https://www.exchangerate-api.com/docs/supported-currencies (2026-10-28)
- Terms: stored data may be reused for end use; redistribution and use in products offering programmatic access to rates are not permitted; free plans may change or be discontinued at any time without notice. https://www.exchangerate-api.com/terms (2026-10-28)
- Keyed free tier removes attribution and lists 1.5k req/min; Pro $10/month with 60-minute updates (same docs/free page). Historical access by plan: unconfirmed.
- Flag: no redistribution. Fine if the Worker only serves prefilled rates to the app's own users; risky if exposed as a generic rate service.

### Open Exchange Rates
- Free: hourly, 1,000 req/month, USD base only. Developer $12/month, 10k req. Historical rates available to all accounts. https://openexchangerates.org/signup (2026-10-28)
- Site terms bar profiting directly from provision of the information without a licence and bar commercial use by private consumers. https://openexchangerates.org/terms (2026-10-28). Attribution, caching and free-plan commercial terms sit in the services agreement (/services-agreement/), not read: unconfirmed. The acceptable-use page does not address them. https://openexchangerates.org/acceptable-use (2026-10-28)
- Flag: possible commercial-use restriction on the free plan; unconfirmed.

### fawazahmed0 currency-api (community, via jsdelivr / Cloudflare Pages)
- 200+ currencies, daily, `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@{date}/v1/currencies/{code}.json`, fallback `https://{date}.currency-api.pages.dev/...`, "No rate limits", CC0-1.0 repo licence, no key shown. https://github.com/fawazahmed0/exchange-api (2026-10-28)
- 2025-06-02 TWD file contained usd, jpy, thb, krw, hkd, cny, gbp, aud, eur. https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@2025-06-02/v1/currencies/twd.json (2026-10-28)
- No SLA, and no stated underlying data source or terms for the rates themselves: unconfirmed. Community project; best effort.

### Bank of Taiwan board rates (official TWD reference, not a daily API)
- 19 currencies (USD HKD GBP AUD JPY THB EUR KRW CNY, etc.), CSV/text download, history lookup tool. Rates are board prices for reference only, not transaction prices. https://rate.bot.com.tw/xrt?Lang=en-US (2026-10-28)
- No API stated; reuse terms not read: unconfirmed. Useful as a sanity check, not a primary feed.

## Worker platform notes
- Free plan: 50 subrequests per request, 100,000 requests/day; Cache API available with 50 put/match/delete per request. KV free limits not read: unconfirmed. https://developers.cloudflare.com/workers/platform/limits/ (2026-10-28)
- Rates change once daily, so a lazy fetch with a ~24 h TTL in Cache API/KV keeps upstream calls to a handful per day.

## Terms flags
- ExchangeRate-API open access: attribution required; redistribution forbidden.
- Open Exchange Rates: restrictive site terms; free-plan commercial/attribution terms unconfirmed.
- ECB: no TWD; cite ECB; "information only" disclaimer.
- Frankfurter: direct provider queries inherit that provider's terms.

## Recommendation
- Primary: Frankfurter (hosted API, or self-hosted Docker if an SLA matters). Covers TWD and all listed currencies, no key, no quotas, date lookup, blended rates stated free for commercial use.
- Cache each (date, currency) result in Cache API/KV; the snapshot stored on each Expense means history is never re-queried.
- Fallback: ExchangeRate-API open access (TWD covered, daily, commercial and caching allowed; add the attribution link, never re-expose the raw feed). Last resort: fawazahmed0 (CC0, date-addressable).
- Use ECB only for non-TWD cross-checks; it cannot cover TWD.
