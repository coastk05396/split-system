# Coding standards

Read during code review. Anything a linter or the type checker can catch lives in `eslint.config.js` and CI, not here; this file holds judgement calls only.

## Tests

- Assert on a URL by parsing it: `new URL(value)`, then check both `origin` and `pathname`. A `toMatch` on the path also accepts a relative URL, which a caller that needs an absolute one then rejects. ESLint rejects a `toContain`/`toMatch` on an absolute URL string; pairing `origin` with `pathname` is the reviewer's check.

## Logging

- A log line carries the error class and the role or route, never the request URL: SerpApi puts `api_key` in the query string.

## Data and money

- A Group's Members, Expenses and Settlements change only through its Group ledger; D1 holds copies the ledger pushes, never a second write path (ADR 0005).
- Money is integer minor units end to end, and the screen shows only amounts the server computed, never a client-side guess (ADR 0004).

## API and errors

- A refusal is an `ApiError` code with a message in both zh-TW and en; the client shows the translated message, never the raw code.

## Auth

- A secret (token, code) is stored only as its hash, verified before anything is spent, and single-use where the spec says so.

## Tests

- Test through a public seam (the worker API via `createApp`, a rendered page, or Playwright), never by calling internal helpers or reading ledger tables.
