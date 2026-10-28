---
title: Decide placeholder Members
type: wayfinder:grilling
mode: HITL
status: closed
assignee: rick
parent: ../map.md
blocked_by: []
---

## Question

Can someone who has not joined yet be added to a Group first, so Expenses can include them, and be linked to their real account when they join? Decide: who can add such a placeholder and with what; how the real person claims it when they join through an Invite (and how a wrong claim is handled); what a placeholder can and cannot do (be a payer, take part in splits, confirm a Settlement); how the privacy rules apply to a name typed by someone else; and what changes in the data model and the API contract.

## Resolution

- **Adding a placeholder:** any Member can add a placeholder (待加入成員) by typing a name, with no account and no picture. It shows an initial in a dashed circle with "(未加入)". It counts toward the 30-Member cap and its name must be unique in the Group. Expenses, splits and Balances work for it like for anyone. An admin can remove a placeholder only at a zero Balance, the same rule as for a leaving Member.
- **Claiming it:** when the real person joins through an Invite, the join screen asks "你是這些人之一嗎？" and lists the unclaimed placeholders by name only. Picking one shows a confirmation of what they take on ("你會承接 小宇 的 3 筆帳，應付 NT$ 200"); once confirmed the placeholder row becomes theirs and keeps all its history. Or they join as a new Member. A wrong claim has no undo; an admin can fix mistakes with "合併成員", which merges two Member rows and adds their Balances.
- **What a placeholder can do:** it can be a payer and a split participant, since a friend who paid before joining is common. It cannot sign in. A Settlement to or from it is recorded by an admin, who also confirms it on its behalf.
- **Privacy of a typed name:** a placeholder holds only a typed name. When someone claims it, the screen says who typed the name, which follows the notice rule for data not given by the person. Removing a placeholder or deleting the Group deletes the name. A placeholder nobody claims stays until the Group is deleted.
- **Data model and API:** `member.status` gains a third value, `placeholder`, next to `active` and `former`; `user_id` is already nullable; `member` gains `created_by_member`. New routes: `POST /groups/:id/members` (add a placeholder), `POST /invites/:token/claim` (claim one) and `POST /groups/:id/members/:mid/merge` (admin merge). The per-User Group cap of 20 counts only active Members, so placeholders do not use it. These amendments are noted on the data model and API contract tickets.

Divergences from the designs are added to `docs/design-changes.md`.
