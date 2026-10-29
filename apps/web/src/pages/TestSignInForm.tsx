import type { Provider } from "@split/shared";
import { type SubmitEvent, useState } from "react";
import { useAuth } from "../auth/AuthProvider.js";
import { t } from "../i18n/messages.js";

/**
 * Dev and browser-test sign-in (SPEC §7.3). Only bundled where the build enables it;
 * the Worker route answers 404 unless TEST_SIGN_IN=1.
 */
export function TestSignInForm() {
  const { testSignIn } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [provider, setProvider] = useState<Provider>("google");

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = displayName.trim();
    if (name === "") return;
    void testSignIn({ provider, sub: `dev-${provider}-${name}`, displayName: name });
  }

  return (
    <form
      onSubmit={submit}
      aria-label={t("signIn.test.title")}
      className="mt-6 flex flex-col gap-3 rounded-2xl border border-dashed border-sprout-200 p-4"
    >
      <p className="text-sm font-bold">{t("signIn.test.title")}</p>
      <label className="flex flex-col gap-1 text-sm">
        {t("signIn.test.name")}
        <input
          value={displayName}
          onChange={(event) => {
            setDisplayName(event.target.value);
          }}
          maxLength={50}
          required
          className="rounded-xl border border-sprout-200 bg-white px-3 py-2 text-base"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t("signIn.test.provider")}
        <select
          value={provider}
          onChange={(event) => {
            setProvider(event.target.value === "line" ? "line" : "google");
          }}
          className="rounded-xl border border-sprout-200 bg-white px-3 py-2 text-base"
        >
          <option value="google">Google</option>
          <option value="line">LINE</option>
        </select>
      </label>
      <button type="submit" className="rounded-full bg-ink py-2.5 font-bold text-white">
        {t("signIn.test.submit")}
      </button>
    </form>
  );
}
