import * as Dialog from "@radix-ui/react-dialog";
import type { Group } from "@split/shared";
import { ArrowUpRight, Check, Copy, MessageCircle, RefreshCw, Send, Share2, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useDeps } from "../app/AppProviders.js";
import { useInvite, useRegenerateInvite } from "../groups/api.js";
import { failureMessage, primaryButton } from "../groups/ui.js";
import { t } from "../i18n/messages.js";
import { LineShareUnavailableError } from "../platform/line.js";

const brandButton =
  "press-pill flex w-full items-center gap-3 rounded-full px-3 py-2.5 font-bold text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25)]";

function ShareChip({ children }: { children: ReactNode }) {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/90 text-sprout-800">
      {children}
    </span>
  );
}

/** Share actions at the end of the combined Members and Invite page. */
export function InviteSection({ group }: { group: Group }) {
  const { line } = useDeps();
  const invite = useInvite(group.id);
  const regenerate = useRegenerateInvite(group.id);
  const isAdmin = group.me.role === "admin";
  const insideLine = line.isInClient();
  const [notice, setNotice] = useState("");
  const [justCopied, setJustCopied] = useState(false);
  const askedFor = useRef<string | null>(null);

  useEffect(() => {
    if (
      !invite.isPending &&
      !invite.isError &&
      invite.data === null &&
      isAdmin &&
      askedFor.current !== group.id
    ) {
      askedFor.current = group.id;
      regenerate.mutate();
    }
  }, [group.id, invite.data, invite.isError, invite.isPending, isAdmin, regenerate]);

  const current = invite.data ?? null;
  const url = current === null ? null : `${window.location.origin}/join/${current.token}`;
  const message = url === null ? "" : t("invite.shareMessage", { name: group.name, url });

  async function copy() {
    if (url === null) return;
    try {
      await navigator.clipboard.writeText(url);
      setNotice(t("invite.copied"));
      setJustCopied(true);
    } catch {
      setNotice(failureMessage(null));
    }
  }

  async function share() {
    if (url === null) return;
    try {
      if (await line.share(message)) {
        setNotice(t("invite.shared"));
      }
    } catch (error) {
      setNotice(
        error instanceof LineShareUnavailableError
          ? t("invite.shareUnavailable")
          : failureMessage(null),
      );
    }
  }

  async function shareWith() {
    if (url === null) return;
    try {
      await navigator.share({ title: group.name, url });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setNotice(t("invite.shareOtherUnavailable"));
    }
  }

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
      {invite.isError ? (
        <p role="alert" className="mt-4 text-sm text-red-700">
          {failureMessage(invite.error)}
        </p>
      ) : url === null ? (
        <p className="mt-4 text-sm text-ink-muted">
          {regenerate.isError
            ? failureMessage(regenerate.error)
            : isAdmin
              ? t("app.loading")
              : t("invite.noneMember")}
        </p>
      ) : (
        <>
          <Dialog.Root>
            <Dialog.Trigger asChild>
              <button
                type="button"
                className={`${primaryButton} mt-5 w-full justify-between py-3.5`}
              >
                {t("invite.shareGroup")}
                <ArrowUpRight aria-hidden="true" className="size-5" />
              </button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-30 bg-sprout-900/70" />
              <Dialog.Content className="fixed top-1/2 left-1/2 z-40 max-h-[90dvh] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[2rem] bg-white p-6 shadow-2xl">
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
                <p className="mt-3 text-center text-sm font-semibold text-sprout-900">
                  {group.name}
                </p>
                <p className="mt-1 text-center text-xs text-ink-muted">{t("invite.qrHint")}</p>
                <div className="mt-6 flex flex-col gap-3">
                  {insideLine ? (
                    <button
                      type="button"
                      onClick={() => void share()}
                      className={`${brandButton} bg-line hover:bg-line/90`}
                    >
                      <ShareChip>
                        <MessageCircle aria-hidden="true" className="size-5" />
                      </ShareChip>
                      {t("invite.shareLine")}
                    </button>
                  ) : (
                    <a
                      href={`https://line.me/R/share?text=${encodeURIComponent(message)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`${brandButton} bg-line hover:bg-line/90`}
                    >
                      <ShareChip>
                        <MessageCircle aria-hidden="true" className="size-5" />
                      </ShareChip>
                      {t("invite.shareLine")}
                    </a>
                  )}
                  <a
                    href={`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(t("invite.shareTelegramText", { name: group.name }))}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${brandButton} bg-telegram hover:bg-telegram/90`}
                  >
                    <ShareChip>
                      <Send aria-hidden="true" className="size-5" />
                    </ShareChip>
                    {t("invite.shareTelegram")}
                  </a>
                  <button
                    type="button"
                    onClick={() => void copy()}
                    className="press-pill flex w-full items-center gap-3 rounded-full border border-sprout-200 px-3 py-2.5 font-bold text-sprout-800 hover:border-sprout-500"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sprout-150">
                      {justCopied ? (
                        <Check aria-hidden="true" className="size-5" />
                      ) : (
                        <Copy aria-hidden="true" className="size-5" />
                      )}
                    </span>
                    {t("invite.copy")}
                  </button>
                  {typeof navigator.share === "function" && (
                    <button
                      type="button"
                      onClick={() => void shareWith()}
                      className="press-pill min-h-11 self-center rounded-full px-4 text-sm font-bold text-sprout-700 hover:bg-sprout-150"
                    >
                      {t("invite.shareOther")}
                    </button>
                  )}
                </div>
                <p
                  role="status"
                  className={
                    notice === ""
                      ? "sr-only"
                      : "mt-4 text-center text-sm font-medium text-sprout-700"
                  }
                >
                  {notice}
                </p>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </>
      )}
      {isAdmin && current !== null && (
        <div className="mt-4 flex flex-col items-center gap-1">
          <button
            type="button"
            disabled={regenerate.isPending}
            onClick={() => {
              regenerate.mutate();
            }}
            className="flex min-h-11 items-center gap-2 text-sm font-bold text-sprout-700 disabled:opacity-50"
          >
            <RefreshCw aria-hidden="true" className="size-4" />
            {t("invite.regenerate")}
          </button>
        </div>
      )}
    </section>
  );
}
