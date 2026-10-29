import * as Dialog from "@radix-ui/react-dialog";
import { formatAmount, type Group } from "@split/shared";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { t } from "../i18n/messages.js";
import { useDeleteGroup, useMembers } from "./api.js";
import { failureMessage, input, secondaryButton } from "./ui.js";

/**
 * Screen 31 (decision 10): an Admin types the Group's name, sees what is still unsettled,
 * and deletes the Group and everything in it for good.
 */
export function DeleteGroupDialog({ group }: { group: Group }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        aria-label={t("group.delete")}
        className="rounded-full p-2 text-red-700 hover:bg-red-50"
      >
        <Trash2 aria-hidden="true" className="size-6" />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-20 bg-ink/40" />
        <Dialog.Content className="fixed inset-x-4 top-1/2 z-30 mx-auto flex max-w-md -translate-y-1/2 flex-col gap-4 rounded-3xl bg-white p-6 text-ink">
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
          disabled={typed !== group.name || remove.isPending}
          onClick={() => {
            remove.mutate(undefined, {
              onSuccess: () => void navigate("/groups", { replace: true }),
            });
          }}
          className="flex flex-1 items-center justify-center rounded-full bg-red-700 py-3 font-bold text-white disabled:opacity-50"
        >
          {t("group.delete.confirm")}
        </button>
      </div>
    </>
  );
}
