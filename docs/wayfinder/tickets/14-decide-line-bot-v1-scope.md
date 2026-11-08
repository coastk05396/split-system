---
title: Decide the LINE Bot scope for v1
type: wayfinder:grilling
mode: HITL
status: closed
assignee: rick
parent: ../map.md
blocked_by: ["02-export-design-screens.md", "05-research-line-platform.md", "19-research-free-tier-fit.md"]
---

## Question

Rich Menu items and Flex Messages for v1 (see the LINE Bot 快速進入 and 圖文選單 frames): which events notify the chat, what the quick-entry link does, and what is explicitly left out.

## Blocked by

- [Export design screens to docs/screens](02-export-design-screens.md)
- [Research LINE LIFF, share and Bot constraints](05-research-line-platform.md)
- [Research whether free tiers carry v1](19-research-free-tier-fit.md)

## Resolution

- **Chat entry stays out of v1:** typing "晚餐 2160，四人均分" is not parsed. Free text in the chat gets one short reply, "點下方選單就能記帳 🌱", pointing at the menu. The welcome message no longer suggests a sentence to type. Chat entry can return later as its own feature.
- **Rich Menu:** one static default menu for everyone with the six buttons in the frame. Each is a link into the LIFF app: 快速分帳 opens the Group list with a Running Tab ready to create; 我的旅程 opens the last-used Trip; 記一筆 opens the add-Expense form; 查看結算 opens the debts screen; 邀請夥伴 opens the Invite screen; 使用幫助 gets a free reply with a short help text. No per-user menus. Chat bar text is 小芽快捷選單 (within the 14-character limit).
- **What the Bot ever sends:** only replies (free): the welcome message when someone adds the account, the help text, and the one-line menu pointer for free text. No pushes, no scheduled reminders, no group-chat notifications. Invites and settlement summaries are Flex cards that a person shares themselves through the LIFF share picker.
- **Group chats:** the Bot is not added to LINE group chats in v1. Sharing into a group chat works through the share picker without the Bot joining.
- **Webhook:** handle only follow, message and the help postback. Verify the signature on the raw body, answer with the reply token and make no further calls. Ignore every other event type, including unfollow. A failed reply is dropped, not retried.

Divergences from the designs, for **Reconcile the designs with the decisions**: the quick-entry screen (screen 8, LINE Bot 快速進入) shows a chat that parses "晚餐 2160，四人均分" and replies with a recorded Expense; it must show the menu-first flow instead. The welcome bubble on the Rich Menu screen (screen 16, LINE Bot 圖文選單) suggests typing that sentence and must change to a pointer at the menu. The notification-style content of both frames is replaced by share-only Flex cards.
