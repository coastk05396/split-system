---
title: Decide money storage and split rules
type: wayfinder:grilling
mode: HITL
status: closed
assignee: rick
parent: ../map.md
blocked_by: []
---

## Question

Integer minor units per currency (settled). Decide: the rounding-remainder rule for equal and share splits, validation rules for percentage and exact splits, the maximum amount, and how the two v1 currencies are shown and entered: TWD (whole dollars in practice, though its ISO minor unit has two decimals) and USD (cents). Only TWD and USD ship in v1; keep the model generic for more later.

## Resolution

- **Storage and display:** each currency has its own decimal places. TWD is stored in whole dollars and shown "NT$ 2,160"; USD is stored in cents and shown "US$ 12.34". A USD Expense converted to TWD is rounded to a whole dollar.
- **Split methods in v1:** equal, exact amounts, and shares. **Percentage split is removed from v1 by decision.**
- **Rounding leftover (equal and shares):** leftover units are handed out one each, starting with the payer if they take part, then the other participants in a fixed member order; the same input always gives the same result (NT$100 over three people is 34 / 33 / 33).
- **Exact amounts:** the apply button stays disabled until the allocated total equals the Expense total; no automatic balancing.
- **Shares:** a whole number from 1 to 99 per participant, default 1.
- **Limits:** an Expense is positive, at least one unit and at most 99,999,999 units (NT$ 99,999,999 or US$ 999,999.99). No negative Expenses; a mistake is fixed by editing or deleting the Expense, and a repayment is a Settlement (see **Decide the settlement flow**).
- **Participants:** the split defaults to **all Members of the Group** (everyone checked), and the user may uncheck people. The payer may be left out. An Expense needs at least one participant.

Divergences from the designs, for **Reconcile the designs with the decisions**: remove the 比例 % tab on the custom split screen (screen 15, 自訂分帳比例) and the 比例 card on the split method screen (screen 30, 分帳方式). Screen 30 already defaults most members to checked; make "all checked" the rule. The 新增支出 summary line ("3 位成員・平均分") follows the same default.
