/**
 * Plain constants the web app needs at startup. They live apart from the schemas on purpose:
 * importing a constant from a module that also builds Zod schemas keeps Zod in the first-load
 * JavaScript (see the 200 KB budget in apps/web/scripts/check-bundle-size.ts).
 */

/** Shown in place of a deleted User's name on the Member rows they leave behind. */
export const DELETED_USER_NAME = "已刪除的使用者";

/** Shown for a removed Placeholder Member that old Expenses still name; the typed name is gone. */
export const REMOVED_PLACEHOLDER_NAME = "已移除的成員";

/** The interface languages: Traditional Chinese (the default) and English. */
export const LANGUAGES = ["zh-TW", "en"] as const;
export type Language = (typeof LANGUAGES)[number];
