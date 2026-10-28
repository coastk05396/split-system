---
title: Research LINE LIFF, share and Bot constraints
type: wayfinder:research
mode: AFK
status: closed
assignee:
parent: ../map.md
blocked_by: []
---

## Question

From LINE developer docs: how to verify a LIFF ID token on a Worker; prerequisites and limits of the LIFF share target picker (which contexts, which scopes); Messaging API webhook signature verification and response-time expectations; Flex Message and Rich Menu limits; and how LIFF behaves in an external browser versus in the LINE app.

## Resolution

Put the LIFF channel and the Bot under one provider so the LINE user ID is the same in both. Verify the LIFF ID token locally on the Worker: ES256, checked against `api.line.me/oauth2/v2.1/certs`, with `iss`, `aud` and `exp` checked. Verify the Bot webhook with HMAC-SHA256 over the raw body; reply 2xx within 2 seconds and do the work in `waitUntil` (best-effort, per the hosting research). Enable shareTargetPicker per channel and send invites as Flex with URI actions only, plus a copy-link fallback for external browsers and desktop.

Unconfirmed in the findings: a LIFF-specific silent login, and a per-context support list for shareTargetPicker. The agent read the Messaging API and LIFF reference from LINE's docs-source repo (`line/line-developers-docs-source`) because developers.line.biz renders client-side; each fact cites the developers.line.biz URL.

Findings: branch `research/research-line-platform` on origin, file `docs/research/research-line-platform.md` (throwaway, never merged).
