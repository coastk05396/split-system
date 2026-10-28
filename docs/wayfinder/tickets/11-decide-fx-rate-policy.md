---
title: Decide the exchange rate policy
type: wayfinder:grilling
mode: HITL
status: closed
assignee: rick
parent: ../map.md
blocked_by: ["06-research-fx-rate-sources.md", "08-decide-money-and-split-rules.md"]
---

## Question

Rate is prefilled from a daily source, editable, and saved with the Expense (settled). Only the TWD and USD pair is needed in v1 (Frankfurter covers it, per the closed source research). Decide: the chosen source, behaviour when the source is down, rate per Expense versus per day, and how to show the rate in the 幣別與匯率選擇 flow.

## Blocked by

- [Research exchange rate sources](06-research-fx-rate-sources.md)
- [Decide money storage and split rules](08-decide-money-and-split-rules.md)

## Resolution

- **Source and cache:** the Worker fetches the TWD/USD rate from Frankfurter, with ExchangeRate-API as the fallback, never from the browser. The first request each day writes one row per date and pair into a D1 table (not KV, whose free tier allows 1,000 writes a day); later requests read that row.
- **Saved with an Expense:** original amount and currency, the rate used, the rate's date, whether the user edited it, and the converted amount in the Group's Settlement currency (rounded per the money rules). The rate is per Expense, not per day; a later rate change never alters old debts; editing an Expense asks about the rate again.
- **Source down:** the Expense can always be saved. Use the newest cached rate and mark it "使用 {date} 的匯率", or ask for a manual rate if there is no cache.
- **Which day's rate:** the Expense's own date (today by default); for a past date, or a weekend or holiday with no rate, the last available day before it.
- **Display and entry:** the 幣別與匯率 flow shows "1 USD ≈ NT$ 31.5234", the converted amount, and a custom-rate field prefilled with that rate, labelled as a reference rate. The rate is stored as a whole number scaled by 1,000,000 and shown to 4 decimals.
- **Settlement currency:** chosen when the Group is created (TWD by default) and fixed once the first Expense exists.

Divergence from the designs, for **Reconcile the designs with the decisions**: the currency picker (screen 23, 幣別與匯率選擇) lists JPY and EUR and shows a one-decimal rate ("1 JPY ≈ NT$ 0.22"); it must list only TWD and USD, show four decimals, and add the custom-rate field. The Group creation screen (screen 6, 建立與邀請群組) needs a Settlement currency choice.

Still unconfirmed from the source research: Frankfurter's uptime and which provider wins for TWD in its blend, which is why a fallback and a cache are in the policy.
