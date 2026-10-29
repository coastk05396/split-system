import { LANGUAGES, type Language } from "@split/shared";

const KEY = "split.language";

/** The language to start in: the last one used here, else the browser's, else Chinese. */
export function detectLocale(): Language {
  try {
    const stored = localStorage.getItem(KEY);
    const known = LANGUAGES.find((l) => l === stored);
    if (known !== undefined) return known;
  } catch {
    // Storage can be blocked; fall through to the browser's language.
  }
  const browser = navigator.languages[0] ?? navigator.language;
  return browser.toLowerCase().startsWith("zh") ? "zh-TW" : "en";
}

/** Remembers the language on this device, so the sign-in page speaks it before sign-in. */
export function rememberLocale(language: Language): void {
  try {
    localStorage.setItem(KEY, language);
  } catch {
    // Not remembering is fine.
  }
}
