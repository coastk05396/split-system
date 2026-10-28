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
  - 繁體中文介面 (`zh-TW`)。
  - 幣別支援：新台幣 (`TWD`，整數元) 與 美元 (`USD`，美分)。
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
  - 日文與泰文多語系（架構預留 i18n 鍵值，文案後續擴展）。
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
* 金額限制：每筆支出 1 至 99,999,999 單位。禁止負數支出。

### 3.2 確定性零頭分配規則 (Leftover Distribution)
三個人均分 100 元 (`100 = 33 * 3 + 1`)：
1. 每人先分 `floor(100 / 3) = 33`。
2. 餘數 `1` 元分配順序：**付款人（若有參與分攤）優先得 1 元**，其餘按成員加入固定順序分配，每人最多分 1 元。
3. 最終結果為 `34, 33, 33`。完全確定，無浮點誤差與隨機性。

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

-- 6. 群組邀請碼 (7天時效、可重設)
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
| | `POST /auth/logout-all` | 登出所有裝置 |
| | `POST /auth/link/:provider` | 綁定第二身分 |
| | `DELETE /auth/identities/:provider`| 解除第三方身分綁定 |
| | `GET /me` & `DELETE /me` | 查詢個人資料 / 刪除帳號 |
| **Groups** | `GET /groups` & `POST /groups` | 取得群組列表 / 建立群組 |
| | `GET, PATCH, DELETE /groups/:id` | 群組詳情 / 修改 / 刪除 |
| **Members**| `GET /groups/:id/members` | 成員列表與即時淨餘額快照 |
| | `PATCH /groups/:id/members/:mid` | 變更角色 (Admin/Member) 或設定暱稱 |
| | `DELETE /groups/:id/members/:mid`| 移除成員 (餘額需歸零) |
| | `POST /groups/:id/claim-placeholder`| 正式用戶認領虛擬成員 |
| **Invites**| `POST /groups/:id/invite` | 產生/重新產生 7 天邀請碼 |
| | `GET /invites/:token` | 邀請資訊預覽 (群組名稱、成員數) |
| | `POST /invites/:token/join` | 確認加入群組 |
| **Expenses**| `GET, POST /groups/:id/expenses` | 開銷列表 (遊標分頁 50 筆) / 新增支出 (`D1.batch()`) |
| | `GET, PATCH, DELETE /groups/:id/expenses/:eid` | 開銷明細 / 修改 / 刪除 |
| **Balances**| `GET /groups/:id/balances` | 取得群組全體成員餘額 |
| **Settlements**| `GET, POST /groups/:id/settlements`| 結算列表 / 發起「我已付款」(pending) 或確認付款 |
| | `POST /settlements/:sid/confirm` | 收款人確認結清 |
| | `POST /settlements/:sid/undo` | 撤銷結算 |
| **Stops** | `GET, POST /groups/:id/stops` | 查詢每日站點 / 新增站點 |
| | `PATCH, DELETE /groups/:id/stops/:sid` | 編輯站點 / 刪除站點 |
| **Rates** | `GET /rates?date&base&quote` | 查詢參考匯率 (D1 命中快取或調用 Frankfurter) |
| **LINE** | `POST /line/webhook` | 驗證簽章，被動回覆圖文引導與說明 |

---

## 6. 前端規格與畫面校準 (Frontend & Screen Specs)

* **導覽結構**：
  - 手機端：底部五標籤（首頁、群組、＋記一筆、統計、設定）。
  - 桌面端：響應式左側欄雙欄佈局（共用相同路由與狀態）。
* **UI 原語**：Tailwind CSS v4 + Radix UI (Dialog、Sheet、Select、Popover)。
* **首頁呈現**：待結算資產依幣別並列（例如「NT$ 293 · US$ 12.50」），嚴禁任意匯率加總。
* **新增開銷表單**：
  - 標籤頁：僅保留「花費」與「轉帳」兩大頁籤（排除「收入」）。
  - 金額輸入框內建安全算式解析器（支援 `+`、`-`、`*`、`/`，防禦 `eval`）。
  - 幣別選單僅提供 `TWD` 與 `USD`。
* **靜態登陸頁**：未登入訪客訪問根路徑 `/` 時載入簡潔形象頁，登入後自動轉跳進入 App。

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
