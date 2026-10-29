# Design changes for v1

Collected by **Reconcile the designs with the decisions**. `docs/split.pen` is not edited by the map; this list is the brief for the follow-up design pass. Screen numbers are the `docs/screens/` numbers. "Not reviewed" means the frame was not opened during the map, so only the changes that follow from decisions are listed.

## Across every screen

- Brand is 小芽分帳 (short 小芽); remove 一起分 and the English tagline "SPLIT TOGETHER". The web app lives at `split.rickchen.si`.
- Amounts follow the money rules: TWD in whole dollars ("NT$ 2,160"), USD in cents ("US$ 12.34"). Only TWD and USD appear in any currency list.
- Examples use a TWD trip (such as 台南) or a USD trip; the Tokyo and JPY examples go.
- No notification, reminder or push wording anywhere (v1 sends none).
- Navigation: bottom bar 首頁, 群組, + (新增), 統計, 設定; the 'LINE Bot' tab is removed. The web sidebar changes the same way. One responsive app: desktop is the same routes with a sidebar and two columns.

## By screen

| # | Screen | Change |
| --- | --- | --- |
| 1 | 歡迎登入 | 小芽分帳 headline and copy; keep the LINE and Google buttons |
| 2 | 首頁 | 目前淨收付 shown as one amount in the Preferred currency (other currencies converted at the latest reference rate); no count line or settlement link; 待結算的群組 lists only Groups still owing, each opening the settle tab; 快速開始 cards (快速分帳 first, 旅行分帳 under maintenance) always shown |
| 3 | 群組詳情 | Tabs 帳目, 行程 (Trips only), 結算; delete icon for admins only |
| 4 | 新增支出 | Tabs 花費 and 轉帳 (no 收入); date and optional time; item name and category; currency, amount with a calculator, rate, and a typed converted amount (the rate is then derived); 誰先付錢 with several payers behind an advanced icon; split list with 全選, everyone checked by default; note; one receipt photo (only if R2 needs no payment method); "同時發送至當前 LINE 對話框" checkbox shown only inside a LINE chat; an easy way to say the other person paid and only you owe |
| 5 | 結算與債務 | Whole dollars; plan label "最少筆數" or "至多 N−1 筆"; per-payment actions replace the big 標記已結清 button; "我已付款" action; "待確認" badge; cancel |
| 6 | 建立與邀請群組 | "預設幣別" becomes a Settlement currency choice (fixed after the first Expense) plus a default Expense currency |
| 7 | 統計分析 | Per-Group only; remove the 個人 tab |
| 8 | LINE Bot 快速進入 | Becomes a "加入小芽官方帳號" card in 設定; remove the chat-entry example |
| 9 | 邀請成員 | Use a compact deep-green invitation card for the Group name, short explanation and expiry, with one primary action below: send the Invite through LINE's recipient picker (friends, chats or groups), then close the LIFF app after a successful send. Sharing to a LINE group chat does not bind it to the app Group. Keep copy link as a quiet fallback and regenerate below. Omit the simulated LINE message and visible full URL. The link stays valid for 7 days. |
| 10 | 開銷詳情 | Not reviewed. Must show original amount and currency, the rate with its date and an edited flag, the converted amount, split lines, and edit and delete only for the creator or an admin |
| 11 | 設定與帳號 | Remove 通知提醒; 預設幣別 becomes a 偏好幣別 dropdown right under the profile; add link and unlink, 登出所有裝置, 刪除帳號, and the "已經是另一個小芽帳號" error state |
| 12 | 群組列表 | Not reviewed. Show each Group's Balance in its Settlement currency; usage badge |
| 13 | 群組成員管理 | "…" menu: promote, demote, remove; "尚有 NT$ X 待結算" block message; 已離開的成員; 30-Member cap |
| 14 | 選擇類別 | Not reviewed; keep |
| 15 | 自訂分帳比例 | Remove the 比例 % tab; tabs are 金額 and 份數 (shares 1 to 99) |
| 16 | LINE Bot 圖文選單 | Rich Menu artwork only, not an app screen; welcome bubble points at the menu and no longer suggests typing a sentence |
| 17 | 自訂金額分帳 | Amounts in the Expense currency; apply stays disabled until the total matches |
| 18 | 結算確認 | Whole dollars; editable amount for partial payments; admin confirm; undo with a visible "已撤銷" line |
| 19 | 空白群組狀態 | Not reviewed; keep, with an invite call to action |
| 20 | 網路錯誤與重試 | Not reviewed; add the "使用 {date} 的匯率" notice for a rate source that is down |
| 21 | Landing | Static page for logged-out desktop visitors at `/`; brand and wording fixed; login button; no pricing or download section |
| 22 | 旅行總覽 | TWD or USD example; cost line in the Settlement currency |
| 23 | 幣別與匯率選擇 | TWD and USD only; rate shown to four decimals; custom-rate field; labelled a reference rate |
| 24 | Web 工作台 | One responsive app; quick-split card is the mobile 快速分帳 card; TWD example |
| 25 | Web 帳目與行程 | Same three tabs as mobile |
| 26 | 旅行每日行程規劃 | Remove drag handles; stops sort by time |
| 27 | 加入一站 | Free-text name and location; "在地圖開啟" link; dates limited to the trip |
| 28 | Web 行程為主 | Remove drag handles; TWD or USD example |
| 29 | 旅行基本設定 | Admin on and off control for the trip module; 31-day limit |
| 30 | 分帳方式 | Remove the 比例 card; everyone checked by default; 全選 |
| 31 | 刪除群組確認 | As designed; wording says the delete is permanent |

## Screens that do not exist yet

- Join screen for an Invite (group name preview and a join button) and its error states: expired, revoked, group full.
- Group settings: name, usage, default Expense currency, trip on and off, regenerate the Invite.
- 我已付款, 待確認 and cancel states on a Settlement; undone Settlement line.
- Account deletion confirmation and the blocking messages (balance not zero, last admin).
- Per-Group statistics empty state.
- Privacy and terms pages (`/privacy`, `/terms`), linked from the sign-in footer and from 設定.
- Nickname per Group: an edit field in the Group's member settings, defaulting to the provider name.
- 匯出 CSV action on the Group page for Expenses and Settlements.
- Sign-in screen: a two-line summary of what is collected and why above the footer consent line (screen 1).
- Join screen for an Invite: the line "加入後，群組成員會看到你的暱稱和頭像".
- A one-time notice at the next sign-in when the privacy or terms version changes, and a breach banner.
- Add a placeholder (待加入成員): a name field in the split list and in the Members screen; placeholders show an initial in a dashed circle with "(未加入)".
- Join screen for an Invite: "你是這些人之一嗎？" list and the claim confirmation ("你會承接 … 的 N 筆帳").
- Members screen: "合併成員" for admins.

