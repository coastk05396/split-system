---
title: Decide abuse limits and observability
type: wayfinder:grilling
mode: HITL
status: closed
assignee: rick
parent: ../map.md
blocked_by: ["25-research-free-abuse-protection-and-observability.md"]
---

## Question

Using the free-plan research, decide the rate limits per route group (sign-in, join by Invite, Expense writes, receipt upload, exchange rate reads), where each limit is enforced, what a blocked caller sees (the 429 error code and its zh-TW message), whether Turnstile guards sign-in or join, what is logged and what is never logged (tokens, Invite links, amounts), how long logs live, and what tells the owner that the free limits are close.

## Blocked by

- [Research free abuse protection and observability](25-research-free-abuse-protection-and-observability.md)

## Resolution

- **Sign-in limits and Turnstile:** the one free WAF rule covers `/api/v1/auth/*`, counted by IP, at 20 requests per 10 seconds with a 10-second block (set above one person's need because phones on one mobile network can share an IP). No Turnstile in v1: sign-in needs a valid LINE or Google token that an attacker cannot forge, and a visible challenge inside the LINE browser adds friction. Turnstile can be added later if abuse appears.
- **Limits on writes, after sign-in:** once a request has a valid access token the Worker counts per User in a small D1 table, one row per User, route group and minute. Limits: Expense or Settlement create or edit 30 a minute; receipt upload 10 a minute; join by Invite 10 a minute; Group creation 5 an hour. Only signed-in requests are counted, so an anonymous attacker cannot burn D1 writes. If the Workers rate-limit feature turns out to be free (unconfirmed) it replaces the D1 table.
- **What a blocked caller sees:** HTTP 429 with the error code `RATE_LIMITED` and a `Retry-After` header; the SPA shows "操作太頻繁，請稍後再試". Any 429, 5xx or network failure that does not come from our code (for example Cloudflare's own over-limit page) uses the 網路錯誤與重試 screen, which says "服務今日使用量已滿，請明天再試" when the cause looks like the daily free limit.
- **What is logged:** each request logs a request ID, the route pattern (for example `/invites/:token`, never the real path), status, duration and the error code; errors add a stack trace with no payload. Never logged: tokens, Authorization or Cookie headers, Invite links, amounts, names or notes. Free logs live 3 days (7 days from 2026-12-01); no external log service.
- **Knowing the free limits are close:** a daily Cron Trigger (the free plan allows five) reads that day's request and D1 usage and sends one LINE message to the owner's own account only when any free limit passes 70%, at most about 30 of the 200 monthly messages and in practice far fewer. Whether Cloudflare's analytics API is free for this and what token it needs is unconfirmed; **Decide the deploy pipeline** checks it. If it is not workable the fallback is a weekly dashboard check on the release checklist.
- **Receipt upload limits:** the server rejects any file over 1 MB and checks that it is really a JPG or PNG by its first bytes, not its name. Each Group holds at most 200 receipts. Uploads are rate-limited as above.

Effects on closed tickets: the data model gains a small `rate_counter` table (user, route group, minute window, count) and the API contract gains the `RATE_LIMITED` error code; both are noted on those tickets.
