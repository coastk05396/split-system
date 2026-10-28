import type { ErrorCode } from "../api/errors.js";

/**
 * Every zh-TW string in the SPA, keyed by ID (decision 20). Adding a language later
 * means adding a second catalog of the same type; there is no i18n library in v1.
 */
const zhTW = {
  "app.name": "小芽分帳",
  "app.loading": "載入中…",

  "nav.bottom": "底部導覽",
  "nav.side": "側邊導覽",
  "nav.home": "首頁",
  "nav.groups": "群組",
  "nav.new": "新增",
  "nav.newExpense": "新增一筆",
  "nav.stats": "統計",
  "nav.settings": "設定",

  "landing.eyebrow": "小芽陪你分帳",
  "landing.title": "一筆快分，一趟好玩。",
  "landing.body": "聚餐開銷，幾秒就分好。旅行時，先把每天行程排好，費用順手一起記。",
  "landing.signIn": "登入開始使用",
  "landing.headerSignIn": "登入",
  "landing.providers": "使用 LINE 或 Google 帳號登入，不需另外註冊",
  "landing.feature1.title": "聚餐快分",
  "landing.feature1.body": "選人、輸入金額，均分或自訂金額都可以。",
  "landing.feature2.title": "旅行好記",
  "landing.feature2.body": "每天的行程和開銷放在一起，同行的人都看得到。",
  "landing.feature3.title": "結算不尷尬",
  "landing.feature3.body": "算出最少筆數的還款方式，收款人確認後就結清。",
  "landing.footer": "小芽分帳只記錄誰欠誰，不經手任何款項。",

  "signIn.title": "小芽分帳，友情不扣分。",
  "signIn.body": "記帳、均分、結算，一群人的開銷都能輕鬆搞定。",
  "signIn.line": "使用 LINE 快速登入",
  "signIn.lineAuto": "正在透過 LINE 登入…",
  "signIn.googleLoading": "正在載入 Google 登入…",
  "signIn.dataSummary1": "我們只取得你在 LINE 或 Google 的名稱與頭像，",
  "signIn.dataSummary2": "用來讓群組成員認出你；不會取得 Email 或密碼。",
  "signIn.consentBefore": "繼續即表示同意",
  "signIn.terms": "服務條款",
  "signIn.consentJoin": "與",
  "signIn.privacy": "隱私權政策",
  "signIn.test.title": "測試登入（僅限本機）",
  "signIn.test.name": "顯示名稱",
  "signIn.test.provider": "身分來源",
  "signIn.test.submit": "測試登入",

  "home.greeting": "{name}，今天想怎麼分？",
  "home.subtitle": "聚餐快分、旅行慢慢記，都在同一個小芽。",

  "groups.title": "群組",
  "new.title": "新增一筆",
  "stats.title": "統計",
  "settings.title": "設定",
  "settings.signOut": "登出",
  "page.comingSoon": "這個頁面還在準備中。",
  "notFound.title": "找不到這個頁面",
  "notFound.home": "回到首頁",
} as const;

export type MessageId = keyof typeof zhTW;
type Catalog = Record<MessageId, string>;

const catalog: Catalog = zhTW;

/** Looks up a message and fills `{name}` placeholders. */
export function t(id: MessageId, params: Readonly<Record<string, string | number>> = {}): string {
  return catalog[id].replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match,
  );
}

const errorMessages: Record<ErrorCode, string> = {
  VALIDATION_FAILED: "有欄位填寫不正確，請檢查後再試一次。",
  IDEMPOTENCY_KEY_REQUIRED: "請重新送出一次。",
  IF_MATCH_REQUIRED: "請重新整理後再修改。",
  UNAUTHORIZED: "登入已過期，請重新登入。",
  ID_TOKEN_INVALID: "登入沒有成功，請再試一次。",
  FORBIDDEN: "你沒有權限進行這個操作。",
  NOT_FOUND: "找不到這筆資料。",
  EDIT_CONFLICT: "這筆資料剛被其他人修改過，請重新整理。",
  GROUP_FULL: "這個群組已經滿 30 人了。",
  BALANCE_NOT_ZERO: "還有款項沒結清，結清後才能進行。",
  IDENTITY_LINKED_ELSEWHERE: "這個帳號已經是另一個小芽帳號。",
  PROVIDER_ALREADY_LINKED: "你已經連結過這種帳號了。",
  LAST_IDENTITY: "至少要保留一種登入方式。",
  LAST_ADMIN: "群組至少要有一位管理員。",
  TRIP_MODULE_OFF: "這個群組沒有開啟旅行模式。",
  STOP_LIMIT_REACHED: "這一天最多只能排 50 站。",
  INVITE_EXPIRED: "這個邀請連結已經過期了。",
  EXPENSE_AMOUNT_INVALID: "金額需介於 1 到 99,999,999 之間。",
  RATE_LIMITED: "操作太頻繁了，請稍後再試。",
  INTERNAL: "小芽出了點狀況，請稍後再試。",
};

/** The message for an API error code. */
export function errorMessage(code: ErrorCode): string {
  return errorMessages[code];
}
