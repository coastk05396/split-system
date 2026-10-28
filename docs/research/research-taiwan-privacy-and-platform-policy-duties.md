# Taiwan privacy law and platform policy duties for 小芽分帳

Research summary only. This is NOT legal advice. The owner is not a lawyer and neither is the author. All sources were read on 2026-10-28 (the "read" date applies to every URL below unless stated).

Method note: Act text comes from the Ministry of Justice (MOJ) law database. The English version states that the Chinese version prevails. Where I only saw a tool-generated summary of a page rather than the text, I say so. Article numbers below are taken from the MOJ text; none are guessed.

## 0. Which version of the Act is in force (important)

- The MOJ Chinese page shows the Act as last amended 民國114年11月11日 (2025-11-11), with the status line "本法規部分或全部條文尚未生效" (some or all articles not yet in force; last effective date "未定"). Source: https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=I0050021
- That page says the 2025-11-11 amendment of Arts. 1-1, 12, 18, 21, 22 to 26, 41, 47 to 49, 52, 53, 55, the new Arts. 1-2, 20-1, 21-1 to 21-5, 51-1, 53-1, and the deletion of Art. 27, takes effect on a date set by the Executive Yuan. So the text quoted below for Arts. 1-1, 12, 20-1, 21, 41, 47, 48 is the amended text that may not be in force yet.
- I could not confirm the pre-amendment (currently effective) wording of Art. 12 or Art. 21. The MOJ old-version link exists (https://law.moj.gov.tw/LawClass/LawOldVer.aspx?pcode=I0050021) but I did not retrieve its article text. Treat the breach-notification and cross-border details as: UNCONFIRMED for the currently effective text.
- The Personal Data Protection Commission (PDPC) is named competent authority in Art. 1-1 (amended text). The English MOJ page lists the category as "Preparatory Office of Personal Data Protection Commission". The PDPC site (https://www.pdpc.gov.tw/) only displayed the title "個人資料保護委員會籌備處" in my fetch, so whether the Commission is formally established is UNCONFIRMED.
- English text: https://law.moj.gov.tw/ENG/LawClass/LawAll.aspx?pcode=I0050021 (MOJ states data last updated 2026/10/16).

## 1. Is an individual running a hobby service in scope?

Facts:
- Art. 2(8): "non-government agency" means a natural person, legal person or group other than a government agency. Art. 2(9): "data subject" is the individual whose data is collected, processed or used. Art. 2(1): "personal data" includes name, contact information, social activities and "any other information that may be used to directly or indirectly identify a natural person". Source: English MOJ URL above.
- Art. 51(1): the Act does not apply where personal data is collected, processed or used "by a natural person purely for purposes of personal or household activities". Art. 51(2) also exempts audio-visual data in public places not connected to other personal data. Same source.
- Art. 19: a non-government agency may collect or process data only for specific purposes and on one of the listed bases (law, contractual or quasi-contractual relationship with security measures, data made public by the subject, consent, public interest, public sources, or no infringement of the subject's interests). Same source.

Interpretation (mine, UNCONFIRMED by any regulator guidance I could find): a public web app that stores other people's identifiers, names and expense records for many unrelated groups is hard to describe as "purely personal or household", and the owner is a natural person, which Art. 2(8) counts as a non-government agency. The safest working assumption is that the Act applies. I found no MOJ or PDPC guidance specifically about hobby or free services run by individuals, and no minimum-size threshold in the Act text.

Sensitive categories (Art. 6): medical, healthcare, genetic, sex life, physical examination and criminal records need a narrower basis, including written consent. The app does not intend to collect these, but free-text notes and receipt photos could incidentally contain them (for example a pharmacy receipt). The app should avoid asking for them; whether incidental content triggers Art. 6 is UNCONFIRMED.

## 2. Notice and consent at collection

Facts (English MOJ URL above):
- Art. 8(1): when collecting under Art. 15 or 19, the collector must expressly inform the data subject of: (1) the agency's name; (2) the purpose of collection; (3) categories of data collected; (4) the time period, territory, recipients and methods of use; (5) the data subject's Art. 3 rights and how to exercise them; (6) the effect on the subject's rights and interests if they choose not to provide data.
- Art. 8(2): notice may be waived in listed cases, including (5) where the subject already knows the content and (6) non-profit collection that clearly has no adverse effect on the subject. Whether a free group-splitting app qualifies for (6) is UNCONFIRMED; I would not rely on it.
- Art. 9: if the data was not provided by the subject (for example a group member types another member's name or nickname), the collector must inform the subject of the source and Art. 8(1) items 1 to 5 before processing or use; this may be done at the first use towards the subject (Art. 9(3)).
- Form: Enforcement Rules Art. 16 allows notice by verbal words, writing, phone, text messages, email, fax, electronic documents or other means that effectively make the information known or available. Source: https://law.moj.gov.tw/ENG/LawClass/LawAll.aspx?pcode=I0050022 (rules amended 2016-03-02; may predate the 2025 amendment).
- Consent: Art. 7(1) defines consent as a declaration of agreement after being informed of the information the Act requires; Art. 7(3) says consent may be presumed if the subject does not object and affirmatively provides data after being given the Art. 8(1) notice; Art. 7(4) puts the burden of proof on the collector. Art. 7(2) and Enforcement Rules Art. 15 require a separate declaration for use beyond the original purpose, and if combined with other statements in one document, the consent must be made apparent and confirmed.
- Written consent may be electronic (Enforcement Rules Art. 14, referring to the Electronic Signatures Act).
- Penalty for failing Arts. 8 or 9 (amended Art. 48(1)(1)): order to rectify, then fines NT$20,000 to NT$200,000 repeatedly until rectified (amended text; effective status see section 0).

## 3. Data subject rights and deadlines

Facts (English MOJ URL above):
- Art. 3: rights that cannot be waived or limited in advance by contract: inquiry and review; copy; supplement or correction; demand cessation of collection, processing or use; erasure.
- Art. 10: on request the agency must answer inquiries, allow review, or give a copy, except where listed interests (national, official, or vital interests of the collector or third parties) would be harmed.
- Art. 11: keep data accurate and correct on request; on accuracy dispute stop processing; when the purpose ends or the period expires, erase or stop use on request; erase or stop if collection or use violates the Act; notify recipients after a correction.
- Art. 13: for Art. 10 requests (access, review, copy), decide to accept or reject within 15 days, extendable once by up to 15 days with written notice of reasons. For Art. 11 requests (correction, stop, erase), decide within 30 days, extendable by up to 30 days with written notice of reasons.
- Art. 14: a fee to cover necessary costs may be charged for inquiry, review or copies.
- Enforcement Rules Art. 19: a person requesting correction or supplement must give an adequate explanation. Art. 21: "necessary for business duty" includes a legal or contractual retention period or legitimate reasons not to erase.

## 4. Breach notification

Facts (amended Art. 12, English MOJ URL; effective status see section 0):
- On learning that held personal data was stolen, altered, damaged, lost or leaked, the agency must notify the data subject.
- If within a scope to be set, non-government agencies must also report to the competent authority; take immediate and effective countermeasures; record facts, impact and measures and keep records. Content, method, time limit and scope are left to regulations the competent authority will issue. I did not find those regulations, so the report deadline and the threshold are UNCONFIRMED.
- Enforcement Rules Art. 22 (2016 text): notice may be prompt by text message, email, electronic documents or other effective means, or via the Internet or media if individual notice is disproportionately costly; it must state the facts of the breach and the response measures taken.
- Amended Art. 20-1: non-government agencies holding personal data files must implement security and maintenance measures against theft, alteration, damage, loss or leakage; details by regulation. Pre-amendment equivalent: Art. 19(1)(2) requires "proper security measures" for contractual-basis collection, and Enforcement Rules Art. 12 lists example measures (risk assessment, breach prevention, notice and response mechanism, access control, logs, etc.).
- Fines: amended Art. 48(1)(3) and 48(2) (NT$20,000 to NT$200,000, repeated), and Art. 48(3) for security failures (NT$20,000 to NT$2,000,000, escalating up to NT$15,000,000 if not rectified).
- Civil liability: Art. 29 (non-government agency liability for damage unless it proves no intent or negligence) and Art. 30 limitation periods were described to me only via a page summary, not verified in the text I read; check before relying.

## 5. Cross-border transfer (Cloudflare, LINE, Google)

Facts:
- Art. 2(6): "cross-border transfer" means cross-border processing or use of personal data. Art. 21 (amended text): the competent authority "may impose restrictions" on a non-government agency's cross-border transfer where major national interests are involved, a treaty requires it, the receiving country lacks proper protection regulations and subjects' interests may be harmed, or the transfer circumvents the Act. Source: English MOJ URL.
- Violating a restriction order is fined under Art. 47(4) (NT$50,000 to NT$500,000, repeated).
- So the Act text I read has no blanket ban or consent requirement for cross-border transfer; it is a power to restrict by order. I did not find any restriction order covering the United States, Japan or Cloudflare. Whether any order exists is UNCONFIRMED. Because Art. 8(1)(4) requires telling users the "territory" of use, the privacy page should name the countries or regions involved in general terms.
- Cloudflare: its DPA says Cloudflare acts as processor, may use sub-processors with 30 days' notice (cl. 4.4), may process outside the EEA, Switzerland and the UK (cl. 6.1), and notifies the customer "without undue delay" of a security breach (cl. 3.1(e)), with no fixed hour count. Data location is not specified in the DPA. Source: https://www.cloudflare.com/cloudflare-customer-dpa/ (read via page summary).
- D1 location: the primary is placed near where the create request came from; jurisdiction options are only `eu`, `fedramp`, `us`; location hints include `apac` but are not guaranteed; Taiwan-specific placement is not documented. Source: https://developers.cloudflare.com/d1/configuration/data-location/
- LINE and Google: the LINE User Data Policy (below) governs LINE-provided data; LINE and Google process sign-in on their own systems under their own privacy policies. I did not read where LINE or Google store data. Their own privacy policies (https://line.me/en/terms/policy/ and Google's) were not reviewed, so their transfer practices are UNCONFIRMED.

## 6. Age of consent in Taiwan

Facts:
- The Act text and the Enforcement Rules that I searched contain no age threshold for consent and no minor-specific consent rule (the only "legal representative" hit is Art. 9(2)(3) about informing). Sources: the two MOJ URLs above. Conclusion: the PDPA itself sets no age; the general civil-law capacity rules apply. That conclusion is an inference; whether a PDPC or MOJ interpretation says otherwise is UNCONFIRMED.
- Civil Code Art. 12: majority is reached at 18. Art. 13: a minor under 7 has no capacity to make juridical acts; a minor over 7 has limited capacity. Art. 77: a limited-capacity person's declaration of intent needs the guardian's approval unless it relates purely to acquiring a legal advantage or to necessaries of life. Source: https://law.moj.gov.tw/ENG/LawClass/LawAll.aspx?pcode=B0000001 (page amended date shown as 2021-01-20; I did not verify the effective date of the age-18 change, which I recall as 2023-01-01 but is UNCONFIRMED here).
- Practical reading (mine): a user under 18 would need a legal representative's approval for consent-based processing; whether a sign-up flow must verify age is UNCONFIRMED. LINE and Google apply their own account age rules, which I did not review.
- Google's API Services User Data Policy says child-directed apps "should not use Google Sign-In": https://developers.google.com/terms/api-services-user-data-policy

## 7. Platform requirements

### 7a. LINE Login channel and LIFF

- New LINE Login channels start in "Developing" status; only Admin or Tester roles can use them. To publish, click the status at the top of the channel page. Publishing cannot be reverted to Developing. The page lists no other publish requirement and does not mention a channel review for ordinary publishing. Source: https://developers.line.biz/en/docs/line-login/getting-started/
- Privacy policy URL (channel basic settings): "Required if your provider is a certified provider"; otherwise not required. Terms of use URL: optional. Both appear on the consent screen when set. Same source.
- Email permission needs a separate application: upload a screenshot showing the screen where you explain you collect email, and the use. Source: https://developers.line.biz/en/docs/line-login/integrate-line-login/ (section on applying for email permission). The app does not need email, so skip it.
- Consent screen: `profile` (display name, picture) and `openid` (internal user ID) are shown; users may decline some permissions, so code must handle that. Same page.
- LIFF apps are added to a LINE Login channel; endpoint URL must be https; scopes `openid`, `profile` (and `email` only if approved) gate SDK methods; max 30 LIFF apps per channel; name must not contain "LINE". Source: https://developers.line.biz/en/docs/liff/registering-liff-apps/. The page did not cover LIFF publishing status; that part is UNCONFIRMED.
- LINE Developers User Data Policy (https://terms2.line.me/LINE_Developers_user_data_policy?lang=en, read via page summary with clause numbers as given there): write and keep findable a privacy policy per service (2.2, 2.4); tell users what is collected and obtain consent before collecting (2.3.1); collect only what is needed (2.3.3); use only for the stated purpose (2.3.4); no sale of LINE user information (3.2.6); no third-party disclosure except by law or to contractors (3.4); delete LINE user information including internal identifiers when the service closes or the user withdraws, and honour access, correction, deletion and suspension requests (3.5.2, 3.5.3); protect against unauthorised access (3.1); promptly report security incidents involving LINE user information to LINE (4.5). Verify against the full text before relying.
- When a user unregisters, the permissions granted to the app must be deauthorized, and this should be stated in the terms the user agrees to: https://developers.line.biz/en/docs/line-login/development-guidelines/
- The LINE Developers Agreement (https://terms2.line.me/LINE_Developers_Agreement) was not read; whether an individual may be a provider is UNCONFIRMED.

### 7b. Google OAuth consent screen (basic sign-in)

- Publishing status Testing: up to 100 test users listed on the consent screen; test-user authorizations expire seven days after consent. Status In production: available to any Google Account. Source: https://support.google.com/cloud/answer/15549945
- Unverified apps that show the unverified-app screen have a cap of 100 new users in total. Same source.
- Verification: when an app uses only non-sensitive scopes, verification is optional. Source: https://support.google.com/cloud/answer/13463073 (page summary; I did not confirm that openid, email and profile are all classed non-sensitive, though they are the normal sign-in scopes).
- Brand verification is required for External, Published apps that want to show a logo or display name on the consent screen. The privacy policy must be visible to users, on the same domain as the home page, linked from the consent screen, and must disclose how the app accesses, uses, stores or shares Google user data. The home page must be public and link to the privacy policy; domain ownership is checked via Google Search Console. Source: https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification
- The consent screen shows app name, home page, terms of service and privacy policy; the home page must carry links to a privacy policy and optional terms: https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance
- Google API Services User Data Policy: "must publish a privacy policy that fully documents how your application interacts with user data", and give notices that are accurate and easily accessible: https://developers.google.com/terms/api-services-user-data-policy. Whether a public app with only basic scopes must list the URL in the OAuth client configuration was stated for public apps in that page; treat as required.

## 8. What the privacy and terms pages must say, and what must be built

This is a research summary, not legal advice. Have a Taiwanese lawyer or the competent authority confirm before launch.

Privacy page should state (maps to Art. 8(1) items):
1. Operator name (the individual's name or a stable pseudonym is a question for a lawyer; UNCONFIRMED) and a contact channel (maps to item 1 and to exercising rights).
2. Purpose: splitting group expenses and showing members' records.
3. Categories: provider ID (sub), display name, picture URL, per-group nickname, expense records and notes, trip stop names and text locations, optional receipt photos, session data; and that no email, phone, device location, IP address (in the database), analytics or ads are used. (Keep statement true for logs kept by Cloudflare; Cloudflare's own logs may include IPs, UNCONFIRMED here.)
4. Period (until account deletion; groups until hard-deleted), territory (Cloudflare global network and LINE or Google systems, locations as per their policies), recipients (other group members, Cloudflare as processor, LINE and Google as sign-in providers), methods of use.
5. Rights: access, copy, correction, stop use, erasure, how to ask (in-app export and delete, plus contact), and that responses come within 15 or 30 days (Art. 13).
6. Effect of not providing data: cannot sign in or use the group.
7. How deletion works, including that group records stay anonymised as "已刪除的使用者".
8. Third-party data: members may enter other people's names; those people can ask the operator to correct or erase them.
9. Breach commitment: notify affected users and report where required.
10. Age: say that under-18 users need a parent or guardian's approval (inference from Civil Code Arts. 12, 13, 77).
11. Change policy and date.

Terms page should state: service is free and provided as is; user responsibility for content they enter (including other people's data and receipt photos); no sensitive data in notes or photos; account and group deletion behaviour; deauthorization on unregistering (LINE guideline); contact; governing law is a lawyer question.

What must be built (functional):
- Notice shown at or before first sign-in with links to both pages, and a recorded acknowledgement or consent (timestamp and policy version), since Art. 7(4) puts proof on the collector.
- Account deletion that also revokes LINE authorization and removes identity, sessions, name and picture (already planned), plus receipt photo deletion in R2 when a group or account is deleted.
- Data export for the user's own data in addition to group CSV (Art. 3 copy right); a path for non-users named in records to ask for correction or erasure.
- A request log with receipt date and decision date to meet the 15-day and 30-day deadlines.
- A breach runbook: who is notified, how (in-app notice or message), what is recorded, and how to report to the authority once the reporting rules are known.
- Security measures: access control by group membership, private R2 bucket with signed access, minimal logging, session expiry.
- Provider setup: LINE channel privacy and terms URLs filled in (not required for uncertified providers but advisable), email permission not requested; Google consent screen with app name, home page, privacy and terms links, domain verified in Search Console, move from Testing (100 users, 7-day expiry) to In production before public launch.

Open items (UNCONFIRMED): effective wording of Arts. 12 and 21 today; breach-report regulations and thresholds; any PDPC or MOJ guidance on individuals and hobby services; whether the Commission is established; whether a non-profit exemption in Art. 8(2)(6) fits; Cloudflare, LINE and Google storage locations; LIFF publishing status rules; LINE Developers Agreement terms for individuals; age-18 effective date.
