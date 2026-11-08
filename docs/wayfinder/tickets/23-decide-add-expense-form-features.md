---
title: Decide the add-Expense form features
type: wayfinder:grilling
mode: HITL
status: closed
assignee: rick
parent: ../map.md
blocked_by: ["24-research-receipt-images-and-liff-messaging.md"]
---

## Question

The owner shared screenshots of another app's add-expense form (Lightsplit) and asked to add features from it. Decide which ship in v1 and how each fits the decisions already made: 花費, 收入 and 轉帳 tabs (a transfer would be a Settlement, an income needs a meaning); date and time on an Expense (the model stores a date only); a converted-amount field that can be typed (the rate is then derived); more than one payer for one Expense (the model has a single payer); a calculator in the amount field; 全選 in the split list; a receipt image upload; and a "同時發送至當前 LINE 對話框" checkbox. Settle what changes in the data model and API contract for each one that ships.

## Blocked by

- [Research receipt images and LIFF messaging on free plans](24-research-receipt-images-and-liff-messaging.md)

## Resolution

- **轉帳 tab:** a shortcut into the Settlement flow. If you paid someone it creates a pending Settlement they confirm; if someone paid you it is recorded and confirmed at once, because you are the receiver. Nobody can record a transfer between two other people.
- **收入 tab:** not in v1 (it would be a negative Expense). A refund is handled by editing the original Expense. The form has the tabs 花費 and 轉帳 only. A "退款" linked to the original Expense can return later.
- **Date and time:** an Expense has a date and an optional time ("14:30"), both local text, defaulting to the device's current date and time. The date still decides which day's rate is used; the time orders Expenses within a day.
- **Typed converted amount:** in a foreign-currency Expense the form shows the amount, the rate and the converted amount in the Settlement currency. Editing the rate recalculates the converted amount; editing the converted amount recalculates the rate (shown to four decimals). The typed converted amount is the authority and the stored rate is for display, with the "edited" flag set.
- **Several payers (誰先付錢):** one Expense can have several payers, each with the amount they paid, adding up to the total, behind the advanced icon next to 誰先付錢. A single payer (you) is the default. Converting to the Settlement currency uses the same leftover rule so the converted amounts add up exactly.
- **Calculator:** the amount field accepts simple arithmetic (+ − × ÷ and brackets), such as "120+80", evaluated on the device by a safe parser and never `eval`. The result shows before saving and only the result is stored.
- **Receipt photo:** one JPG or PNG per Expense, resized on the device to at most 1,280 px and about 300 KB before upload, stored in a private R2 bucket and read only through the Worker after a Group membership check, deleted with the Expense or Group. It ships **only if** R2 needs no payment method (item 4 of **Confirm the domain and LINE console names**); otherwise it stays out of v1 and is revisited.
- **Send to the current LINE chat:** the checkbox "同時發送至當前 LINE 對話框" appears only when the app is opened inside LINE from a chat and `liff.sendMessages` is available; unchecked by default. When ticked it sends a short card as the user ("晚餐 NT$ 2,160・四人均分・每人 NT$ 540"). Otherwise the checkbox is hidden and, after saving, a "分享" button uses the share picker. The LIFF app needs the `chat_message.write` scope. Whether it counts against the 200-message monthly quota is unconfirmed, though probably not.

**Amendments to closed tickets** (also noted on each):
- **Data model:** `expense` gains `expense_time` (nullable) and `receipt_key` (nullable); `payer_member` is replaced by an `expense_payer` table (expense_id, member_id, amount_minor; PK on both ids) whose amounts sum to the Expense total; converted amounts for payers use the leftover rule; the invariant "converted_minor equals the rate applied to the amount" becomes "converted_minor is what the user confirmed, and the stored rate is derived from it when they typed it". Balance rule: each payer gains their converted share instead of one payer gaining the whole.
- **API contract:** Expense create and edit accept a list of payers; a transfer is `POST /groups/:id/settlements`; new receipt routes `PUT`, `GET` and `DELETE /groups/:id/expenses/:eid/receipt` (read through the Worker); no new route for sending to LINE, since it runs in the LIFF app.
- **Designs:** see the updated row for screen 4 in `docs/design-changes.md`.
