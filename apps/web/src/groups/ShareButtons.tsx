import { Check, Copy, MessageCircle, Send } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useDeps } from "../app/AppProviders.js";
import { t } from "../i18n/messages.js";
import { LineShareUnavailableError, type LineMessage } from "../platform/line.js";
import { failureMessage } from "./ui.js";

/** What one share dialog sends, in each of the ways a person can send it. */
export interface ShareContent {
  /** The whole message as text, link included: the LINE link, and the LINE picker without cards. */
  text: string;
  url: string;
  title: string;
  /** The message for Telegram, which takes the link separately. */
  telegramText: string;
  /** Sent through the LINE share picker instead of `text`, such as a Flex card. */
  lineMessages?: LineMessage[];
  /** What the copy button puts on the clipboard. */
  copyText: string;
  copyLabel: string;
  copiedNotice: string;
}

const brandButton =
  "press-pill flex w-full items-center gap-3 rounded-full px-3 py-2.5 font-bold text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25)]";

function ShareChip({ children }: { children: ReactNode }) {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/90 text-sprout-800">
      {children}
    </span>
  );
}

/** LINE, Telegram, copy and the system share menu, for any share dialog. */
export function ShareButtons({
  content,
  invite = false,
}: {
  content: ShareContent;
  invite?: boolean;
}) {
  const { line } = useDeps();
  const [notice, setNotice] = useState("");
  const [justCopied, setJustCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(content.copyText);
      setNotice(content.copiedNotice);
      setJustCopied(true);
    } catch {
      setNotice(failureMessage(null));
    }
  }

  async function share() {
    try {
      const sent =
        content.lineMessages === undefined
          ? await line.share(content.text)
          : await line.shareMessages(content.lineMessages);
      if (sent) setNotice(t("invite.shared"));
    } catch (error) {
      setNotice(
        error instanceof LineShareUnavailableError
          ? t("invite.shareUnavailable")
          : failureMessage(null),
      );
    }
  }

  const copyButton = (
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
      {content.copyLabel}
    </button>
  );

  const lineLabel = (
    <>
      <ShareChip>
        <MessageCircle aria-hidden="true" className="size-5" />
      </ShareChip>
      {t("invite.shareLine")}
    </>
  );

  return (
    <>
      <div className="flex flex-col gap-3">
        {invite && copyButton}
        {!invite ? (
          <button
            type="button"
            onClick={() => void share()}
            className={`${brandButton} bg-line hover:bg-line/90`}
          >
            {lineLabel}
          </button>
        ) : (
          <a
            href={`https://line.me/R/share?text=${encodeURIComponent(content.text)}`}
            className={`${brandButton} bg-line hover:bg-line/90`}
          >
            {lineLabel}
          </a>
        )}
        <a
          href={`https://t.me/share/url?url=${encodeURIComponent(content.url)}&text=${encodeURIComponent(content.telegramText)}`}
          target="_blank"
          rel="noopener noreferrer"
          className={`${brandButton} bg-telegram hover:bg-telegram/90`}
        >
          <ShareChip>
            <Send aria-hidden="true" className="size-5" />
          </ShareChip>
          {t("invite.shareTelegram")}
        </a>
        {!invite && copyButton}
      </div>
      <p
        role="status"
        className={
          notice === "" ? "sr-only" : "mt-4 text-center text-sm font-medium text-sprout-700"
        }
      >
        {notice}
      </p>
    </>
  );
}
