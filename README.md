# 小芽分帳 (Split System)

Cross-platform web application for group expense tracking, running tabs, and trip planning, built on Cloudflare edge serverless and React.

---

## Prerequisites

- **Node.js**: `>= 22.12.0` (see `.nvmrc`)
- **pnpm**: `>= 10.18.3`

---

## Quick Start (Local Development)

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Start Everything

```bash
pnpm dev
```

This one command:

- creates `apps/worker/.dev.vars` from `.dev.vars.example` if it is missing (a dev-only session signing key, plus `TEST_SIGN_IN=1` for the local test sign-in),
- applies pending migrations to the local D1 database and starts the Worker API on port `8787`,
- starts the Vite frontend on port `5173`, which proxies `/api` to `8787`.

Open your browser at:
👉 **[http://localhost:5173](http://localhost:5173)**

On the sign-in page, use the **測試登入（僅限本機）** form: type any display name and press 測試登入. Stop both servers with `Ctrl+C`.

> Open `5173`, not `8787`: the Worker port only serves the API. If the sign-in shows "找不到這筆資料", `apps/worker/.dev.vars` is missing or was added while the Worker was running — restart `pnpm dev`.

To open it on a phone on the same Wi-Fi, use the `Network:` address that `pnpm dev` prints for Vite (for example `http://192.168.68.55:5173`). Only `5173` is needed: the phone never talks to `8787` directly. On WSL2 with `networkingMode=mirrored`, Windows may block the incoming connection; if the phone times out, run this once in an administrator PowerShell:

```powershell
Set-NetFirewallHyperVVMSetting -Name '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}' -DefaultInboundAction Allow
```

> **After the database changes** (a new currency or a new setting on a not-yet-released migration), the old local database no longer matches. Stop `pnpm dev`, delete the local state with `rm -rf apps/worker/.wrangler/state`, and start it again; the migrations recreate it. Your local test groups are lost, which is fine for development.

To run the two servers separately (for example in two terminals):

```bash
pnpm --filter @split/worker dev
pnpm --filter @split/web dev
```

---

## Testing & Quality Checks

Run all verification suites locally before committing:

### Unit & Integration Tests

Runs Vitest tests across all packages:

```bash
pnpm test
```

Or for a specific package:

```bash
pnpm --filter @split/shared test
pnpm --filter @split/worker test
pnpm --filter @split/web test
```

### Type Checking

```bash
pnpm typecheck
```

### Linting & Formatting

```bash
pnpm lint
pnpm format:check
```

Auto-format files:

```bash
pnpm format
```

### End-to-End (E2E) Tests

Runs the full Playwright suite against local Worker instances (verifying the golden path and production safety checks):

```bash
pnpm e2e
```

---

## Project Structure

```text
├── apps/
│   ├── web/          # React 19 SPA, Tailwind CSS v4, Vite, Radix UI primitives
│   └── worker/       # Cloudflare Worker, Hono API, D1 (Drizzle ORM), LINE webhook
├── packages/
│   └── shared/       # Shared money core, debt simplification & payment plan engine
├── e2e/              # Playwright E2E test suites
└── docs/             # Product specifications, wayfinder decision records & release checklist
```

---

## 系統架構與設計圖 (System Design & Architecture)

### 1. 前後端系統架構圖 (System Architecture)

展示 React SPA、LINE 平台（LIFF／Messaging API）、Cloudflare Worker（Hono API）、GroupLedger Durable Object（每個群組一個，群組帳務的權威與 `/live` WebSocket）、D1（帳號、Session 與讀取模型）、KV 金鑰快取及外部 API 之間的呼叫關係：

![前後端系統架構圖](docs/diagrams/architecture.svg)

D1 保留帳號、FX rates 與查詢投影；群組帳務的權威狀態只存在 GroupLedger。Worker 透過 KV 快取 Google 與 LINE 的公開簽章金鑰，FX 匯率則以 Frankfurter 為主、ExchangeRate-API 為備援。

> 💡 [開啟互動式向量頁面](docs/diagrams/architecture.html)

---

### 2. Google + LINE 登入流程時序圖 (Authentication Sequence)

展示 Google 或 LINE ID token 的共用登入路徑：Worker 以 KV 快取的供應商公開金鑰驗證 token（快取未命中或找不到 `kid` 時重新下載），在 D1 建立或沿用 User／Identity 並新增 Session，最後回傳 access token 與 HttpOnly refresh cookie：

![Google 與 LINE 登入流程時序圖](docs/diagrams/line-auth-sequence.svg)

> 💡 [開啟登入流程向量頁面](docs/diagrams/line-auth-sequence.html)

---

### 3. D1 帳號資料庫結構 (D1 Account Schema)

展示 D1 帳號／驗證子系統的五張資料表（`users`、`identities`、`sessions`、`link_codes`、`rate_counters`）之選定欄位、SQL 型態、主鍵與 `ON DELETE CASCADE` 外鍵。這不是完整 D1 schema；群組帳務權威資料存放在 GroupLedger Durable Object：

![D1 資料庫實體關聯圖](docs/diagrams/db-schema-er.svg)

> 💡 [開啟 D1 schema 向量頁面](docs/diagrams/db-schema-er.html)
