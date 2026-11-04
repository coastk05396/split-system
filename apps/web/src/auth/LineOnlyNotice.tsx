import * as Dialog from "@radix-ui/react-dialog";
import { t } from "../i18n/messages.js";
import { useAuth } from "./AuthProvider.js";

/**
 * Shown once when a Google session inside LINE was switched to LINE, or could not be because the
 * User has no LINE Identity. It can only be closed with its button.
 */
export function LineOnlyNotice() {
  const { state, dismissNotice } = useAuth();
  const notice = state.status === "signedIn" ? state.notice : undefined;
  const linked = notice === "switchedToLine";
  return (
    <Dialog.Root open={notice !== undefined}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay glass-overlay fixed inset-0 z-40" />
        <Dialog.Content
          role="alertdialog"
          onEscapeKeyDown={(event) => {
            event.preventDefault();
          }}
          onInteractOutside={(event) => {
            event.preventDefault();
          }}
          className="dialog-content glass-dialog fixed inset-x-0 bottom-0 z-50 flex flex-col gap-4 rounded-t-[2rem] border-t border-sprout-200/80 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-ink md:inset-x-4 md:top-1/2 md:bottom-auto md:mx-auto md:max-w-md md:-translate-y-1/2 md:rounded-3xl md:border md:p-6"
        >
          <Dialog.Title className="text-lg font-bold">
            {t(linked ? "lineOnly.switchedTitle" : "lineOnly.notLinkedTitle")}
          </Dialog.Title>
          <Dialog.Description className="text-sm text-ink-muted">
            {t(linked ? "lineOnly.switchedBody" : "lineOnly.notLinkedBody")}
          </Dialog.Description>
          <button
            type="button"
            onClick={dismissNotice}
            className="press-pill w-full rounded-full bg-sprout-600 py-3 font-bold text-white hover:bg-sprout-600/90"
          >
            {t("lineOnly.ok")}
          </button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
