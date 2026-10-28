---
title: Decide the product name
type: wayfinder:grilling
mode: HITL
status: closed
assignee: rick
parent: ../map.md
blocked_by: []
---

## Question

What is the outward product name for the markets we ship to? 小芽 is the in-app name and sprout mascot (settled). Candidates discussed: 一起分, 小芽分帳, Sprout Split. Check availability of the domain, the LINE Official Account ID and the LIFF app name before locking it.

## Resolution

The outward name is **小芽分帳**, short form **小芽**, used everywhere in v1 (LINE Official Account, LIFF app, Google sign-in consent screen, all frames); 一起分 is dropped. 小芽 is a sprout logo plus a friendly voice in notifications and empty states, with no chat persona and no free-text conversation with the Bot. The web app lives at `split.rickchen.si` (a subdomain of the owner's own domain); the ASCII handle is `split`. A separate international brand waits for the Japan and Thailand effort, which is out of scope.

DNS check (A records only, not proof of availability): `xiaoya.app` and `yiqifen.com` resolve, so the earlier candidates were mostly taken; owning `rickchen.si` makes domain availability moot. LINE Official Account ID and LIFF app name could not be checked from here; see the follow-up task.
