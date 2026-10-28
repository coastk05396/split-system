---
title: Research receipt images and LIFF messaging on free plans
type: wayfinder:research
mode: AFK
status: closed
assignee:
parent: ../map.md
blocked_by: []
---

## Question

Two questions, primary sources only, all-free constraint: (1) Where can a receipt photo (JPG or PNG, a few hundred KB after client-side resizing) be stored for free next to a Cloudflare Worker and D1? Check Cloudflare R2's free allowance and whether enabling it needs a payment method on file, D1's 500 MB per database limit, and any other free option; include what it costs per image against the free limits, how access is restricted to Group Members, and how long images can be kept. (2) What does `liff.sendMessages` need and allow: required scope (`chat_message.write`), which chat contexts it works in (1:1 with the Official Account, group, room, external browser), whether messages it sends count against the Official Account's monthly message quota, and whether the message appears as sent by the user. Finish with a verdict for each and the cheapest option that stays free.

## Resolution

- **Receipt photo: fits with a change.** Cheapest free option: a private R2 bucket with reads proxied through the Worker, which checks Group membership. About 300 photos a month is roughly 90 MB, 300 Class A operations and no egress, far inside R2's free tier (10 GB, 1M Class A and 10M Class B operations a month). **Unconfirmed:** whether enabling R2 needs a payment method; the official docs only mention an "R2 subscription" checkout, so check the dashboard first (this is added to the owner's checklist). If a card is not acceptable, store images under 100 KB as D1 BLOBs with a retention window; at 300 KB each they would fill the 500 MB database in about 5.5 months.
- **Send to the current chat: fits with a change.** `liff.sendMessages` needs the `chat_message.write` scope and works only in the LIFF browser opened from a 1:1, group or multi-person chat; the message appears as sent by the user. **Unconfirmed:** LINE's docs never say whether it counts against the Official Account's monthly quota; it is not a Messaging API send, so it is inferred that it does not. Use `liff.shareTargetPicker` as the fallback for external browsers and non-chat launches; the user picks a target each time.

Findings: branch `research/receipt-images-and-liff-messaging` on origin, file `docs/research/research-receipt-images-and-liff-messaging.md` (throwaway, never merged; the agent could not run git, so the commit was made by hand and is unsigned).
