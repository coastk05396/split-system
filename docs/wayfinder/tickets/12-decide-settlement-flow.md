---
title: Decide the settlement flow
type: wayfinder:grilling
mode: HITL
status: closed
assignee: rick
parent: ../map.md
blocked_by: ["07-research-debt-simplification.md", "08-decide-money-and-split-rules.md", "11-decide-fx-rate-policy.md", "19-research-free-tier-fit.md"]
---

## Question

Decide: which simplification method runs, how a Settlement is recorded and confirmed (see 結算與債務 and 結算確認), partial payments, whether Expenses can be edited after a Settlement, and which currency the result is shown in.

## Blocked by

- [Research debt simplification algorithms](07-research-debt-simplification.md)
- [Decide money storage and split rules](08-decide-money-and-split-rules.md)
- [Decide the exchange rate policy](11-decide-fx-rate-policy.md)
- [Research whether free tiers carry v1](19-research-free-tier-fit.md)

## Resolution

- **Where the plan is computed:** the Worker returns only each Member's net balance (cheap, within the 10 ms free CPU limit). The browser computes the payment plan: the exact fewest-payments search when 20 or fewer non-zero balances remain, greedy otherwise. Tie-breaks are fixed (amount descending, then member order), so every device shows the same plan. The label "最少筆數" appears only when the exact search ran; otherwise "至多 N−1 筆". The Worker never trusts the plan and checks each recorded payment against the balances.
- **Who records a payment:** the person who received the money confirms it ("確認已結清"). A payer cannot confirm their own payment. An admin can confirm on behalf of anyone. Only confirmed payments change balances.
- **Partial payments:** the confirm screen shows the suggested amount; the receiver can lower it to any amount from 1 unit up to what the payer still owes that person. The remainder stays a debt.
- **What a Settlement is:** one payment (who paid, who received, the amount, the time), an ordinary entry that shifts balances. It does not close or lock the Expenses behind it, so a Running Tab simply continues. The person who confirmed it, or an admin, can undo it at any time; the history keeps a visible "已撤銷" line.
- **Editing Expenses after settling:** still allowed (creator or admin, per the invite rules). Settlements are never changed and balances are recalculated. If the Group already has a Settlement, a warning shows "此群組已有結算紀錄，修改會改變債務".
- **Currency and decimals:** debts, the plan and every Settlement are shown in the Settlement currency only; original currencies stay visible on each Expense. TWD shows whole dollars, USD shows cents.
- **Reminders:** "分享結算摘要到 LINE" opens the user-initiated LINE share and is the only way a summary reaches LINE. No automatic reminders or push messages (the free LINE plan allows 200 a month).

Divergences from the designs, for **Reconcile the designs with the decisions**: the debts screen (screen 5, 結算與債務) and the confirm screen (screen 18, 結算確認) show decimals ("NT$ 98.83", "NT$ 194.17"), which TWD does not use; both need the plan label (最少筆數 or 至多 N−1 筆), an editable amount on the confirm screen for partial payments, an undo action with the 已撤銷 line, and an admin-confirm path. The big "標記已結清" button on screen 5 must become per-payment actions.

Amended by **Decide the API contract**: a payer may also tap "我已付款", which creates a pending Settlement that changes no balances until the receiver (or an admin) confirms it; the payer can cancel it while pending; the receiver sees a "待確認" badge. Only confirmed Settlements change balances.
