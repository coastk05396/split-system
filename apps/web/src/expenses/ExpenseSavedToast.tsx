import { Share2 } from "lucide-react";
import { useEffect, useState } from "react";
import { t } from "../i18n/messages.js";
import type { SavedShare } from "./expense-sharing.js";
import { ExpenseShareDialog } from "./ExpenseShareDialog.js";

const VISIBLE_MS = 6000;
const LEAVE_MS = 180;

/**
 * The note after saving an Expense: it fades after a few seconds, and Share opens the
 * share dialog without interrupting the next entry.
 */
export function ExpenseSavedToast({ saved }: { saved: SavedShare }) {
  const [visible, setVisible] = useState(true);
  const [leaving, setLeaving] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const held = sharing || hovered || focused;

  // The note stays while the dialog is open or the pointer or focus is on it.
  useEffect(() => {
    if (held) {
      setLeaving(false);
      return;
    }
    if (leaving || !visible) return;
    const timer = window.setTimeout(() => {
      setLeaving(true);
    }, VISIBLE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [held, leaving, visible]);

  // It slips back the way it rose before it is taken away.
  useEffect(() => {
    if (!leaving || held) return;
    const timer = window.setTimeout(() => {
      setVisible(false);
    }, LEAVE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [leaving, held]);

  return (
    <>
      {visible && (
        <div
          role="status"
          onMouseEnter={() => {
            setHovered(true);
          }}
          onMouseLeave={() => {
            setHovered(false);
          }}
          onFocus={() => {
            setFocused(true);
          }}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
          }}
          className={`saved-toast ${leaving ? "is-leaving" : ""} fixed inset-x-0 bottom-24 z-40 mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-3 rounded-full bg-sprout-900 py-2 pr-2 pl-5 text-sm font-bold text-white shadow-lg md:bottom-8`}
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
