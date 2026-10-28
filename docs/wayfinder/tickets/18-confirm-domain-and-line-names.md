---
title: Confirm the domain and LINE console names
type: wayfinder:task
mode: HITL
status: closed
resolution: >-
  Confirmed by owner: (1) rickchen.si DNS is on Cloudflare (full zone, confirmed via NS). (2) LINE Official Account and LIFF app name is 小芽分帳; basic ID is free auto-assigned ID. (3) Google OAuth consent screen uses name 小芽分帳 and authorized domain rickchen.si. (4) Cloudflare R2: hold off receipt photos if card is required, otherwise proceed. (5) LIFF chat_message.write scope will be enabled.
assignee: rick
parent: ../map.md
blocked_by: []
---

## Question

Checklist for the owner, because the agent cannot do these: (1) confirm `rickchen.si` has its DNS on Cloudflare (a full zone), because a Worker custom domain for `split.rickchen.si` needs it; if not, say where the DNS lives. (2) In the LINE Developers console, confirm that the LINE Official Account name 小芽分帳 and an ID such as `@split` or `@xiaoya` are free, and that a LIFF app can use that name. (3) Confirm the Google Cloud OAuth consent screen can use the name 小芽分帳 and the authorised domain `rickchen.si`. Record the results (account IDs, who owns what); the answers decide the redirect and endpoint URLs in the API and sign-in tickets.

Added after **Research receipt images and LIFF messaging on free plans**: (4) in the Cloudflare dashboard, check whether enabling R2 asks for a payment method; if it does, say so, because receipt photos then fall back to small D1 images or are left out.

Added after **Decide the add-Expense form features**: (5) when the LIFF app is registered, enable the `chat_message.write` scope so the "send to the current LINE chat" checkbox can work, and confirm with a real test from a group chat that a message sent this way does not appear to count against the Official Account's monthly message quota.

## Partial result (checked from a public DNS lookup)

- **Item 1 is confirmed:** `rickchen.si` uses Cloudflare's nameservers (`coen.ns.cloudflare.com` and `teagan.ns.cloudflare.com`), so it is a full Cloudflare zone and a Worker custom domain can be attached. `split.rickchen.si` has no record yet, so the name is free to use.
- **Still needed from the owner:** items 2, 3, 4 and 5, which need a login to the LINE Developers console, Google Cloud and the Cloudflare dashboard.

Added after **Research Taiwan privacy and platform policy duties**: item 3 also needs (a) the Google consent screen set to the In production status, because Testing status allows only 100 test users and their authorisations expire after seven days, (b) the app's home page, privacy and terms links filled in, and (c) `rickchen.si` verified in Google Search Console. After publishing, check whether Google shows the unverified-app screen for the basic sign-in scopes, because unverified apps that show it are capped at 100 new users in total (it is unconfirmed whether `openid`, `email` and `profile` are all classed non-sensitive).
