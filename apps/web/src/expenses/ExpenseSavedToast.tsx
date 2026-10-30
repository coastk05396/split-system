import { Share2 } from "lucide-react";
import { useEffect, useState } from "react";
import { t } from "../i18n/messages.js";
import type { ExpenseCard } from "./expense-card.js";
import { ExpenseShareDialog } from "./ExpenseShareDialog.js";

/** How the Expense reached the LINE chat the app was opened from, if the person asked for that. */
export type ChatSendResult = "none" | "sent" | "failed";

/** Carried from the add form to the Group page in router state. */
export interface SavedShare {
  card: ExpenseCard;
  chat: ChatSendResult;
}

const VISIBLE_MS = 6000;

/**
 * The note after saving an Expense: it fades after a few seconds, and Share opens the
 * share dialog without interrupting the next entry.
 */
export function ExpenseSavedToast({ saved }: { saved: SavedShare }) {
  const [visible, setVisible] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [held, setHeld] = useState(false);

  // The note stays while the dialog is open or the pointer or focus is on it.
  useEffect(() => {
    if (sharing || held) return;
    const timer = window.setTimeout(() => {
      setVisible(false);
    }, VISIBLE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [sharing, held]);

  return (
    <>
      {visible && (
        <div
          role="status"
          onMouseEnter={() => {
            setHeld(true);
          }}
          onMouseLeave={() => {
            setHeld(false);
          }}
          onFocus={() => {
            setHeld(true);
          }}
          onBlur={() => {
            setHeld(false);
          }}
          className="rise fixed inset-x-0 bottom-24 z-40 mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-3 rounded-full bg-sprout-900 py-2 pr-2 pl-5 text-sm font-bold text-white shadow-lg md:bottom-8"
        >
          <span aria-hidden="true">🌱</span>
          <span>
            {t(
              saved.chat === "sent"
                ? "expenseShare.savedSent"
                : saved.chat === "failed"
                  ? "expenseShare.savedSendFailed"
                  : "expenseShare.savedToast",
            )}
          </span>
          <button
            type="button"
            onClick={() => {
              setSharing(true);
            }}
            className="press-pill flex min-h-11 items-center gap-1.5 rounded-full bg-white px-4 text-sprout-700"
          >
            <Share2 aria-hidden="true" className="size-4" />
            {t("expenseShare.action")}
          </button>
        </div>
      )}
      <ExpenseShareDialog card={saved.card} open={sharing} onOpenChange={setSharing} />
    </>
  );
}
