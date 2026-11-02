import * as Dialog from "@radix-ui/react-dialog";
import { formatAmount, type Group } from "@split/shared";
import { useState } from "react";
import { useNavigate } from "react-router";
import { t } from "../i18n/messages.js";
import { useDeleteGroup, useMembers } from "./api.js";
import { failureMessage, input, secondaryButton } from "./ui.js";

const CONFIRM_WORD = "delete";

/**
 * Screen 31 (decision 10): an Admin types the word delete, sees what is still unsettled,
 * and deletes the Group and everything in it for good.
 */
export function DeleteGroupDialog({
  group,
  open,
  onOpenChange,
}: {
  group: Group;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay glass-overlay fixed inset-0 z-20" />
        <Dialog.Content className="dialog-content glass-dialog fixed inset-x-0 bottom-0 z-30 flex max-h-[85dvh] flex-col gap-4 overflow-y-auto rounded-t-[2rem] border-t border-sprout-200/80 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-ink md:inset-x-4 md:top-1/2 md:bottom-auto md:mx-auto md:max-w-md md:-translate-y-1/2 md:rounded-3xl md:border md:p-6">
          {open && <DeleteForm group={group} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DeleteForm({ group }: { group: Group }) {
  const navigate = useNavigate();
  const members = useMembers(group.id);
  const remove = useDeleteGroup(group.id);
  const [typed, setTyped] = useState("");
  // Every unsettled debt counted once: the sum of what Members are owed.
  const unsettled = (members.data ?? []).reduce((sum, m) => sum + Math.max(m.balance, 0), 0);

  return (
    <>
      <Dialog.Title className="text-xl font-bold">
        {t("group.delete.title", { name: group.name })}
      </Dialog.Title>
      <Dialog.Description className="text-ink-muted">{t("group.delete.body")}</Dialog.Description>
      {unsettled > 0 && (
        <p className="rounded-2xl bg-peach p-3 font-bold">
          {t("group.delete.unsettled", {
            amount: formatAmount(unsettled, group.settlementCurrency),
          })}
        </p>
      )}
      <label className="flex flex-col gap-2">
        <span className="text-sm font-bold">{t("group.delete.confirmLabel")}</span>
        <input
          value={typed}
          onFocus={(e) => {
            e.currentTarget.scrollIntoView({ block: "center", behavior: "smooth" });
          }}
          onChange={(e) => {
            setTyped(e.target.value);
          }}
          className={input}
        />
      </label>
      {remove.isError && (
        <p role="alert" className="text-red-700">
          {failureMessage(remove.error)}
        </p>
      )}
      <div className="flex gap-3">
        <Dialog.Close className={`${secondaryButton} flex-1 py-3`}>
          {t("common.cancel")}
        </Dialog.Close>
        <button
          type="button"
          disabled={typed.trim().toLowerCase() !== CONFIRM_WORD || remove.isPending}
          onClick={() => {
            remove.mutate(undefined, {
              onSuccess: () => void navigate("/groups", { replace: true }),
            });
          }}
          className="press-pill flex flex-1 items-center justify-center rounded-full bg-red-700 py-3 font-bold text-white hover:bg-red-700/90 disabled:opacity-50"
        >
          {t("group.delete.confirm")}
        </button>
      </div>
    </>
  );
}
