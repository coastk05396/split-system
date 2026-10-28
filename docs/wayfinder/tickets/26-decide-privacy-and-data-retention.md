---
title: Decide privacy and data retention
type: wayfinder:grilling
mode: HITL
status: closed
assignee: rick
parent: ../map.md
blocked_by: []
---

## Question

Decide what personal data is stored and for how long, now that the data model is fixed: provider `sub`, display name and picture URL, Balances and Expense text, receipt photos, refresh sessions, and logs. Decide: what the privacy policy and terms pages say and who they name as the operator (the sign-in screen's footer links to them); what is deleted when an account, a Group, an Expense or a receipt is deleted, and how long logs and sessions live; whether a person can export their data in v1; and which outside services handle data (Cloudflare, LINE, Google, the exchange rate source). This is a product decision, not legal advice, and any claim about Taiwan's Personal Data Protection Act is checked before it is written into the spec.

## Resolution

This is a product decision, not legal advice; the legal wording waits for **Research Taiwan privacy and platform policy duties**.

- **Policy pages:** two short plain zh-TW pages, `/privacy` and `/terms`, linked from the sign-in footer and from 設定. They name the operator as the owner personally, with a contact address on the project's own domain such as `privacy@rickchen.si` that forwards to the owner's inbox (Cloudflare Email Routing is believed to be free but is not confirmed here). The owner's personal address is not published.
- **Never stored:** email, phone number, device location, IP addresses in the database, and the LINE and Google access tokens (used once to verify the person, then discarded). Receipt photos are the only images stored.
- **What is deleted when:**
  - **Account:** the identities, sessions, name and picture are deleted at once; Member rows stay, with the name replaced by "已刪除的使用者" and the picture dropped.
  - **Group:** everything under it is hard-deleted at once, including receipts.
  - **Expense:** its receipt is deleted with it.
  - **Sessions:** expired ones are purged when a refresh happens.
  - **Inactive accounts:** none are deleted automatically in v1.
- **Export:** each Group page has "匯出 CSV" for its Expenses and Settlements, available to any Member since they can already see all of it. The browser builds the file from data already loaded, so the Worker does no extra work (10 ms CPU limit). No whole-account export in v1.
- **Consent and age:** no separate consent checkbox. The sign-in screen's line "繼續即表示同意服務條款與隱私權政策" stays and links to the two pages. The terms say the service is for people old enough to hold a LINE or Google account; no extra age check in v1.
- **Names seen by other Members:** Members see each other's display name and picture from LINE or Google, never email or provider. Each Member can set a nickname per Group, defaulting to their provider name, stored in the existing `member.display_name` column (the provider name stays on `user.display_name`).
- **Tracking:** no third-party analytics, no advertising, no tracking cookies. The only cookie is the strictly necessary refresh cookie, so no cookie banner is needed.

Divergences from the designs are listed under "Screens that do not exist yet" in `docs/design-changes.md`: the privacy and terms pages, the nickname edit on Group settings, the 匯出 CSV action, and the account deletion screens.

Profile pictures (added after the owner asked how the LINE picture reaches the app): the app stores only the provider's picture URL and name, read from the sign-in token with the `profile` scope and refreshed at each sign-in, never the image file. A missing or failing picture shows a coloured circle with the person's initial. If both providers are linked, the picture comes from the provider used for the most recent sign-in. v1 has no avatar upload; receipt photos are the only images people add. How long LINE's picture links stay valid is not confirmed.

