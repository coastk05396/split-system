# 小芽分帳 (YiQiFen / Split-System) — 產品與技術架構規格書 (v1 Build-Ready Spec)

> **專案名稱**：小芽分帳 (Short: 小芽)  
> **正式網域**：`split.rickchen.si`  
> **狀態**：Build-Ready Specification (Wayfinder Completed)  
> **基礎設施原則**：100% Cloudflare Free Tier / Zero-Server / Local-First Development  

---

## 1. 產品概述與邊界 (Product Overview & Scope)

### 1.1 產品定位
「小芽分帳」是一款專為好友、室友與團體旅遊打造的輕量化分帳與記帳工具。兼具「日常聚會累加分帳 (Running Tab)」與「旅遊行程分帳 (Trip)」，深度整合 LINE LIFF (手機端原生體驗) 與 Web App (桌面端全功能)，並以小豆芽吉祥物作為親切的系統通知角色。

### 1.2 系統邊界
* **In-Scope (v1 發布範圍)**：
  - 介面語言：繁體中文 (`zh-TW`，預設) 與英文 (`en`)；語言存在帳號上，於設定頁切換，首次依裝置語言決定。
  - 幣別支援：新台幣 (`TWD`，整數元)、美元 (`USD`，美分)、日元 (`JPY`，整數元) 與泰銖 (`THB`，satang，兩位小數)。
  - 雙軌登入：桌面端 Google SSO、手機端 LINE LIFF 靜默自動登入；支援已登入狀態下的手動身分綁定。
  - 分帳模式：均分 (Equal)、自訂金額 (Exact)、按份額 (Shares 1~99)。
  - 多人先付 (Several Payers)：支援多人共同代墊。
  - 確定性零頭分配 (Leftover)：付款人優先拿第 1 個零頭，無隨機性。
  - 匯率快照：Frankfurter 每日自動快照存入 D1，支援自訂匯率反推，結算幣別第一筆記帳後鎖定。
  - 結算流程：收款人確認制、「我已付款」狀態機、部分還款、債務撤銷歷程。
  - 最少筆數還款計畫：瀏覽器端運算 (≤20 人精確搜尋於 Web Worker，>20 人貪婪演算法)。
  - 行程模組：目的地、日期、每日時間軸站點 (自動按時間排序)、地圖文字連結搜尋。
  - 虛擬成員 (Placeholders)：未註冊好友代記，後續可認領與合併。
  - 單一響應式 SPA：桌面寬螢幕雙欄側邊欄，手機端底部五分頁導覽。
* **Out-of-Scope (v1 排除項目)**：
  - 英文以外的其他語言（日文、泰文等）；LINE Bot 回覆與圖文選單、隱私權政策與服務條款僅提供繁體中文。
  - LINE Bot 自然語言文字記帳（Bot 僅提供 Rich Menu 圖文選單與被動回覆）。
  - 金流支付或銀行轉帳（系統僅記錄與計算債務，不碰實體金流）。
  - 付費地圖 API、路線規劃、天氣預報、景點評論。
  - LINE 群組聊天室直接綁定群組（一律透過 LIFF 分享邀請連結加入）。

---

## 2. 系統架構與技術堆疊 (Architecture & Tech Stack)

```
[使用者端 Client]
  ├── 手機端: LINE LIFF (LINE In-App Browser)
  └── 桌面端: Chrome / Safari / Edge (Web App)
           │
           ▼ HTTPS (split.rickchen.si)
[Cloudflare Edge 邊緣網路]
  ├── Cloudflare WAF: Rate Limiting (/api/v1/auth/* 限制 20 req/10s)
  └── Cloudflare Workers (單一 Worker 託管 SPA 靜態資產 + Hono API)
           ├── Workers Static Assets: Vite 構建之 SPA (< 200 KB gzipped)
           ├── Hono API (/api/v1/*): Typed RPC & Zod Schema 校驗
           ├── D1 (SQLite): split-prod / split-staging 關聯式資料庫
           ├── KV: 僅用於 Google & LINE JWKS 公鑰快取
           └── R2 (可選): 發票收據照片私有儲存 (零元綁卡條件下啟用)
```

### 2.1 倉庫結構 (pnpm Workspace Monorepo)
* `apps/worker`：Cloudflare Worker (Hono REST API、認證、Drizzle ORM)。
* `apps/web`：React 19 + Vite + Tailwind CSS v4 + Radix UI (單頁應用)。
* `packages/shared`：前後端共享之 Zod Schemas、TypeScript 型別、純函數金流運算引擎與測試。

---

## 3. 金額模型與運算引擎 (Money & Settlement Engine)

### 3.1 最小貨幣整數儲存 (Minor Unit Integer)
* `TWD`：`decimals = 0`，以整數「元」儲存 (例如 NT$ 2,160 存 `2160`)。
* `USD`：`decimals = 2`，以整數「分」儲存 (例如 US$ 12.34 存 `1234`)。
* `JPY`：`decimals = 0`，以整數「元」儲存 (例如 JP¥ 1,500 存 `1500`)，符號 `JP¥`。
* `THB`：`decimals = 2`，以整數 satang 儲存 (例如 ฿ 1,234.50 存 `123450`)，符號 `฿`。
* 金額限制：每筆支出 1 至 99,999,999 單位。禁止負數支出。

### 3.2 確定性零頭分配規則 (Leftover Distribution)
三個人均分 100 元 (`100 = 33 * 3 + 1`)：
1. 每人先分 `floor(100 / 3) = 33`。
2. 餘數 `1` 元分配順序：**付款人（若有參與分攤）優先得 1 元**，其餘按成員加入固定順序分配，每人最多分 1 元。
3. 最終結果為 `34, 33, 33`。完全確定，無浮點誤差與隨機性。
* **份數分攤 (Shares split)**：每人先得 `floor(total * weight / sum)`。若產生餘數，僅分配給產生小數零頭 (`hasRemainder`) 之成員，且付款人優先得 1 元；若某成員份額已為整除之整數，則不額外加 1，以確保所有人分得金額與數學期望值差距小於 1 單位。

### 3.3 匯率儲存與精度
* 匯率以放大 `1,000,000` 倍之整數存儲於 D1（例如 31.5234 存為 `31523400`）。
* 前端展示至小數點後 4 位。
* 使用者輸入換算後金額時，系統自動反推匯率並設為自訂匯率標記。

### 3.4 還款計畫與債務簡化
* **後端 Worker**：僅計算各成員的淨餘額 `Net Balance = 總支付 - 總分攤`（驗證總和恆等於 0）。
* **前端 Web Worker**：
  - 非零餘額人數 ≤ 20：執行精確圖論搜尋（Exact fewest-payments），介面標註「最少筆數」。
  - 非零餘額人數 > 20：執行貪婪演算法（Greedy），介面標註「至多 N-1 筆」。

---

## 4. 資料庫架構 (D1 Database Schema)

採用 Drizzle ORM 管理，包含 11 張核心資料表：

```sql
-- 1. 使用者主表
CREATE TABLE users (
  id TEXT PRIMARY KEY, -- ULID / Random ID
  display_name TEXT NOT NULL,
  picture_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 2. 第三方身分關聯表 (Google / LINE)
CREATE TABLE identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, -- 'google' | 'line'
  provider_sub TEXT NOT NULL,
  email TEXT, -- 僅 Google 且 Google 回報已驗證時儲存；LINE 一律為空
  created_at INTEGER NOT NULL,
  UNIQUE(provider, provider_sub)
);

-- 3. 會話輪轉 Refresh Token
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  user_agent TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- 4. 群組主表 (日常記帳或旅程)
CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  settlement_currency TEXT NOT NULL DEFAULT 'TWD', -- 第一筆支出後鎖定
  default_expense_currency TEXT NOT NULL DEFAULT 'TWD',
  is_trip INTEGER NOT NULL DEFAULT 0, -- 0: Running Tab, 1: Trip
  trip_destination TEXT,
  trip_start_date TEXT, -- YYYY-MM-DD
  trip_end_date TEXT,   -- YYYY-MM-DD
  trip_notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 5. 群組成員表 (支援正式用戶與虛擬成員)
CREATE TABLE members (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL, -- NULL 為虛擬成員
  placeholder_name TEXT, -- 虛擬成員名稱
  nickname TEXT, -- 群組專屬暱稱
  role TEXT NOT NULL DEFAULT 'member', -- 'admin' | 'member'
  net_balance INTEGER NOT NULL DEFAULT 0, -- 以群組結算幣別計算之餘額快照
  created_at INTEGER NOT NULL,
  UNIQUE(group_id, user_id)
);

-- 6. 群組邀請碼 (12 小時時效)
CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- 7. 支出開銷主表
CREATE TABLE expenses (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  creator_member_id TEXT NOT NULL REFERENCES members(id),
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  original_amount INTEGER NOT NULL,
  original_currency TEXT NOT NULL,
  fx_rate_scaled INTEGER NOT NULL, -- 匯率 * 1,000,000
  fx_date TEXT NOT NULL,
  is_custom_rate INTEGER NOT NULL DEFAULT 0,
  settlement_amount INTEGER NOT NULL, -- 換算後結算幣別金額
  split_type TEXT NOT NULL, -- 'equal' | 'exact' | 'shares'
  expense_date TEXT NOT NULL, -- YYYY-MM-DD
  expense_time TEXT,          -- HH:mm
  stop_id TEXT REFERENCES stops(id) ON DELETE SET NULL,
  receipt_key TEXT,
  idempotency_key TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 8. 支出付款人列表 (支援多人先付)
CREATE TABLE expense_payers (
  id TEXT PRIMARY KEY,
  expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id),
  amount INTEGER NOT NULL, -- 原幣金額
  settlement_amount INTEGER NOT NULL -- 結算幣金額
);

-- 9. 支出分攤細項列表
CREATE TABLE expense_splits (
  id TEXT PRIMARY KEY,
  expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id),
  share_units INTEGER NOT NULL DEFAULT 1,
  settlement_amount INTEGER NOT NULL
);

-- 10. 結算還款紀錄表
CREATE TABLE settlements (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  payer_member_id TEXT NOT NULL REFERENCES members(id),
  receiver_member_id TEXT NOT NULL REFERENCES members(id),
  amount INTEGER NOT NULL, -- 群組結算幣別整數
  status TEXT NOT NULL DEFAULT 'confirmed', -- 'pending' | 'confirmed' | 'cancelled' | 'undone'
  confirmed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 11. 行程站點表
CREATE TABLE stops (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  day_date TEXT NOT NULL, -- YYYY-MM-DD
  start_time TEXT,        -- HH:mm
  end_time TEXT,          -- HH:mm
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  location_name TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 12. 每日匯率快取表
CREATE TABLE fx_rates (
  rate_date TEXT NOT NULL,
  base_currency TEXT NOT NULL,
  quote_currency TEXT NOT NULL,
  rate_scaled INTEGER NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (rate_date, base_currency, quote_currency)
);
```

---

## 5. API 合約 (Typed Hono REST API)

### 5.1 認證與端點列表 (`/api/v1`)
* **認證機制**：Header `Authorization: Bearer <access_jwt>` (效期 1 小時)。
* **防重送與並行**：
  - POST 支出與結算帶 `Idempotency-Key`。
  - PATCH 帶 `If-Match: <updated_at>` 樂觀鎖校驗。

| 模組 | HTTP 方法與路徑 | 說明 |
| :--- | :--- | :--- |
| **Auth** | `POST /auth/google` | Google ID Token 交換 Session |
| | `POST /auth/line` | LINE LIFF ID Token 交換 Session |
| | `POST /auth/refresh` | Cookie 輪轉換發 Access Token |
| | `POST /auth/logout` | 登出當前裝置 |
| | `POST /auth/link/:provider` | 綁定第二身分 |
| | `POST /auth/link-code` & `POST /auth/link-code/redeem` | 產生連結碼 / 用連結碼加 Google ID Token 綁定 Google（見 W-8） |
| | `DELETE /auth/identities/:provider`| 解除第三方身分綁定 |
| | `GET /me` & `DELETE /me` | 查詢個人資料 / 刪除帳號 |
| **Groups** | `GET /groups` & `POST /groups` | 取得群組列表 / 建立群組 |
| | `GET, PATCH, DELETE /groups/:id` | 群組詳情 / 修改 / 刪除 |
| **Members**| `GET /groups/:id/members` | 成員列表與即時淨餘額快照 |
| | `PATCH /groups/:id/members/:mid` | 變更角色 (Admin/Member) 或設定暱稱 |
| | `DELETE /groups/:id/members/:mid`| 移除成員 (餘額需歸零) |
| | `POST /groups/:id/claim-placeholder`| 正式用戶認領虛擬成員 |
| **Invites**| `POST /groups/:id/invite` | 管理員重新產生 12 小時邀請碼 |
| | `GET /invites/:token` | 邀請資訊預覽 (群組名稱、成員數) |
| | `POST /invites/:token/join` | 確認加入群組 |
| **Expenses**| `GET, POST /groups/:id/expenses` | 開銷列表 (遊標分頁 50 筆) / 新增支出 (`D1.batch()`) |
| | `GET, PATCH, DELETE /groups/:id/expenses/:eid` | 開銷明細 / 修改 / 刪除 |
| **Balances**| `GET /groups/:id/balances` | 取得群組全體成員餘額 |
| **Settlements**| `GET, POST /groups/:id/settlements`| 結算列表 / 記錄一筆付款（新建立的結算直接為已確認） |
| | `POST /settlements/:sid/undo` | 撤銷結算 |
| **Stops** | `GET, POST /groups/:id/stops` | 查詢每日站點 / 新增站點 |
| | `PATCH, DELETE /groups/:id/stops/:sid` | 編輯站點 / 刪除站點 |
| **Rates** | `GET /rates?date&base&quote` | 查詢參考匯率 (D1 命中快取或調用 Frankfurter) |
| **LINE** | `POST /line/webhook` | 驗證簽章，被動回覆圖文引導與說明 |

### 5.2 每日維護 (Cron)

每日排程依序執行：清除過期資料 ➔ 結清待處理的帳號清理 ➔ 更新參考匯率。

* **M-1 過期資料**：清除已過期的登入狀態、過期的連結碼與舊的限流計數。
* **M-2 舊預留**：超過 24 小時仍為「待處理」的群組預留，只有在群組帳本（權威來源）回覆該使用者不是有效成員時才刪除。
  - 回 204（仍在群組）：保留並改為「已生效」，避免同步延遲的列長期占據清理名額。
  - 帳本無法回答（錯誤或逾時 5 秒）：保留，留待下次。
  - 每次最多檢查 100 筆，由舊到新；任何一筆失敗都不得中斷整個每日排程。
  - 理由：誤刪仍有效的預留，會讓之後的帳號刪除略過該群組的凍結與匿名化，也會少算群組上限。

---

## 6. 前端規格與畫面校準 (Frontend & Screen Specs)

* **導覽結構**：
  - 手機端：底部五標籤（首頁、旅遊、＋記一筆、統計、設定）。點擊「旅遊」不切換路由，跳出「旅遊功能即將推出，敬請期待！」輕量通知；若畫面已存在或動態新增其他儲存結果提示（如支出儲存提示），「旅遊」通知依據現有提示的實際結算幾何高度（防禦進場 transform 瞬態干擾）動態向上堆疊（頂部保留 8px 間距，完全不遮蔽現有提示），且雙方獨立計時、互不干擾。
  - 桌面端：響應式左側欄雙欄佈局（共用相同路由與狀態，包含「旅遊」通知按鈕）。
* **UI 原語**：Tailwind CSS v4 + Radix UI (Dialog、Sheet、Select、Popover)。
* **首頁呈現**：目前淨收付以使用者的偏好幣別顯示為單一數字；其他幣別依當日最新參考匯率換算後加總（僅供參考，見 ADR 0002）。取不到匯率時退回依幣別並列。群組列與結算畫面一律維持各群組的結算幣別，不換算。「待結算的群組」標題右側提供「我的群組 ›」文字連結，直接前往 `/groups`。
* **新增開銷表單**：
  - 標籤頁：僅保留「花費」與「轉帳」兩大頁籤（排除「收入」）。
  - 金額輸入框內建安全算式解析器（支援 `+`、`-`、`*`、`/`，防禦 `eval`）。
  - 幣別選單提供 `TWD`、`USD`、`JPY`、`THB`。
* **靜態登陸頁**：未登入訪客訪問根路徑 `/` 時載入簡潔形象頁，登入後自動轉跳進入 App。

### 6.1 寫入後的畫面反應 (Write Latency & Optimistic Updates)

原則：使用者按下送出後，畫面不等「重新抓取」；金額相關的畫面只在伺服器確認後更新，例外是記錄或撤銷結算：只按該筆金額精確移動付款人與收款人的餘額（見 W-4 與 ADR 0004）。每一條都有編號，程式碼審查以此為準。

* **W-1 不等重抓**：刪除支出、撤銷結算、刪除群組、建立群組、加入群組成功後，立刻放行（跳轉或解除按鈕），重新抓取在背景進行。成員的連續修改各自退回失敗的那一筆，並等同一群組最後一筆修改完成後才重新抓取，避免較早回覆蓋掉仍在等待的修改。
* **W-2 新增支出**：表單結構為「日期與行程」置頂於「金額」之上；金額輸入框下方提供 `+1000, +500, +100, +50, +10, +5, +1` 快捷增額橫向按鈕列；在支援的 LINE 對話框環境下，「發送當前對話框」勾選膠囊位於「分帳方式」標題列右側。按下儲存立刻跳到群組頁，以儲存中的列顯示（見 W-6）。分享卡與 LINE 對話框傳送在背景進行，結果出現後以提示呈現；傳送失敗要讓使用者看到。進入新增頁時先預取邀請連結（盡力而為，失敗不影響）；同時間只發一個「確保邀請」請求。
* **W-3 背景分享結果的暫存**：背景結果以支出 id 暫存在記憶體，不放進路由狀態或查詢快取（兩者會被存到歷史或本機）。頁面離開或失敗時都要清掉；重新整理後不再顯示提示。登出（主動或重新整理權杖被拒）時，一併清除等待中的分享與「剛儲存」提示；若分享仍在等待邀請連結，登出後不得開始傳送至 LINE 對話框，已發出的傳送無法撤回，但遲到結果不得再顯示提示。
* **W-4 撤銷結算（先改再問）**：只在該筆結算為「已確認」時，按下即把付款人餘額減、收款人餘額加該筆金額，並把該列標成已撤銷（按鈕消失，防止重複撤銷）。伺服器回覆後以其回傳的結算取代；失敗則只退回這一筆撤銷（反向套回目前的餘額，並把該列改回已確認）並顯示錯誤，不還原舊快照，期間完成的其他付款會保留；若伺服器的最新結果已在退回前取代了畫面上的數字，就以伺服器的為準、不再退回；記錄付款失敗的退回方式相同。失敗後仍向伺服器重新取得餘額與列表，以免畫面與伺服器不一致。
* **W-5 刪除支出（先改再問）**：按下「刪除這筆」立刻回到群組頁，該筆在列表中隱藏，直到伺服器回覆；期間重新抓取列表也不會讓它重現。餘額、統計與列表上方的累計金額不預先調整，等伺服器確認後重新抓取。失敗時該筆重新顯示，群組頁顯示「刪除失敗，這筆開銷已放回：原因」，可關閉；失敗訊息只顯示在發生的那個群組，登出時清除，且不得存入持久化的查詢快取。確認鈕連按只送出一次刪除。
* **W-6 儲存中的列（新增與編輯支出）**：按下儲存立刻回到群組頁（編輯則回到詳情頁），群組帳目最上方出現一列「儲存中…」（名稱、金額）。餘額與總額不預先調整，等伺服器確認。成功後該列被真正的列取代；編輯中的原列在期間被該列取代。失敗時該列留在原處，顯示原因，提供「重試」與「放棄」；編輯的「儲存中」或失敗列同時顯示在回到的詳情頁上方；每次編輯各自一列，不互相覆蓋；重試沿用同一個 `Idempotency-Key`，不會重複記帳。「儲存中」列不得存入持久化的查詢快取，登出（含主動登出）時清除（背景分享與提示亦依 W-3 清除），且登出前送出、登出後才回覆的寫入結果一律忽略（不寫入快取、不顯示提示）；登出時仍在等待回覆的任何寫入都會被作廢，其回覆不會寫入快取；登出（含重新整理被拒而自動登出）後不會用新帳號的權杖重送舊帳號的請求；離開群組頁後，該群組遲到的分享結果不會顯示在別的群組上。編輯沒有防重複鍵：若伺服器已套用但回覆遺失，重試會遇到版本過期（EDIT_CONFLICT），此時重新讀取該筆，內容與我們的修改完全相同就視為成功，不同（例如別人另外改過）則顯示衝突，需放棄後重新編輯；已知限制：背景分享結果與「剛儲存」提示自建立起 60 秒內無人取用就丟棄，但已被群組頁取用的分享結果，完成時一律顯示（每筆支出各自一個提示，一次只顯示一個，前一個消失後才輪到下一個，不互相遮住）；伺服器已存好但回覆未到時重新抓取列表，可能暫時同時看到「儲存中」列與真正的列。
* **W-6a 建立與加入群組**：按下送出後，畫面立刻顯示全螢幕的「建立群組中…」／「加入群組中…」（模態對話框：焦點留在其中，背後的頁面、導覽與認領對話框對鍵盤和輔助技術隱藏，Esc 與點外面都不能關閉），不顯示預先猜測的結果；伺服器回覆後才進入群組。失敗時回到原表單（認領時回到認領對話框內）並顯示原因，輸入不丟失。等待期間返回鍵與頁面連結不會離開（伺服器回覆後才導向）。等待超過 20 秒，畫面加上「還在處理，結果還不確定」與「先離開」按鈕，按下回到群組列表（建立與加入相同）；離開後若請求才成功，群組只會在背景加進列表快取，不自動導向、不跳提示；不設傳輸逾時，因為放棄請求不會取消伺服器已做的事，會造成重複建立。失敗後鍵盤焦點回到等待前的按鈕（認領時為「確認認領」）。建立群組成功後進入成員與邀請頁，成員名單直接用伺服器剛回覆的建立者填入，不再等第二次請求；該頁在剛建立時多一個「回到首頁」連結（一般進入不顯示）。
* **W-7 登入金鑰下載失敗**：Google 與 LINE 的金鑰下載失敗不得被快取；下一次登入可立刻重試。找不到金鑰編號時才重新下載，且同一供應商 60 秒內至多一次。
* **W-9 設定頁的人物卡與登入方式**：
  - 名稱與頭像固定跟著 User 最早綁定的 Identity（Profile source），與群組裡看到的一致。只有 Profile source 登入時才更新 `users.display_name`／`picture_url`；用另一個方式登入只更新該方式自己的信箱。`GET /me` 的 `signedInWith` 是「這個 session 登入時用的方式」：登入時寫進 `sessions.provider` 與 access token 的 `prv`，refresh 換發新 token 時沿用，所以別的瀏覽器或裝置用另一種方式登入，不會改變這個 session 看到的值；LINE 與 Google 可以各在不同瀏覽器同時登入。遷移（0012）之前建立的 session 沒有這個值，`signedInWith` 退回 `users.last_provider`，再沒有就用最早的 Identity，下次重新登入才有自己的值。`users.last_provider` 不再寫入。Profile source 被解除綁定時，名稱與頭像維持原樣，改由剩下最早的 Identity 接手，並在它下次登入時更新。已被舊版覆蓋的帳號，等 Profile source 下次登入才換回。
  - 設定頁人物卡：名稱與頭像同上；旁邊的標籤跟著這個 session 的登入方式（綠色「LINE」或有彩色 G 的「Google」）；這個 session 是 Google 登入時，信箱以小字顯示在名稱下方，LINE 登入不顯示。Profile source 是 Google 且沒有頭像時，頭像位置顯示 Gmail 信封標誌。
  - 「登入與安全」永遠列出 LINE 與 Google 兩列，LINE 為綠點、Google 為小的 G 標誌，這一區不顯示信箱。已連結：顯示淡綠膠囊「✓ 已連結」，剛完成連結的那一刻打勾彈出一次（頁面打開時就已連結的不動）；兩者都連結時才有小的「解除連結」。未連結的 Google：右邊顯示「連接」按鈕（W-8）。未連結的 LINE：顯示「即將推出」，不提供按鈕。
  - 信箱：只有 Google 的 ID token 帶 `email` 且 `email_verified` 為真時才存入 `identities.email`；LINE 一律不存。每次登入若取得信箱就更新，沒取得時保留原值。刪除帳號時隨登入方式一併刪除。不給群組其他成員看，也不用來寄信。
  - 資料遷移（0011）：刪除所有既有的 Google 綁定，這些人下次用 Google 登入時重新綁定；只靠 Google 登入的人會得到新帳號，原帳號的群組紀錄不會合併。
* **W-8 在 LINE 內連結 Google（連結碼）**：Google 不接受 LINE 內建瀏覽器登入，所以設定頁依環境分兩種。
  - 在 LINE 內、尚未連結 Google：「登入與安全」的 Google 那列右邊顯示「連接」按鈕，不顯示 Google 按鈕，也沒有額外的提示文字（按鈕本身就會前往外部瀏覽器）。按下後向伺服器要一個連結碼，用手機的外部瀏覽器開啟 `/link?code=…`。「開啟外部瀏覽器」在 LIFF（LINE app 內）用 `liff.openWindow({ url, external: true })`，因為 LINE 在 LIFF 裡不認 `openExternalBrowser` 網址參數；在沒有 LIFF 的 LINE 內建瀏覽器才改用該參數。在 LIFF 內若 LIFF 無法啟動或開啟失敗，顯示「小芽出了點狀況，請稍後再試。」，不會退回那個沒用的參數。設定頁、登入頁提示框、`/link` 頁三處都適用。
  - 不在 LINE 內、尚未連結 Google：直接顯示 Google 按鈕，成功後走 `POST /auth/link/google`。
  - 已連結 Google，或沒設定 Google 用戶端 ID：不顯示任何連結入口。
  - `/link` 頁在外部瀏覽器、未登入時，一打開就直接前往 Google 的帳號選擇頁（不必再按一次 Google 按鈕）；連結碼隨 `state` 帶去、回來時取回。每個連結碼只自動跳轉一次，按返回或 Google 拒絕後停在頁面上的 Google 按鈕。（同一套整頁導向，回到 `/google-return`。）
  - `/link` 頁不需登入。在外部瀏覽器用 Google 登入後，Google 身分掛到發出連結碼的那位使用者，並以該使用者登入，成功後進設定頁。若在 LINE 內開 `/link`（不論有沒有登入），只顯示「請用外部瀏覽器開啟」說明與「用瀏覽器開啟」按鈕（開啟目前這一頁，連結碼不變），不顯示 Google 按鈕，也不顯示登出牆。
  - 在 `/link` 頁若這個瀏覽器（不在 LINE 內）已經登入：不顯示 Google 按鈕，改顯示「請先登出」與「登出」按鈕，登出後才能用連結碼，不會在登入狀態下直接切換成另一位使用者。
  - Google 登入一律走整頁導向，不載入 Google 的腳本、不疊 Google 的官方按鈕（它是 iframe，按下的事件到不了頁面，做不出按壓回饋）：登入頁的「使用 Google 登入」與設定頁（不在 LINE 內）的「連接」是我們自己的按鈕，按下立刻縮到 92%（`press-deep`），並顯示轉圈圈與「前往 Google…」，然後整頁前往 Google 的帳號選擇頁。所有 Google 入口（登入頁、LINE 內的提示框、`/link`、設定頁兩種「連接」）同一個外觀：白底（Google 的 G 必須放白底）、一圈 Google 四色（藍紅黃綠）漸層外框、柔和的藍色光影與頂緣高光；「連接」是帶彩色 G 的膠囊、至少 44px 高。回到伺服器的固定網址是 `/google-return`（需在 Google Cloud 的授權重新導向 URI 登記 `https://split.rickchen.si/google-return`）；出發前把用途（登入＋登入後去哪、連結、完成連結碼）放進 `state`，回來後由這一頁照 `state` 完成：登入→進 `next`（只接受同站路徑）、連結→`POST /auth/link/google` 後進設定頁、連結碼→`/auth/link-code/redeem` 後進設定頁。`state` 與 ID token 都當外部輸入檢查：`state` 無法讀懂就回登入頁；ID token 的 nonce 必須是出發時存的那個，壞掉、缺 nonce、nonce 不符都當作沒拿到 token。使用者在 Google 取消或失敗，回到出發的那一頁（登入頁／設定頁／`/link?code=…`），不會卡在空白頁。所有動態遵守「減少動態效果」。
  - 前往 Google 與從 Google 回來的過程中（`/link` 跳轉前、`/google-return` 處理中），整個畫面只顯示 Google 過場：白底圓形中的彩色 G，外面一圈藍紅黃綠四色的環持續轉動，下方一行字（前往 Google…／正在登入…／正在連結…）。不先畫出 `/link` 的內容頁，也不顯示小芽載入畫面；只有確定不會跳去 Google（已跳過一次的連結碼、Google 拒絕、沒設定用戶端 ID）才顯示 `/link` 頁。「減少動態效果」時環不轉。連結失敗（`IDENTITY_LINKED_ELSEWHERE`）的訊息說明該 Google 已是另一個小芽帳號的登入方式、無法合併，請改用別的 Google 帳號。
  - 連結碼：128 位元以上隨機、5 分鐘有效、只能用一次、資料庫只存雜湊；每位使用者同時只有一個，再要一個就取代舊的。無效、過期、用過一律回 `LINK_CODE_INVALID`（422），不區分原因。
  - 先驗 Google ID token，再消耗連結碼；ID token 無效時連結碼保留可再用。連結碼消耗後若 Google 帳號已屬於別的使用者（`IDENTITY_LINKED_ELSEWHERE`）或使用者已有 Google（`PROVIDER_ALREADY_LINKED`），連結碼仍已作廢，需回 LINE 重新取得；任何失敗都不建立新使用者。
  - 登入頁在 LINE 內且有設定 Google 時，Google 按鈕外觀與 LINE 外相同（白底「使用 Google 登入」）。按下去不啟動 Google 登入，而是跳出提示框：標題「請用外部瀏覽器登入 Google」，說明 Google 不允許在 LINE 內建瀏覽器登入，按鈕「取消」（關閉）與「用瀏覽器開啟」（依上方「開啟外部瀏覽器」規則，在手機瀏覽器開啟目前這一頁，網址多帶 `google=1`）。外部瀏覽器（不在 LINE 內、有設定 Google）看到登入頁的 `google=1` 時，不先畫出登入頁，直接顯示 Google 過場並前往 Google 的帳號選擇頁（不必再按一次 Google 按鈕），登入後回到網址中的 `next`（只接受同站路徑）；同一個 `next` 在同一個分頁只自動跳轉一次，Google 拒絕或按返回後停在有 LINE 與 Google 兩顆按鈕的登入頁；在 LINE 內或沒設定 Google 時忽略 `google=1`。提示框用專案的 Radix 對話框：Tab 不會跑到背景、按 Esc 或「取消」關閉，關閉後焦點回到 Google 按鈕。不在 LINE 內時按鈕行為不變，不出現提示框。
  - 在外部瀏覽器綁定完成後，回到 LINE 內的設定頁（頁面重新變成可見）時，重新讀取 `GET /me`，只更新「登入與安全」的已連結清單；人物卡不變（仍是這個畫面這次登入的方式）。只在設定頁生效、不輪詢，沒有額外提示；讀取失敗就保持原樣，下次切回來再試。
  - 範圍：目前只支援 LINE 使用者連結 Google；從 Google 連結 LINE 尚未實作。過期連結碼由每日清理刪除（M-1）。

---

## 7. 測試架構與自動化驗收 (Testing Strategy)

1. **純金流引擎 (Vitest + Property-based Tests)**：
   - 驗證恆等式：分攤加總必等於支出總額；全組餘額加總恆等於 0。
   - 100 元 3 人均分必定為 `34, 33, 33`。
2. **D1 資料庫整合測試**：
   - 使用 `@cloudflare/vitest-plugin` 於本機記憶體版 D1 執行 Migration。
   - 驗證 `batch()` 失敗時完全 rollback、`Idempotency-Key` 冪等性。
3. **端對端 E2E 測試 (Playwright)**：
   - 覆蓋三大黃金路徑：登入 ➔ 記一筆 ➔ 結算付款。
   - 內建一條硬性驗收：斷言「測試登入捷徑路由」在正式環境設定下必定回傳 404。
4. **CI/CD 門禁 (GitHub Actions)**：
   - 每次 PR 強制跑 `tsc`、`lint`、單元與資料庫測試、`gitleaks` 密鑰掃描。

---

## 8. 交付階段與實作順序 (Delivery Order & Milestones)

* **Phase 1: 共享核心與資料層 (Shared Core & DB)**
  - 建立 pnpm monorepo 與 TypeScript 嚴格環境。
  - 實作 `packages/shared`：Zod Schema、確定性零頭分配演算法、Web Worker 還款搜尋引擎與完整屬性測試。
  - 設定 Drizzle ORM 與 D1 SQLite 表結構 Migration。
* **Phase 2: 後端 API 與身分認證 (Worker Backend & Auth)**
  - 實作 Hono 核心框架、Error Handling 與 Idempotency 中介軟體。
  - 實作 Google SSO 與 LINE LIFF ES256 Token 驗證及 Session 輪轉機制。
  - 完成 Groups, Expenses (`D1.batch`), Balances, Settlements, Stops API 端點與整合測試。
* **Phase 3: 前端介面與全端串接 (React SPA Frontend)**
  - 搭建 Vite + React 19 + Tailwind v4 + Radix UI 響應式外殼。
  - 實作 TanStack Query 與 Hono Typed Client 數據快取層。
  - 依校準後之 31 個畫面實作記帳表單（內建算式解析器）、多幣別匯率反推、行程時間軸與結算畫面。
* **Phase 4: 整合驗收與雲端發布 (Integration & Deploy)**
  - 配置 GitHub Actions 自動化部署管線 (Staging -> Production)。
  - 設定 Cloudflare WAF 限流規則與 `split.rickchen.si` 路由。
  - 執行 Playwright E2E 測試與手動發布檢核表 (Release Checklist)。

群組成員開啟邀請時，使用 `POST /groups/:id/invite/ensure` 取得現有有效邀請，或在沒有有效邀請時產生 12 小時邀請。已發出的邀請依照各自儲存的到期時間失效。

## Flight Radar — live single-route discovery

- `/travel` is a signed-in standalone Flight Radar screen in both navigation bars. Sign-in returns visitors to that URL. `/trips/latest` redirects to `/travel`; Group Trip remains disabled.
- Traditional Chinese and English labels follow the User's Language. TPE is the default origin with TSA, RMQ and KHH quick choices or an explicit airport code. Searches price one adult in round-trip economy using Preferred currency and exact departure/return dates, with an optional budget.
- `POST /api/v1/flights/search` validates airport/date/currency inputs and refuses past departures. It returns source fares with airline, outbound times, stops, duration, deterministic Deal Signals and Google Flights `?tfs=` links. Fare and budget amounts use integer currency minor units.
- Current `fast-flights` round-trip quotes describe outbound choices before the user selects a return. Unavailable return times are explicitly labelled as selected on Google Flights, never invented. Native `low`/`typical`/`high` is accepted only from Google's price indicator when present; absent indicators stay `unknown` and conservatively show Hold. This is an upstream limitation against the original complete-inbound-summary goal.
- Initial signals: over budget or native high → Hold; native low within budget → Strong Buy; native typical within budget → Buy; unknown → Hold. Over-budget deltas are explicit. No historical percentages are claimed by this slice.
- Source facts are shared in D1 for 30 minutes, with budget-specific signals recomputed per request. User limits are 10 searches/minute and 40/hour; cached requests still respect these limits but never start the container. Expired cache entries are removed by daily maintenance. Counters cascade on account deletion.
- Timeout, rate limit, challenge, empty and invalid upstream responses return a direct-link fallback with exact route/dates. Challenges are never bypassed. The source runs in a private Cloudflare Container with a ten-minute idle sleep and one maximum instance.

### Flight Radar — daily history and highlights

- A shared catalog contains 27 Taiwan-origin destination airports with English/Traditional Chinese names, climate and vibe tags, and approximate discovery flight durations. These durations never replace live itinerary times or imply prices.
- Every successful live source lookup stores one observed daily minimum per origin/destination/currency/advance-window bucket (`0–14`, `15–30`, `31–60`, `61+` days ahead). Repeated observations can lower that day's minimum; they never add another historical day. Cached replies do not create observations. History covers today and the preceding 59 UTC dates, with daily purging.
- Deal Signals use deterministic code. Budget overruns, time-rule violations, native high prices, or a fare more than 15% above the historical mean mean Hold. Otherwise native low, at least 15% below the historical mean, or the lowest tenth percentile mean Strong Buy; native typical or within ±15% of the mean mean Buy. Native high and budget/time violations take precedence over bargain indicators.
- Mean/percentage/percentile statistics are returned and displayed only once the same route/currency/window has at least 14 distinct daily observations. Before that, only native price-level and budget facts are shown.
- `GET /api/v1/flights/highlights?currency=...` returns up to 12 of today's observed Strong Buy route minima in that currency, with concrete future dates. The horizontal `/travel` strip has honest empty/error states; tapping a verified highlight submits its exact structured search. No synthetic highlights or guessed fares are displayed.
- Daily maintenance refreshes four rotating catalog routes from TPE in TWD, using direct round-trip economy fares for a concrete future Friday–Monday. Refreshes reuse D1 source caching and do not consume any User's search counters. Source failures do not prevent the remaining routes from refreshing.

### Flight Radar — prompt and button discovery

- Searches accept an explicit canonical intent or `{prompt, defaults}`. User quotas are checked before prompt parsing; structured Recipe taps and Entity Pill edits skip parsing entirely. Canonical intents carry a representative destination plus an optional theme; a theme selects the actual route candidates, while every fare card carries its own exact route intent.
- Per the implementation-session decision, Groq `openai/gpt-oss-120b` with low reasoning effort and strict `json_schema` replaces the originally proposed Llama model (which does not support Groq strict schema mode). Outputs are also validated by a strict local schema. Primary failures, throttles, timeout or invalid output fall back to Workers AI `@cf/meta/llama-3.3-70b-instruct-fp8-fast`; both providers have bounded six-second waits. Provider output never supplies fare amounts or Deal Signals.
- Fuzzy next-weekend and next-month-weekend intent anchors to the first matching Friday in Taiwan's target calendar window; three days means Friday–Sunday, four days Friday–Monday. Exact resolved dates always appear in the Entity Pills. Explicit global three-letter airport codes remain accepted outside the catalog.
- Theme searches select up to four matching catalog destinations in parallel. Exact-destination searches compare the requested departure/return pair with both dates shifted one day earlier and one day later, omitting past candidates. Results sort by deterministic Deal Signal then fare. Direct-only and 22:00–05:59 red-eye departure exclusions filter returned data as well as source queries; budget overruns remain visible as Hold.
- The bilingual Vibe Recipe deck offers season-aware escapes, warm islands, food cities, solo breaks, weekend/month windows, a bridge around the next fixed Taiwan holiday (New Year, Peace Memorial Day, Children's Day, Labour Day or National Day), budget caps in the selected currency and no-red-eye preferences. Lunar/variable holidays are not guessed. Recipe taps execute structured searches and can also seed defaults for a mixed natural-language prompt.
- Entity Pills support inline edits/removal for origin, destination/theme, concrete dates, budget and time/direct rules. Saving an edit submits the changed canonical intent directly and reruns discovery without an LLM parse request. Removing required conditions restores the displayed default rather than pricing an unspecified route or date.
