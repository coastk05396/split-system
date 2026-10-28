---
title: Research Taiwan privacy and platform policy duties
type: wayfinder:research
mode: AFK
status: closed
assignee:
parent: ../map.md
blocked_by: []
---

## Question

What duties apply to a small free app run by an individual, with users in Taiwan, that stores a provider user ID, display name, picture URL, expense records and optional receipt photos, hosted on Cloudflare and signed in through LINE and Google? Primary sources only (official text of Taiwan's Personal Data Protection Act from the Ministry of Justice law database, the regulator's guidance, and the platforms' own policies). Cover: whether an individual running a hobby service is in scope; notice and consent requirements at collection; data subject rights (access, copy, correction, deletion) and the response deadlines; breach notification; cross-border transfer to Cloudflare, LINE and Google; the age at which a person can consent; and what LINE Login or LIFF channel publishing and Google's OAuth consent screen require (privacy policy and terms URLs, verification, user caps while unverified). Finish with a short list of what the privacy and terms pages must say and what must be built, marked clearly as a research summary and not legal advice.

## Resolution

A research summary, not legal advice. Every point is from the findings file; items the agent could not confirm are marked.

- **Scope:** an individual is a "non-government agency" (Art. 2(8)); the Art. 51(1) exemption covers only purely personal or household use, so assume the Act applies. The 2025-11-11 amendments (Arts. 12, 21, 47, 48) are marked on the Ministry of Justice database as not yet in force, with the date to be set by the Executive Yuan.
- **Notice and consent:** Art. 8(1) lists six items that must be told to the user, and notice may be given electronically (Enforcement Rules Art. 16). The collector carries the burden of proving consent (Art. 7).
- **Rights (Art. 13):** access requests must be decided within 15 days and correction or deletion requests within 30 days, each extendable once by the same period with written notice. In-app account deletion (immediate) and the per-Group CSV export meet this; a contact address must handle requests the app cannot.
- **Breach:** the affected person must be notified, with a report to the regulator above a threshold; the report deadline and threshold regulations were not found.
- **Cross-border:** Art. 21 lets the regulator restrict transfers by order only; no ban or consent duty was found in the Act text.
- **Age:** the Act sets no age. The Civil Code makes 18 the age of majority and a minor's consent needs a guardian's approval. This reopens the "old enough to hold a LINE or Google account" wording decided under **Decide privacy and data retention**; see **Decide the age rule and policy wording**.
- **LINE:** a privacy policy URL is required only for certified providers; the app name must not contain "LINE"; LIFF endpoints must be https.
- **Google:** in Testing status an app is limited to 100 test users whose authorisations expire after seven days; in production it is open to any Google Account. Unverified apps that show the unverified-app screen are capped at 100 new users in total. Verification is optional for non-sensitive scopes, but it was not confirmed that `openid`, `email` and `profile` are all classed non-sensitive. Google requires a published privacy policy.
- **Sensitive categories (Art. 6):** free-text notes and receipt photos could contain them incidentally, so the terms tell people not to enter any.
- **Terms page must say:** the service is free and as is; users are responsible for content they enter, including other people's data and receipt photos; no sensitive data in notes or photos; what account and Group deletion does; what happens on deauthorisation.
- **Unconfirmed:** the effective wording of Arts. 12 and 21 today, the breach-report regulations and thresholds, any regulator guidance on individuals and hobby services, whether the Commission is established, and the LIFF publishing rules.

Findings: branch `research/taiwan-privacy-and-platform-policy-duties` on origin, file `docs/research/research-taiwan-privacy-and-platform-policy-duties.md` (throwaway, never merged; the agent could not run git, so the commit was made by hand and is unsigned).
