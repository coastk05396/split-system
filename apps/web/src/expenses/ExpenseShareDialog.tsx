import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { ShareButtons } from "../groups/ShareButtons.js";
import { t } from "../i18n/messages.js";
import {
  type ExpenseCard,
  expenseFlexMessage,
  expenseText,
  expenseTextWithoutLink,
} from "./expense-card.js";

/** A small copy of the LINE card, so a person sees what the others will get. */
function CardPreview({ card }: { card: ExpenseCard }) {
  return (
    <div className="overflow-hidden rounded-3xl border border-sprout-200 bg-white shadow-sm">
      <div className="h-1 bg-peach" />
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-peach text-xl"
          >
            🧾
          </span>
          <p className="min-w-0 truncate text-sm font-bold text-ink-muted">{card.groupName}</p>
        </div>
        <p className="text-lg font-bold">
          {card.title} <span aria-hidden="true">{card.emoji}</span>
        </p>
        <div className="flex items-center justify-between gap-3">
          <p className="text-3xl font-bold tabular-nums">{card.amount}</p>
          <span className="shrink-0 rounded-full bg-sprout-150 px-3 py-1.5 text-xs font-bold text-sprout-500">
            {card.split}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-sprout-200 pt-3 text-sm">
          <span className="text-ink-muted">{card.payer}</span>
          {card.each !== null && <span className="font-bold text-sprout-500">{card.each}</span>}
        </div>
        <p className="flex items-center justify-center gap-2 rounded-2xl bg-sprout-500 py-3.5 font-bold text-white">
          {t("expenseShare.view")} <span aria-hidden="true">↗</span>
        </p>
      </div>
    </div>
  );
}

/** Share one Expense: a LINE card inside LINE, otherwise text with a link. */
export function ExpenseShareDialog({
  card,
  open,
  onOpenChange,
}: {
  card: ExpenseCard;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay glass-overlay fixed inset-0 z-50" />
        <Dialog.Content
          aria-describedby={undefined}
          className="dialog-content glass-dialog fixed inset-x-4 top-1/2 z-50 mx-auto flex max-h-[90dvh] max-w-sm -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-3xl border border-sprout-200/80 p-6 text-ink"
        >
          <div className="flex items-start justify-between gap-3">
            <Dialog.Title className="text-xl font-bold">{t("expenseShare.title")}</Dialog.Title>
            <Dialog.Close
              aria-label={t("common.cancel")}
              className="press-icon -mt-1 -mr-2 rounded-full p-2.5 text-sprout-800 hover:bg-sprout-100"
            >
              <X aria-hidden="true" className="size-6" />
            </Dialog.Close>
          </div>
          <CardPreview card={card} />
          <ShareButtons
            content={{
              text: expenseText(card),
              url: card.url,
              title: card.title,
              telegramText: expenseTextWithoutLink(card),
              lineMessages: [expenseFlexMessage(card)],
              copyText: expenseText(card),
              copyLabel: t("expenseShare.copy"),
              copiedNotice: t("expenseShare.copied"),
            }}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
