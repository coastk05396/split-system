import { LogOut } from "lucide-react";
import { useNavigate } from "react-router";
import { useAuth } from "../auth/AuthProvider.js";
import { t } from "../i18n/messages.js";
import { PlaceholderPage } from "./PlaceholderPage.js";

/** Screen 11 lands with the account ticket; sign-out is here so the shell is usable. */
export function SettingsPage() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  return (
    <PlaceholderPage title="settings.title">
      <button
        type="button"
        onClick={() => {
          void navigate("/", { replace: true });
          void signOut();
        }}
        className="mt-6 inline-flex items-center gap-2 rounded-full border border-sprout-200 bg-white px-5 py-3 font-bold"
      >
        <LogOut aria-hidden="true" className="size-5" />
        {t("settings.signOut")}
      </button>
    </PlaceholderPage>
  );
}
