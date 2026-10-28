---
title: Decide the age rule and policy wording
type: wayfinder:grilling
mode: HITL
status: closed
assignee: rick
parent: ../map.md
blocked_by: []
---

## Question

The privacy research found that Taiwan's age of majority is 18 and that a minor's consent needs a guardian's approval, which conflicts with the earlier wording that the service is for anyone old enough to hold a LINE or Google account. Decide: the minimum age or the guardian rule the terms state (and whether any check is made); the six notice items the privacy page gives at sign-in (as listed in the research), the contact route and the promised response times for requests the app cannot handle itself; what the terms say about notes and photos that hold other people's or sensitive data; and the wording of what happens on deauthorisation and deletion. This is a product decision informed by a research summary, not legal advice.

## Resolution

A product decision built on a research summary, not legal advice.

- **Age rule:** the terms say the service is for people 18 or older, and that anyone under 18 may use it only with a parent's or guardian's approval. No age check in v1; continuing from the sign-in screen is the declaration. The earlier wording "old enough to hold a LINE or Google account" is dropped (this supersedes that part of **Decide privacy and data retention**).
- **How notice is given:** the full six items (operator's name, purpose, categories of data, period, territory, recipients and methods of use, the person's rights and how to use them, and what happens if they do not provide the data) live at `/privacy`. The sign-in screen keeps its footer line "繼續即表示同意服務條款與隱私權政策" and adds a two-line summary above it of what is collected and why. The join screen for an Invite adds "加入後，群組成員會看到你的暱稱和頭像".
- **Contact and response times:** the contact address is `privacy@rickchen.si`. The privacy page promises to answer access and copy requests within 15 days and correction and deletion requests within 30 days, the same deadlines as the Act. Most requests are already instant, because a person can delete their account and export a Group's CSV themselves.
- **What the terms say:** the service is free and provided as is; it only records who owes what and never moves or holds money; users are responsible for what they enter, including other people's data and receipt photos; no sensitive data (health, for example) in notes or photos; removing the app from LINE or Google does not delete data, deleting the account in 設定 does, and the contact address helps anyone who cannot sign in.
- **Who gets the data:** the privacy page names the other Members of a Group, Cloudflare (hosting, database and receipts), and LINE and Google (sign-in). It says data is held on Cloudflare's global network, that nothing is sold and no ads are shown, and that the exchange rate source receives no personal data.
- **Security and a breach:** the privacy page lists the measures in plain words (HTTPS, short-lived tokens, hashed refresh tokens, access checked per Group). After a breach a banner appears at the next sign-in and a notice goes on the privacy page; no LINE broadcast is promised because the free plan allows only 200 messages. The report to the regulator waits until its deadline and threshold are confirmed, which the research could not do.
- **Versions of the pages:** the pages are static and part of the app, each with an effective date and a version. When they change, a one-time notice appears at the next sign-in. The Markdown source is kept in this repo.

Divergences from the designs are added to `docs/design-changes.md`: the sign-in screen's summary lines and the join screen's visibility line.
