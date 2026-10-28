---
title: Reconcile the designs with the decisions
type: wayfinder:grilling
mode: HITL
status: closed
assignee: rick
parent: ../map.md
blocked_by: ["02-export-design-screens.md", "10-decide-invite-and-membership.md", "12-decide-settlement-flow.md", "13-decide-trip-module-scope.md", "14-decide-line-bot-v1-scope.md"]
---

## Question

Go through the 31 frames and list which change because of decisions made: renamed brand, missing screens (sign-in with Google or LINE, currency switch), screens to drop, and web layouts that need to be one responsive SPA.

## Blocked by

- [Export design screens to docs/screens](02-export-design-screens.md)
- [Decide invites and membership rules](10-decide-invite-and-membership.md)
- [Decide the settlement flow](12-decide-settlement-flow.md)
- [Decide the Trip module scope for v1](13-decide-trip-module-scope.md)
- [Decide the LINE Bot scope for v1](14-decide-line-bot-v1-scope.md)

## Resolution

The full list of changes is in [docs/design-changes.md](../../design-changes.md): a table of all 31 screens plus the screens that do not exist yet.

- **Statistics:** v1 ships per-Group statistics only (month total, per-day bars, category breakdown, one query over that Group's Expenses); the 個人 tab is dropped.
- **Navigation:** the bottom bar is 首頁, 群組, + (新增), 統計, 設定. The 'LINE Bot' tab goes; screen 8 becomes a "加入小芽官方帳號" card in 設定 that opens the add-friend link. Screen 16 stays as the Rich Menu artwork and is not an app screen.
- **Settings:** remove 通知提醒 and the user-level 預設幣別 (defaults live on each Group). Keep 我的群組, 帳號與隱私 (linked accounts, 登出所有裝置, 刪除帳號) and 登入與安全.
- **Home total:** 目前淨收付 shows one amount per currency, never a summed figure; the subtitle is "你在 N 個群組有待結算款項".
- **Web:** one responsive app. Desktop is the same routes with a sidebar and two columns, with no features of its own. The group page has the same three tabs everywhere: 帳目, 行程 (Trips only), 結算.
- **Editing the designs:** this map does not edit `split.pen`; the list is the brief for a follow-up design pass.
- **Landing page:** kept as the static logged-out page at `/` for desktop visitors, with the brand and wording fixed; signed-in users go straight to the app.

Three screens were never opened during the map (10, 12, 14, 19 and 20 are marked "not reviewed" in the list); they are reviewed in the design pass.

New work raised while closing this ticket: the owner shared screenshots of another app's add-expense form and asked for several of its features; see **Decide the add-Expense form features** and **Research receipt images and LIFF messaging on free plans**.
