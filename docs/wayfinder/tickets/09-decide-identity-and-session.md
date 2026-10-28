---
title: Decide identity linking and sessions
type: wayfinder:grilling
mode: HITL
status: closed
assignee: rick
parent: ../map.md
blocked_by: ["05-research-line-platform.md"]
---

## Question

One User with several Identities (settled). Decide: the exact flow to link a Google Identity and a LINE Identity, what happens when the second sign-in is unlinked, token lifetime and refresh, logout and revocation, and what a LINE-only User sees on desktop Chrome.

## Blocked by

- [Research LINE LIFF, share and Bot constraints](05-research-line-platform.md)

## Resolution

- **Creating and linking:** the first sign-in with Google or LINE creates a User with that one Identity. Linking happens only from 設定 → 登入與安全 while signed in: tap "連結 Google" or "連結 LINE", finish that provider's sign-in, and the Identity is added to the same User. No automatic merge by email.
- **Identity already on another User:** the link is refused with "這個帳號已經是另一個小芽帳號"; there is no merging of Users in v1.
- **Unlinking:** allowed only if another Identity remains. Unlinking LINE also stops LINE notifications for that User.
- **Session tokens:** after verifying the provider token, the Worker issues its own. The access token is a JWT valid for 1 hour, sent as a Bearer header and kept in memory. The refresh token is opaque and rotating, valid for 30 days, stored hashed in D1 and sent in an httpOnly, Secure, SameSite=Lax cookie on `split.rickchen.si`. Requests check only the JWT; the database is touched only on refresh. The signing secret lives in Worker secrets, never in the repo.
- **Logout and revocation:** logout deletes this device's refresh token; "登出所有裝置" deletes all of the User's refresh tokens; deleting the account does the same plus the data rules decided later. An access token already issued stays valid for up to one hour.
- **LINE on desktop Chrome:** a LINE-only User taps "使用 LINE 快速登入" and goes through LINE Login (email or QR); there is no silent login outside LINE. Inside LINE the app signs in automatically on open.
- **Stored about a person:** only the provider `sub`, display name and picture URL, refreshed at each sign-in; never email; `openid profile` scopes only.

Divergences from the designs, for **Reconcile the designs with the decisions**: the welcome screen (screen 1, 歡迎登入) still shows the 一起分 headline and the English tagline "SPLIT TOGETHER", against the settled name 小芽分帳; the settings screen (screen 11, 設定與帳號) needs unlink, 登出所有裝置 and the "already another account" error state next to 已連結的帳號.
