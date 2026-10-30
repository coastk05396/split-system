import * as Dialog from "@radix-ui/react-dialog";
import type { Group } from "@split/shared";
import { ArrowUpRight, Share2, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useRef, useState } from "react";
import { useEnsureInvite } from "../groups/api.js";
import { ShareButtons } from "../groups/ShareButtons.js";
import { failureMessage, primaryButton } from "../groups/ui.js";
import { t } from "../i18n/messages.js";

/** Share actions at the end of the combined Members and Invite page. */
export function InviteSection({ group }: { group: Group }) {
  const ensure = useEnsureInvite(group.id);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const current = ensure.data ?? null;
  const url = current === null ? null : `${window.location.origin}/join/${current.token}`;
  const message = url === null ? "" : t("invite.shareMessage", { name: group.name, url });

  return (
    <section
      aria-labelledby="invite-share-heading"
      className="rounded-[2rem] border border-sprout-200 bg-sprout-150 p-5 md:p-6"
    >
      <div className="flex items-start gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-white text-sprout-700 shadow-sm">
          <Share2 aria-hidden="true" className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 id="invite-share-heading" className="text-lg font-bold text-sprout-900">
            {t("invite.shareGroup")}
          </h2>
        </div>
      </div>
      {ensure.isError && (
        <p role="alert" className="mt-4 text-sm text-red-700">
          {failureMessage(ensure.error)}
        </p>
      )}
      <button
        type="button"
        ref={triggerRef}
        disabled={ensure.isPending}
        onClick={() => {
          void ensure
            .mutateAsync()
            .then(() => {
              setOpen(true);
            })
            .catch(() => {});
        }}
        className={`${primaryButton} mt-5 w-full justify-between py-3.5`}
      >
        {t("invite.shareGroup")}
        <ArrowUpRight aria-hidden="true" className="size-5" />
      </button>
      {url !== null && (
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-30 bg-sprout-900/70" />
            <Dialog.Content
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                triggerRef.current?.focus();
              }}
              className="fixed top-1/2 left-1/2 z-40 max-h-[90dvh] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[2rem] bg-white p-6 shadow-2xl"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Dialog.Title className="text-xl font-bold text-sprout-900">
                    {t("invite.shareGroup")}
                  </Dialog.Title>
                  <Dialog.Description className="mt-1 text-sm text-ink-muted">
                    {t("invite.qrBody")}
                  </Dialog.Description>
                </div>
                <Dialog.Close
                  aria-label={t("invite.closeQr")}
                  className="press-icon -mr-2 rounded-full p-2.5 text-sprout-800 hover:bg-sprout-100"
                >
                  <X aria-hidden="true" className="size-6" />
                </Dialog.Close>
              </div>
              <div className="mt-6 flex justify-center rounded-2xl border border-sprout-200 bg-white p-4">
                <QRCodeSVG
                  value={url}
                  size={240}
                  level="M"
                  marginSize={4}
                  role="img"
                  aria-label={t("invite.qrAlt", { name: group.name })}
                  className="h-auto max-w-full"
                />
              </div>
              <p className="mt-3 text-center text-sm font-semibold text-sprout-900">{group.name}</p>
              <p className="mt-1 text-center text-xs text-ink-muted">{t("invite.qrHint")}</p>
              <div className="mt-6">
                <ShareButtons
                  invite
                  content={{
                    text: message,
                    url,
                    title: group.name,
                    telegramText: t("invite.shareTelegramText", { name: group.name }),
                    copyText: url,
                    copyLabel: t("invite.copy"),
                    copiedNotice: t("invite.copied"),
                  }}
                />
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </section>
  );
}
