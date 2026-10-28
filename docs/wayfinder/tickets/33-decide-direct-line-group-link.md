---
title: Decide linking an app Group to a LINE group chat
type: wayfinder:grilling
mode: HITL
status: closed
resolution: >-
  Ruled out of v1 per research in 32-research-line-group-chat-linking.md. LIFF in-client does not expose verifiable group context, and the Bot is not added to group chats in v1. App groups continue to be shared and joined via time-limited Invite links using the LIFF shareTargetPicker.
assignee:
parent: ../map.md
blocked_by: ["32-research-line-group-chat-linking.md"]
---

## Question

The owner asked whether an app Group can be linked directly to a LINE group chat. This would reverse the decision that the Bot is not added to group chats in v1. Decide whether it ships in v1, how a Group is linked and unlinked, what opening the app from that chat does (go straight to the Group, join without an Invite link or still require it), how the link is kept safe, and what changes in the Bot scope, the data model and the API contract.

## Blocked by

- [Research LINE group chat context and linking](32-research-line-group-chat-linking.md)

Research result (from **Research LINE group chat context and linking**): a direct link does not fit; LIFF no longer reports which chat it was opened from, the group ID reaches only a Bot inside the group, and "opened from this chat" cannot prove membership or be revoked. Recommendation to the owner: keep the Invite link and rule this out of v1; a later version could add the Bot to the chat with a one-time code.

