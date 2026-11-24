# Coding standards

Read during code review. Anything a linter or the type checker can catch lives in `eslint.config.js` and CI, not here; this file holds judgement calls only.

## Tests

- Assert on a URL by parsing it: `new URL(value)`, then check `origin` and `pathname`. A `toMatch` on the path also accepts a relative URL, which a caller that needs an absolute one then rejects.

## Logging

- A log line carries the error class and the role or route, never the request URL: SerpApi puts `api_key` in the query string.
