/// <reference types="vite/client" />

/** Public build-time settings; see apps/web/.env.example. None of them is a secret. */
interface ImportMetaEnv {
  /** LIFF app ID for split.rickchen.si; unset locally, which turns LINE sign-in off. */
  readonly VITE_LIFF_ID?: string;
  /** Google OAuth client ID; unset locally, which hides the Google button. */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  /** "1" keeps the test sign-in form in a production build (browser tests only). */
  readonly VITE_TEST_SIGN_IN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
