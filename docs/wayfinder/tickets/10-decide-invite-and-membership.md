---
title: Decide invites and membership rules
type: wayfinder:grilling
mode: HITL
status: closed
assignee: rick
parent: ../map.md
blocked_by: ["05-research-line-platform.md"]
---

## Question

Invites are LINE-shared links (settled). Decide: Invite expiry and revocation, roles inside a Group, a Member leaving or being removed, and group deletion (see the 群組成員管理 and 刪除群組確認 frames) including what happens to unsettled debts.

## Blocked by

- [Research LINE LIFF, share and Bot constraints](05-research-line-platform.md)

## Resolution

- **Invite link:** a random, unguessable token (at least 128 bits) in `split.rickchen.si/join/<token>`, never a word code. Each Group has one active link, valid 7 days; an admin can regenerate it, which instantly kills the old one. No use limit. A Group holds at most 30 Members.
- **Joining:** a signed-in person who opens a valid link joins at once as a 成員, with no approval step. Someone not signed in signs in first and is then returned to the join. An existing Member just opens the Group. An expired, revoked or full-Group link shows a clear message. Sharing into LINE is user-initiated (share target picker, with copy-link fallback), so it is free and outside the LINE push quota.
- **Roles:** 管理員 (admin) and 成員. The creator is an admin and a Group may have several. Admins can regenerate the link, remove Members, promote or demote, edit the Group name and usage, and delete the Group. Any Member can add Expenses and edit or delete only the Expenses they created; admins can edit or delete any Expense. The last admin cannot leave or be demoted; they must promote someone else or delete the Group.
- **Leaving and removal:** a Member can leave, or an admin can remove them, only when their net balance in the Group is zero; otherwise it says "尚有 NT$ X 待結算" and blocks. A person who has left stays in old Expenses as "已離開的成員" with their name kept. A person who vanishes owing money cannot be force-removed; the Group can still be deleted.
- **Deleting a Group:** admin only; the admin types the Group name and sees any unsettled amount. It is a permanent hard delete of the Group, its Expenses, Settlements and invite link: no soft delete, no recovery, no notification to Members in v1.

Divergences from the designs, for **Reconcile the designs with the decisions**: the invite screen (screen 9, 邀請成員) shows `split.app/join/TAIWAN25`; it must show the `split.rickchen.si/join/<token>` form, the 7-day expiry and a regenerate action. The Members screen (screen 13, 群組成員管理) needs the "…" menu actions (promote, demote, remove) and a block message for a non-zero balance. The delete screen (screen 31, 刪除群組確認) matches the rules as designed. The create-group screen (screen 6, 建立與邀請群組) labels the currency "預設幣別"; it is the Settlement currency, fixed after the first Expense.
