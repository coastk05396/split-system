# 小芽 (Sprout / Split-System) — 產品與技術架構規格書

> **專案名稱**：小芽 (英文：Sprout)  
> **正式網域**：`split.rickchen.si`  
> **狀態**：Active Specification (Daily Flights + Expense Splitting)  
> **基礎設施原則**：100% Cloudflare Edge / Zero-Server / Local-First Development  

---

## 1. 產品概述與邊界 (Product Overview & Scope)

### 1.1 產品定位
「小芽」(Sprout) 結合「每日便宜航班情報 (`Daily Flights`)」與「親友群組分帳 (`Expense Splitting`)」，以小豆芽吉祥物貫穿親切、直接、免打字的設計體驗，讓好友從找到神價機票到旅途結算都能在同一處完成。

### 1.2 系統邊界
* **In-Scope**：
  - 每日便宜航班 (`/flights`)：免登入即可瀏覽，台灣出發機場 (`TPE`, `TSA`, `KHH`) 的來回票看板（資料來自 Google Explore 的每日 SerpApi 同步；出發日為明天起至 6 個月內；精選目的地、轉機少於 3 次的來回票全數收錄，不設折扣門檻、不沿用前一天票價，ADR 0013；唯松山 `TSA` 出發的票價須為至少 15% 的真實折扣才收錄，ADR 0014）、依目的地城市分組的卡片、折扣標記（≥50% 實心綠色膠囊 `省 X%`、15–49% 綠字 `省 X%`、< 15% 或沒有真實基準價時不顯示）與雙語 Trip.com (`tw.trip.com` / `www.trip.com`) 導購轉址。
  - 首頁登陸頁 (`/` 未登入)：雙核心展示「即時浮動特價機票看板」與「快速分帳預覽」，可直接在首頁切換地區分頁、點擊機票前往 Trip.com 或進入 `/flights` 完整看板，並支援中英文切換與 Google/LINE 登入。
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

-- 13. 每日便宜航班快照表
CREATE TABLE daily_flights (
  id TEXT PRIMARY KEY,
  digest_date TEXT NOT NULL, -- YYYY-MM-DD (UTC+8)
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  out_date TEXT NOT NULL,  -- YYYY-MM-DD
  in_date TEXT NOT NULL,   -- YYYY-MM-DD（只收來回票）
  price_twd INTEGER NOT NULL,
  discount_pct INTEGER NOT NULL,
  tag TEXT NOT NULL,       -- 'steal' | 'below_market' | 'normal'
  airlines_json TEXT NOT NULL, -- JSON array of airline IATA codes
  transfers INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- 14. 航線典型價格區間快取（Google Flights `typical_price_range`，30 天；可棄置、過期自動重抓，ADR 0013）
CREATE TABLE flight_baselines (
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  typical_low_twd INTEGER NOT NULL,
  typical_high_twd INTEGER NOT NULL, -- Deal Signal 的比較基準
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (origin, destination)
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
| **Flights** | `GET /flights/daily` | 公開端點：取得每日特價航班清單（無需登入；D1 無有效未來日期快取時回傳 `isFallback: true` 精選參考清單；另附公開的 Trip.com 聯盟參數 `affiliate`（`allianceId`、`sid`、`sub3`，僅含已設定者，非機密，由 Worker 設定 `TRIP_COM_ALLIANCE_ID`／`TRIP_COM_SID`／`TRIP_COM_SUB3` 提供），供前端在 LINE 內組出同一個 Trip.com 網址，ADR 0015） |
| | `GET /flights/go` | 公開端點：校驗航班查詢參數（`origin` 須為 `TPE`／`TSA`／`KHH`，`outDate` 與 `inDate` 必填且返程不早於出發；只有來回票）並 `302` 導向對應語言的 Trip.com 搜尋頁（`zh-TW` → `tw.trip.com`，`en` → `www.trip.com`；無開放轉址風險）；同時設定 `Allianceid` 與 `SID` 時才附加 `Allianceid`、`SID`、`trip_sub1`，以及（若已設定）`trip_sub3`，缺任一必要者則一律不附加。供外部瀏覽器與舊連結使用；LINE 內僅在每日資料尚未載入或改用精選參考清單、拿不到聯盟參數時才經過此端點（以免丟失聯盟參數），其餘情況不再經過 |
| **LINE** | `POST /line/webhook` | 驗證簽章，被動回覆圖文引導與說明 |

### 5.2 每日維護 (Cron)

每日拆分為兩條獨立 Cron 排程：`30 16 * * *`（台灣時間 `00:30`）依序執行「清除過期資料 ➔ 結清待處理的帳號清理 ➔ 更新參考匯率」，`0 0 * * *`（台灣時間 `08:00`）專責執行「更新每日便宜航班 (`refreshDailyFlights`)」（未指定 Cron 之手動測試則依序執行全部步驟）；每日航班同步完全在 Worker Cron 內以純 TypeScript `fetch` 呼叫 SerpApi 完成，每次 Cron 觸發都會執行（無略過視窗），沒有 GitHub Actions 同步工作流程、Python 轉接器、Travelpayouts 或第二階段驗證（ADR 0013，取代 ADR 0006／0008／0010／0012）；另提供本機維運腳本 `apps/worker/scripts/sync-daily-flights.ts` (`SERPAPI_KEY_SHORT=... SERPAPI_KEY_LONG=... pnpm --filter @split/worker sync-flights -- --dry-run` 或 `-- --remote`) 供開發者隨時手動抓價並寫入本機或遠端 D1：只跑兩把 Explore 金鑰負責的查詢（缺哪把就略過哪個角色，與 Cron 相同），以目標 D1 內仍有效的 Baseline 評分，**不會**補抓 Baseline（只有 Cron 與 `seed-baselines` 會）。

* **refreshDailyFlights**：使用三把依角色分開的 Worker 密鑰（ADR 0014，取代 `SERPAPI_KEYS`）：`SERPAPI_KEY_SHORT`（短程 Explore 查詢）、`SERPAPI_KEY_LONG`（長程 Explore 查詢）、`SERPAPI_KEY_BASELINE`（Baseline 查詢）；只放在 Cloudflare Worker secrets／本機 `.dev.vars`，不得寫入程式碼、測試、文件或日誌。**各角色只用自己的金鑰，不共用、不互借**：某角色的金鑰缺漏、空白，或回應 401／403／429 或「搜尋額度用盡／金鑰無效」時，該角色在本次執行其餘時間一律略過並記一行日誌（只記角色，不含金鑰），其他角色照常執行、整次同步不失敗。每次執行依序送出 `google_travel_explore` 查詢，一律 `type=1`、`currency=TWD`、`hl=en`、`gl=tw`、來回票，每天都全部執行、不輪替（看板每次整批取代，輪替查詢的票價會在休息日消失）：
  - **短程（短程金鑰，最多 8 次）**：自 `TPE`、`KHH`、`TSA` 各查亞洲（預設視窗）；自 `TPE` 與 `KHH` 查日本、自 `KHH` 查韓國（以國家的 Google Knowledge Graph 代碼為 `arrival_area_id`：日本 `/m/03_3d`、南韓 `/m/06qd3`）；另有 2 次以 `month` 限定月份：自 `TPE` 查日本、自 `TPE` 查韓國（`TPE` 韓國不帶月份時回應為空，所以一律限定月份）。
  - **長程（長程金鑰，最多 6 次）**：自 `TPE` 查歐洲 (`/m/02j9z`)、北美 (`/m/059g4`)、大洋洲 (`/m/05nrg`) 與中東 (`/m/04wsz`，含土耳其)，另有歐洲與北美各 1 次限定月份的查詢。
  - **月份選擇**：日本、歐洲、北美取**當日**對應的不限月份答案中最便宜票價的出發月份；`TPE` 韓國取 `KHH` 韓國答案中最便宜票價的出發月份，該答案缺漏時退回輪替的未來月份。日本同樣在不限月份答案沒有可用月份時退回輪替月份；歐洲與北美沒有可用月份時就不送出該月份查詢。永遠不選當月（Explore 只接受未來 6 個月）。限定月份的答案併入同一個看板，同一（出發機場 × 目的地 × 出發日）仍只留最便宜者。
  單一查詢失敗（逾時、5xx、無結果）只略過該查詢。日誌只記錄狀態與角色，不含金鑰或含金鑰的網址（錯誤只記錯誤類別）。

  收錄規則（ADR 0013，低價總覽）：目的地須為手工維護的精選目的地目錄 (`DESTINATION_CATALOG`，159 個機場、約 149 個城市、45 個國家，其中日本 25、韓國 5、東南亞 15、中港澳 11、歐洲 37、北美 44、大洋洲 16（含關島、帛琉與塞班）、中東 6 個機場；紐華克 `EWR` 與甘迺迪 `JFK` 同屬紐約城市卡、羅德岱堡 `FLL` 與 `MIA` 同屬邁阿密城市卡；不收莫斯科（ADR 0016）；每筆具中英文城市與國家名、國旗、同城共用城市代碼、地區、機場時區，以及**選填**的靜態備援基準價 `baselineTwd`，並有目錄完整性測試)，未列入的機場一律丟棄；必須有回程日且回程晚於出發日（僅來回票）；出發日介於**明天（含）至今日起 6 個月（含）**；轉機次數 `< 3`（3 次以上排除）；同一（出發機場 × 目的地 × 出發日）只保留最便宜者。通過者**全數收錄，不論折扣多少**（沒有 15% 門檻），當日不沿用前一天的票價；**唯一例外是松山 `TSA`**：`TSA` 的票價須有 `below_market` 或 `steal` 的 Deal Signal（至少低於其 Baseline 15%）才收錄，沒有 Baseline 的 `TSA` 票價不收錄（ADR 0014；`KHH` 與 `TPE` 不受影響）。

  航空公司：`airline_code` 為單一 IATA 代碼時存為 `[code]`；為 `"multi"` 且帶有合併的 `airline` 字串（如 `Jetstar and Peach Aviation`、`Air India, EVA Air, and Etihad`）時拆成各家航空，已知名稱對應為 IATA 代碼、未知名稱原樣保留為字串、去除重複並保留順序，絕不儲存 `"multi"`；完全沒有航空資訊的票價略過。評分對照該航線的**典型高價**（`typicalHighTwd`，Google Flights `price_insights.typical_price_range` 上緣；每航線快取 30 天於 `flight_baselines`）：折扣 = `round((高價 − 票價) / 高價 × 100)`，不低於 0，≥50% 為 `steal`、15–49% 為 `below_market`、其餘 `normal`（不顯示）。基準兩層解析：(出發地, 目的地) 的 D1 快取 → (`TPE`, 目的地) 的 D1 快取；**兩者都沒有就沒有基準價，該票價不顯示任何 Deal Signal（`discountPct` 為 0、標記為 `normal`），絕不以猜測價計算折扣**（靜態 `baselineTwd` 只用於精選參考票價 fallback 看板，收錄的真實票價不再使用）。**Baseline 補抓**：每日同步在評分前，針對本次**看板上的航線**（通過收錄條件後的出發地 × 目的地，含尚未通過 `TSA` 門檻者）中沒有有效 Baseline 的航線，用 `SERPAPI_KEY_BASELINE` 送出最多 8 次 `google_flights` 查詢；從未有過 Baseline 的航線優先於已過期者，同組內 `TPE` 優先。一筆 Baseline 有效 30 天，過期後重抓（約 160 條航線每月約 160 次查詢）；本次補抓到的 Baseline 立即用於**同一次**評分。沒有 Baseline 金鑰、金鑰被拒，或單一查詢失敗／沒有區間的回應，都不寫入、不影響其他航線，下次再試。種子與刷新工具：`pnpm --filter @split/worker seed-baselines`（56 條核心航線，使用 `SERPAPI_KEY_BASELINE`，`--dry-run` / `--remote`）。

  寫入與可用性：只要本次有任何查詢獲得 SerpApi 回應，就在**單一原子 D1 批次**內清空 `daily_flights`、寫入今日票價與 `daily_flights_runs` 完成標記（即使沒有任何票價通過，也是真實的空看板，`GET /flights/daily` 回傳 `items: []`、`isFallback: false`）；只有部分角色（例如長程金鑰被拒）獲得回應時，仍整批取代看板，被略過角色的票價當天不出現（不沿用前一天）；若沒有任何查詢獲得回應（兩把 Explore 金鑰皆未設定或被拒、上游故障）則完全不寫入，沿用上一批票價直到滿 48 小時（以最新一批票價的 `created_at` 與標記的 `completed_at` 判斷，手動同步亦同），超過 48 小時一律視為資料不可用，回傳精選參考票價 (`isFallback: true`)。票價分塊寫入 `daily_flights`（每次最多 5 列以符合 D1 綁定參數上限）。任一外部航班來源失敗時記錄錯誤，不中斷其餘維護步驟。`GET /flights/daily` 於公開邊界再次套用同一個出發窗口（明天至 6 個月），無論資料來自 D1 或精選參考票價 fallback，快取票在跨日後若已成為今天或超出窗口一律不回傳。

* **M-1 過期資料**：清除已過期的登入狀態、過期的連結碼與舊的限流計數。
* **M-2 舊預留**：超過 24 小時仍為「待處理」的群組預留，只有在群組帳本（權威來源）回覆該使用者不是有效成員時才刪除。
  - 回 204（仍在群組）：保留並改為「已生效」，避免同步延遲的列長期占據清理名額。
  - 帳本無法回答（錯誤或逾時 5 秒）：保留，留待下次。
  - 每次最多檢查 100 筆，由舊到新；任何一筆失敗都不得中斷整個每日排程。
  - 理由：誤刪仍有效的預留，會讓之後的帳號刪除略過該群組的凍結與匿名化，也會少算群組上限。

---

## 6. 前端規格與畫面校準 (Frontend & Screen Specs)

* **導覽結構**：
  - 手機端：底部五標籤（首頁、`機票 /flights`、＋記一筆、統計、設定）。「機票」採用與首頁／統計／設定一致的 `currentColor` 圓潤線條＋選中半透明填色雙態圖示（`CuteFlightsIcon`），並於圖示右上角標示輕柔 `BETA` 迷你膠囊（不撐高導覽列）；點擊切換至 `/flights` 每日便宜航班看板。
  - 桌面端：響應式左側欄雙欄佈局（共用相同路由與狀態，側欄顯示「小芽 / Sprout」品牌與 `機票 /flights` 導覽連結及右側 `BETA` 膠囊）。
  - 登入後首頁呈現：無任何群組時（`groups.length === 0`）顯示「快速開始」兩張卡片（左卡「快速分帳」、右卡「今日低價機票」搭配小芽登機證徽章 `CuteTripPlaneIcon` 與 `BETA` 膠囊，不含「連假」字樣）並於下方搭配「今日低價機票跑馬燈」；**一旦建立或加入群組（`groups.length > 0`），自動隱藏「快速開始」兩張重複卡片，改於「待結算的群組」下方直接顯示「今日低價機票跑馬燈」**（標題旁僅呈現 `BETA` 與右側「全部機票 ›」連結，下方常駐顯示每日 `08:00` 台灣時間更新說明—fallback 時附帶精選參考票價提示—展示前 8 筆高折扣精選航線，包含 SVG 國旗、橘色路線膠囊（與城市卡片相同的單一橘色）、`NT$` 強化票價與精巧 `省 X%`，支援滑鼠懸停／聚焦暫停、符合 `prefers-reduced-motion` 時隱藏複本並退回單次靜態橫滑，點擊直達比價頁（磚與 `/flights` 共用同一個 `FlightBookAnchor`，LINE 內外行為一致）或前往 `/flights`）。建立群組表單專注於分帳群組建立，並移除介面上的「保養中」紅色標籤與 `旅遊 (保養中)` 選項。
* **每日便宜航班看板 (`/flights`)**：
  - 權限：支援**未登入訪客**與**已登入使用者**存取。已登入者包覆於 `AppShell` 內；未登入者的頂部列為 v3 **兩排**看板頁首（見下「頂部區塊」）：第一排為 40px 小芽吉祥物（回首頁）與看板標題 `今天想飛去哪？` 加 `BETA`；第二排左為更新說明，右為 `EN` 白底細框膠囊與綠色實心「登入」膠囊（外觀高 40px、觸控 ≥ 44px）；不再有地球圖示、墨黑登入鈕或另外的標題卡片。
  - 頂部區塊（薄荷底 `#F3FAF6`；看板字型僅 Noto Sans TC 400／500／700／800／900，首頁跑馬燈除外）：**共用看板標題區塊**（`FlightsTitle`，於已登入 `/flights`、未登入 `/flights` 與登陸頁看板共用）：單行不折行的 800 字重標題 `今天想飛去哪？`（約 26px；登陸頁看板為 22px），其中 `去哪` 以柔薄荷螢光筆底線標示（`linear-gradient(transparent 60%, #D3EBDF 60%)`），緊貼標題右側為琥珀色實心 `BETA` 膠囊（`#FEF3C7` 底、`#92400E` 字、10px／700、字距 `.06em`）；英文標題為 `Where to fly today?`（`fly` 標示，22px，窄螢幕可折行）。更新說明為 `● 每天 08:00 更新`（8px 綠點加 3px 淡綠外圈，13px 灰字；英文 `Updated daily at 8 AM`）。**未登入 `/flights` 的頁首**為兩排：第一排為 40px 小芽吉祥物（連回 `/`）、標題與 `BETA`；第二排左為更新說明，右為 `EN`（白底、1.5px 細框膠囊）與 `登入`（綠色實心膠囊、白色粗體字、柔綠陰影）；兩者外觀高 40px，並以偽元素擴增為 ≥ 44px 點擊區。**已登入 `/flights`** 沿用 AppShell 導覽，僅顯示標題列與更新說明列（無吉祥物、`EN`、`登入`）。**頁面頂部沒有地區頁籤**（目的地區域改在篩選抽屜內選擇，見下）。**沒有來回／單程切換**：每日航班只顯示來回票（ADR 0013），頁面上不再有 `來回 ｜ 單程` 分段控制或單程空狀態。第 1 排左側為 `{N} 筆` / `{N} fares`（`N` 為目前顯示的**票價筆數**，非城市數；沒有任何排序按鈕），右側為白底 1.5px `#A9D6C1` 細框 `篩選` 按鈕（綠色 700 字、篩選圖示；點擊區 ≥ 44px；任一抽屜篩選啟用時顯示綠色**啟用篩選數**徽章，計入出發地、目的地區域、出發月份、航空公司、直飛／轉機、預算）。城市卡片一律依各卡**最低價票價由低到高**排序（同價者折扣高者在前），每張卡以其最低價票價領頭（卡上折扣標記沿用該票價的折扣）；展開後各列同樣依價格由低到高；介面沒有排序控制，文案不出現「降幅」。點開 Radix `Dialog` 篩選抽屜為**底部抽屜**（手機 `< 768px`：`#F3FAF6` 底、`28px 28px 0 0` 圓角、頂部 44×5 拖曳橫條、標題 `篩選條件` 18px／900 加 44px 圓形關閉鈕、遮罩 `rgba(15,23,42,.45)`；以 `.dialog-sheet` `max-h-[82dvh]` 由底部滑入／滑出，內容區採 `min-h-0 flex-1` 捲動且頂／底部保留 `shrink-0` 與安全底邊距確保操作鈕不被手機底部導覽列裁切；桌機維持置中縮放進場），選項為膠囊（`min-h-10`、14px；選中為 1.5px 綠框、`#ECFDF5` 底、綠色 700 字，未選為白底 `#DFE9E4` 框）並於選項旁顯示**即時動態筆數**，群組依序為：出發地（`全部` 加上**看板上實際有票價的出發地**，依序為 `桃園 TPE` / `松山 TSA` / `高雄 KHH`；由票價資料動態產生，沒有票價的出發地不顯示）、**目的地區域**（單選，緊接在出發地之下：`全部` / `日本` / `韓國` / `中港澳` / `東南亞` / `歐洲` / `美加` / `大洋洲` / `中東`，英文 `All` / `Japan` / `Korea` / `HK / Macau / China` / `SE Asia` / `Europe` / `North America` / `Oceania` / `Middle East`；區域依目的地所屬國家在網頁端推得：日本、韓國、`中港澳` 為香港、澳門與中國大陸、`東南亞` 為泰國／新加坡／馬來西亞／越南／菲律賓／印尼、`歐洲`、`美加` 為美國與加拿大、`大洋洲`（原 `紐澳`）為澳洲、紐西蘭、關島、帛琉與北馬里亞納群島（塞班）、`中東` 為土耳其、阿聯、卡達、埃及與約旦；未對應區域的國家（如墨西哥的坎昆與墨西哥城）只在 `全部` 下可見；每顆晶片的筆數會套用其他所有已選篩選；再點一次已選區域即清除；不再提供國家、長程地區或目的地城市篩選）、出發月份（依現有航班動態列出 `N月`）、直飛／轉機三態（`不指定` / `只看直飛` / `需轉機`；`需轉機` 為該票價的轉機次數大於 0）、航空公司（依現有航班動態列出中文／英文航司名稱；多航司票價的**每一家**航司都各自成為選項，選任一家即顯示含該航司的票價）、預算上限（`不限` / `$5,000 以下` / `$10,000 以下`）；不提供連假篩選與紅眼篩選。底部左為 `重設`（白底、1.5px `#CBD5E1` 細框），右為滿版綠色實心主按鈕（50px 高、柔綠陰影），即時預告符合筆數（「`查看 N 筆機票`」）。
  - **每個目的地一張城市卡片**（以**城市**為單位（同城多機場合併為一張卡，如東京成田 `NRT` 與東京羽田 `HND` 同在「東京」卡，大阪關西 `KIX` 為「大阪」；卡片標題只顯示城市名，如 `東京` / `Tokyo`，不含機場名，機場由路線膠囊顯示）；手機 `grid-cols-1`、桌機 `md:grid-cols-2`，卡片間距 12px，外層與清單項具 `min-w-0`）：先依抽屜篩選（含目的地區域）取得來回票價，再依目的地分組並依最低價由低到高排列。卡片為白底、`#E6EFEA` 1px 框、22px 圓角、16px 內距與柔陰影；整個標頭是展開切換鈕（`aria-expanded` / `aria-controls`）。收合卡片左側為 26 國圓形 SVG 國旗（`44px`，1.5px `#DFE9E4` 外圈）；第 1 行為城市名（`17px`、700）與緊貼其右的**路線膠囊**（`12px`、700、字距 `.04em`、全圓角，如 `TPE ⇄ OKA`），所有地區、所有版面（城市卡片、展開標頭、首頁跑馬燈磚、登陸頁看板）**統一為單一橘色**：底 `#FFEDD5`、字 `#9A3412`（空間不足時城市名先以省略號截斷，膠囊維持完整並換行，價格欄位固定、不被擠壓或重疊）。第 2 行為航空公司（多航司以 ` + ` 連接並本地化，如 `捷星航空 + 樂桃航空` / `Jetstar + Peach`；`13px`、500、暖炭灰 `#44403C`；僅在名稱單獨已超過整欄寬度時才以省略號截斷）與暖灰小膠囊 `N 筆`（該城市票價筆數，`11px`／600；無分隔點，航空公司名稱過長時膠囊換到下一行而不擠壓名稱）。右側為 `NT$`（`12px` 灰色小字）與無襯線價格（`26px`、行高 `30px`、700），其下為折扣標記（`11px`）。**收合卡片不顯示直飛與否或任何日期，也不顯示展開箭頭**（以 `aria-expanded` 與 `N 筆` 提示可展開）；路線、航司、價格與標記皆取自該城市**最低價的那一筆票價**。點擊卡片展開、再點收合；展開後卡片框變為 `#C4E3D3` 並帶綠調陰影，標頭第 2 行改為純灰字 `航空公司 · 直飛 · N 筆`（非直飛為 `轉 N`），最右為 28px 圓形上箭頭。展開區依價格由低到高列出該城市**前 5 筆**票價，列間為 1.5px 虛線，最便宜一列以淡綠底（`#ECFDF5`）強調；超過 5 筆時底部顯示綠色 700 字 `看全部 N 筆` 按鈕（`N` 為該城市票價總數，點擊展開全部、再點顯示 `收合`；≤ 5 筆不顯示）。每列為一個外連連結（`14px 16px` 內距）：第 1 行為日期（`15px`、700）加小日曆圖示，不含年份、不重複路線膠囊，一律為 `MM/DD–MM/DD`（零補位、en dash、無空格；如 `12/09–12/12`、跨月 `12/28–01/03`），當日來回只顯示 `MM/DD`（中英文相同）；第 2 行（`13px` 灰字，可換行、不截斷）為 `<出發地>出發`（每列皆顯示，如 `高雄出發`）· 航司（多航司同為 ` + ` 連接）· `直飛`（綠色粗體）或 `轉 N`（琥珀色粗體，N 為該票價的轉機次數），分隔點為 `#A8A29E` 裝飾點；右側為 `NT$` 票價（`16px`、700）、較小的折扣標記（11px，規則同下）與 28px 圓形外連圖示，連到 `/api/v1/flights/go?...&lang=<zh-TW|en>`（Trip.com 轉址；於 LINE 內點擊時，在點擊處理中同步把最終的 Trip.com 網址（`tw.trip.com`／`www.trip.com`，帶 `GET /flights/daily` 回傳的聯盟參數，由共用網址組裝器產生）直接交給 `line.openExternal`，不經 `/api/v1/flights/go`、不做非同步請求，以免丟失使用者手勢（唯一例外：每日資料尚未載入或改用精選參考清單、拿不到聯盟參數時，改把以頁面來源解析出的**絕對** `/api/v1/flights/go?...` 網址交給 `line.openExternal`，由該轉址補上聯盟參數，避免佣金遺失）；是否喚起 Trip.com App 由手機作業系統決定，於真機另行檢查，ADR 0015）。展開區底部為小字說明列（`11px`、虛線上框、薄荷底）：`點日期前往 Trip.com · 折扣是與此航線的典型高價相比，結帳價格以訂票頁為準`（英文 `Tap a date to open Trip.com · Discounts compare against this route's typical high price; checkout prices follow the booking page`），明確說明折扣基準為航線的典型高價（`typicalHighTwd`），實際結帳價依訂票頁。城市名一律為純城市名（如 `沖繩`、`東京`、`大阪`），首頁跑馬燈與登陸頁亦同，機場代碼僅出現在路線膠囊。折扣標記（固定門檻、不隨篩選重算，卡片、展開列與首頁跑馬燈磚規則一致）：折扣 **≥50%** 為綠色實心膠囊，內含**綠色火焰圖示**（lucide `Flame`，置於膠囊內的白色小圓底上以維持對比）與白字 700 `省 X%`（英文 `Save X%`）；**15–49%** 為綠色半粗體純文字 `省 X%`（無圖示）；**< 15%**（含 0%）不顯示任何標記。出發地等篩選同時縮減卡片與展開後的列；某城市無符合票價時整張卡片隱藏。無任何票價符合時顯示空狀態（小芽插圖、`目前沒有符合條件的低價機票`、`重設篩選` 鈕）；切換篩選時 `<li>` 以目的地為 key 保持穩定；按鈕／卡片按壓（`.press-*`）採 GPU compositor `transform` 與 `100ms` 壓下／`220ms` 回彈；`prefers-reduced-motion: reduce` 下維持柔和 `120ms` 透明度淡入淡出並停用迴圈動畫與縮放旋轉（首屏 JS 嚴格維持 `<= 200.0 KB` gzipped 上限）。頁面底部顯示資料日期一行 `MM/DD 更新`，其下一行小字 `價格僅供參考，實際以訂票頁為準`（英文 `Prices are for reference; the booking page shows the final price`）（英文 `Updated MM/DD`；`isFallback` 為真時顯示 `參考票價 · MM/DD 更新` / `Sample fares · Updated MM/DD`，依 ADR 0007 揭露精選參考價），除此之外不再有其他說明或免責文字。英文計數使用單複數（`1 fare` / `2 fares`、`1 stop` / `2 stops`）。首頁登陸頁看板重用同一張城市卡片（價格由低到高取前 4 個城市、同樣的 Deal Signal 標記規則；一律為來回票），跑馬燈使用單筆票價精簡磚（寬 200px、白底、圓角 16px：國旗 28px 加城市名、襯線價格 28px，底列左為路線膠囊、右為折扣：≥50% 為含綠色火焰的綠色實心膠囊、15–49% 為綠色純文字、< 15% 不顯示，規則同上）。
* **UI 原語**：Tailwind CSS v4 + Radix UI (Dialog、Sheet、Select、Popover；所有對話框含 `DeleteGroupDialog`、`ConfirmSettlementDialog`、`InviteSection` QR 窗、`MembersPage` 改名／確認窗、`SignInPage` 提醒窗、`SettingsPage` 刪除確認與機票篩選抽屜皆共用 `.dialog-overlay` + `.dialog-content`，手機底部抽屜並套用 `.dialog-sheet` `280ms` / `180ms` 垂直滑入／滑出轉場)。
* **首頁呈現**：目前淨收付以使用者的偏好幣別顯示為單一數字；其他幣別依當日最新參考匯率換算後加總（僅供參考，見 ADR 0002）。取不到匯率時退回依幣別並列。群組列與結算畫面一律維持各群組的結算幣別，不換算。「待結算的群組」標題右側提供「我的群組 ›」文字連結，直接前往 `/groups`。
* **新增開銷表單**：
  - 標籤頁：僅保留「花費」與「轉帳」兩大頁籤（排除「收入」）。
  - 金額輸入框內建安全算式解析器（支援 `+`、`-`、`*`、`/`，防禦 `eval`）。
  - 幣別選單提供 `TWD`、`USD`、`JPY`、`THB`。
* **靜態登陸頁 (`/`)**：未登入訪客訪問根路徑 `/` 時載入清透薄荷晴空漸層雙核心形象首頁——頂部導覽列僅留品牌 `小芽`、語言切換與**全頁唯一**的「登入」入口（移除重複的「低價機票」鈕）；Hero 標題採一般無襯線 `font-black`（不用襯線字型，中英一致，390px 至多兩行）；Hero 區塊採手機 `grid-cols-1` 搭配子容器 `min-w-0` 防窄螢幕溢出，左側精簡為大標題、2 步視覺流程條（「挑台灣低價機票 → 回小芽一鍵分帳」）與單一主 CTA「逛完整機票看板」，右側呈現互動式「即時浮動特價機票看板」（共用看板標題區塊、4 張與 `/flights` 相同的城市卡片，看板底部顯示 `MM/DD 更新` 與「查看更多精選航線 →」入口；頁尾僅保留服務條款與隱私權政策連結，不再有標語）與分帳收據預覽卡片，移除冗餘特色卡片區以保持畫面簡潔；登入後自動轉跳進入 App 首頁。

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
