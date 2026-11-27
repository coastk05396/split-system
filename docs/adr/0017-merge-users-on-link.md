---
status: accepted
---

# Merge a second User when linking an Identity it already holds

Linking Google to a LINE User, or (newly) LINE to a Google User, failed with `IDENTITY_LINKED_ELSEWHERE` when that Identity already had its own User. Migration 0011 dropped every Google Identity, so some people now hold two Users, each with its own Groups. HackMD lets the signed-in account take in the other after a confirmation screen that shows what comes with it. We do the same.

## Decision

1. **Merge instead of refusing**: when the Identity being linked belongs to another User, a confirmation screen shows both Users (picture, name, LINE or Google tag), the Groups each brings, and "cannot be undone". Confirming folds the other User into the signed-in one; cancelling changes nothing and links nothing.
2. **The signed-in User survives**: whoever pressed "connect" keeps their settings, Profile source and, in a shared Group, their Member (nickname included). The other User's Identities and Groups move over, its Sessions end everywhere, and it is deleted. A Merge is blocked while either User has a pending account deletion, or when both already hold the same provider.
3. **A shared Group keeps one Member and every other Balance**: the two Members become the surviving one, active if either was, admin if either was, and creator of the other's Expenses. Payer lines of both become one summed line. An Expense whose split names both is rewritten as an exact-amount split carrying its existing allocations, so no other Member pays a different amount; Settlements between the two are deleted. Other Members are not notified.
4. **Group by group, resumable**: each Group's ledger is its own Durable Object, so the Merge applies per Group, retries a failed Group until it succeeds, and never repeats a finished one. Groups not yet merged show as merging and take no new entries.
5. **The Link code path warns**: entering through a Link code makes the code's issuer the survivor, so a Link code sent to someone else would take their Groups. The screen on that path says to cancel if the kept User is not you, and "merge" stays disabled until "both are me" is ticked.
6. **No Unlink**: an unlinked Identity would sign in later as a new, empty User, recreating the duplicates a Merge removes; the Settings button and its endpoint go. Someone who linked the wrong Google can only delete the account.

## Consequences

- A Merge is a one-way door and rewrites Expenses other Members can open: an equal or shares split that named both people now reads as exact amounts.
- The Link code risk grows from "your Google signs in to someone else's User" to "your Groups move to someone else's User"; the warning and the tick are the only guard, and they protect only someone who reads the screen.
- Considered and rejected: blocking the Merge when both are in one Group (removing a Member keeps their history, so the block could never be cleared); letting the person pick which name and picture to keep; always keeping the LINE profile; refusing Merges on the Link code path (a LINE-first person could then never merge).
