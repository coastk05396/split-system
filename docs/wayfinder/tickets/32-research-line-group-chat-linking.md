---
title: Research LINE group chat context and linking
type: wayfinder:research
mode: AFK
status: closed
assignee:
parent: ../map.md
blocked_by: []
---

## Question

Can an app Group be linked directly to a LINE group chat? Primary sources only (LINE developers docs), all-free constraint. Answer: (1) what `liff.getContext()` returns when the LIFF app is opened from a group chat or multi-person chat (type, `groupId`, `roomId`, `userId`), under which conditions the group ID is present (does the Official Account have to be a member of the chat, does the scope or the launch method matter), and how stable the ID is; (2) what the Official Account (Bot) can and cannot do inside a group chat on the free plan: join events, reply tokens and whether replies in a group count against the monthly quota, the mention-only behaviour, and whether the Bot can read the chat's member list or only the sender; (3) how someone can open the LIFF app from a chat in the first place (Rich Menu does not exist in group chats; a shared LIFF URL or a Flex message button does), so a direct link has a way in; (4) the security of treating 'opened from this LINE group chat' as proof of membership, including what happens when someone leaves the chat. Finish with a verdict (fits / fits with a change / does not fit) and the cheapest design that stays free.

## Resolution

Verdict: **does not fit as a direct link.**

- `liff.getContext()` returns `type` (`group`, `room`, `utou`, `external` or `none`) and `userId`. LINE discontinued `groupId`, `roomId` and `utouId` there, so the LIFF app cannot tell which chat it was opened from.
- The group ID is available only from Bot webhooks, which needs the Bot inside the group. Listing a group's members also requires a verified or premium account.
- Treating "opened from this chat" as proof of membership is spoofable and cannot be revoked when someone leaves the chat; the Bot learns about leavers only if it is in the chat.
- **Cheapest free design:** keep the Invite link shared with the share target picker, carrying a secret token in the LIFF URL's `liff.state`. If a real link is wanted later, add the Bot to the chat and have a member send a one-time code there; the reply is free and the webhook gives the `groupId`. Do not use push.
- **Unconfirmed:** the exact removal date of those fields, group ID stability, reply token lifetime and the Rich Menu claim.

Findings: branch `research/line-group-chat-linking` on origin, file `docs/research/research-line-group-chat-linking.md` (throwaway, never merged; the agent could not run git, so the commit was made by hand and is unsigned).
