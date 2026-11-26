# Coding standards

Read during code review. Anything a linter or the type checker can catch lives in `eslint.config.js` and CI, not here; this file holds judgement calls only.

## Tests

- Assert on a URL by parsing it: `new URL(value)`, then check both `origin` and `pathname`. A `toMatch` on the path also accepts a relative URL, which a caller that needs an absolute one then rejects. ESLint rejects a `toContain`/`toMatch` on an absolute URL string; pairing `origin` with `pathname` is the reviewer's check.

## Logging

- No log line carries a request URL, a secret or personal data, and an error log also carries its event name, the role or route, and the error class. SerpApi puts `api_key` in the query string, so an error from an outside fetch is logged by class, while `String(error)` is fine for an `ApiError` our own code raised.

## Data and money

- A Group's Members, Expenses and Settlements change only through its Group ledger, and the D1 copies of them (Group directory, Member summary, Personal spending, Invites) are written only by the ledger's projection, never directly (ADR 0005). Users, Identities and Sessions are the Worker's. A Group reservation is taken and released by the Worker around a join or create, and settled by the ledger once the seat exists.
- Money is integer minor units end to end, and no Balance or total appears on screen before the server has answered (ADR 0004). A saving row may show the amount that was typed, and recording or undoing a Settlement moves its two Balances at once, because that figure is exact.

## API and errors

- A refusal is an `ApiError` code with a message in both zh-TW and en; the client shows the translated message, never the raw code.

## Auth

- A credential, meaning anything that alone lets its holder act (a refresh token, a Link code, a bearer for a pending step), is stored only as its hash, verified before anything is spent, and single-use where the spec says so. An identifier that works only together with a credential, such as a row id checked against the Session, may be stored as is.

## Tests

- Assert through a public seam: the worker API via `createApp`, the scheduled handler, a rendered page, or Playwright. Setup and fault injection may reach inside (seeding rows, making a ledger fail), but an assertion never reads internal tables or calls internal helpers.
