import * as Dialog from "@radix-ui/react-dialog";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { formatAmount, type Group, type Member } from "@split/shared";
import { Check, Pencil, Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { useParams } from "react-router";
import { ApiFailure } from "../api/errors.js";
import {
  useAddPlaceholder,
  useGroup,
  useMembers,
  usePatchMember,
  useRemoveMember,
} from "../groups/api.js";
import { Avatar, card, failureMessage, LoadError, Loading, ScreenHeader } from "../groups/ui.js";
import { localName } from "../i18n/format.js";
import { t } from "../i18n/messages.js";
import { InviteSection } from "./InviteSection.js";

/**
 * Screen 13 as amended (decisions 10, 31): Members with roles, shown by their LINE or Google
 * name and picture, Placeholder Members in a dashed circle, Former Members apart, the Admin
 * role pill and trash button with the zero-Balance block message, one-tap numbered
 * Placeholder creation, and sharing the Group's Invite.
 */
export function MembersPage() {
  const id = useParams().id ?? "";
  const group = useGroup(id);
  const members = useMembers(id);
  if (group.isError) return <LoadError error={group.error} onRetry={() => void group.refetch()} />;
  if (members.isError) {
    return <LoadError error={members.error} onRetry={() => void members.refetch()} />;
  }
  if (group.isPending || members.isPending) return <Loading />;
  return <MemberList group={group.data} members={members.data} />;
}

function MemberList({ group, members }: { group: Group; members: Member[] }) {
  const seated = members.filter((m) => m.status !== "former");
  const former = members.filter((m) => m.status === "former");
  const isAdmin = group.me.role === "admin";
  const add = useAddPlaceholder(group.id);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [freshMemberId, setFreshMemberId] = useState<string | null>(null);

  async function addMember() {
    const names = new Set(members.map((member) => member.displayName));
    let number = 1;
    while (names.has(`成員${number}`)) number++;
    setBlocked(null);
    try {
      const member = await add.mutateAsync(`成員${number}`);
      setFreshMemberId(member.id);
    } catch (error) {
      setBlocked(failureMessage(error));
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <ScreenHeader title={t("members.manageTitle")} back={`/groups/${group.id}`} />
      {blocked !== null && (
        <p role="alert" className="rounded-2xl bg-peach p-4 font-bold">
          {blocked}
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-sprout-900">{t("members.title")}</h2>
        <button
          type="button"
          disabled={add.isPending}
          onClick={() => void addMember()}
          className="press-pill flex min-h-11 items-center gap-1 rounded-full bg-sprout-150 px-4 text-sm font-bold text-sprout-700 hover:bg-sprout-200 disabled:opacity-50"
        >
          <Plus aria-hidden="true" className="size-5" />
          {t("members.addTrigger")}
        </button>
      </div>
      <ul aria-label={t("members.title")} className="flex flex-col gap-3">
        {seated.map((m) => (
          <li
            key={m.id}
            className={`${card} flex items-center gap-4 p-4 ${m.id === freshMemberId ? "row-arrive" : ""}`}
          >
            <Avatar
              name={m.displayName}
              pictureUrl={m.pictureUrl}
              placeholder={m.status === "placeholder"}
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-bold">
                {localName(m.displayName)}
                {m.isMe && t("members.me")}
                {m.status === "placeholder" && (
                  <span className="font-normal text-ink-muted">{t("members.placeholder")}</span>
                )}
              </span>
              {m.status === "active" && (
                <span className="text-sm text-ink-muted">
                  {t(m.role === "admin" ? "members.admin" : "members.member")}
                </span>
              )}
            </span>
            {(m.status === "placeholder" || (isAdmin && !m.isMe)) && (
              <MemberControls group={group} member={m} isAdmin={isAdmin} onBlocked={setBlocked} />
            )}
          </li>
        ))}
      </ul>
      {former.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-bold">{t("members.former")}</h2>
          <ul aria-label={t("members.former")} className="flex flex-col gap-2">
            {former.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-4 text-ink-muted">
                <Avatar name={m.displayName} pictureUrl={m.pictureUrl} className="size-8 text-sm" />
                {localName(m.displayName)}
              </li>
            ))}
          </ul>
        </section>
      )}
      <InviteSection group={group} />
    </div>
  );
}

function MemberControls({
  group,
  member,
  isAdmin,
  onBlocked,
}: {
  group: Group;
  member: Member;
  isAdmin: boolean;
  onBlocked: (message: string | null) => void;
}) {
  const patch = usePatchMember(group.id);
  const remove = useRemoveMember(group.id);
  const [confirming, setConfirming] = useState<"promote" | "remove" | null>(null);
  const [renaming, setRenaming] = useState(false);
  const renameTriggerRef = useRef<HTMLButtonElement>(null);
  const [draftName, setDraftName] = useState(member.displayName);
  const [renameError, setRenameError] = useState<string | null>(null);
  const name = localName(member.displayName);
  const report = (error: unknown) => {
    onBlocked(
      error instanceof ApiFailure && error.code === "BALANCE_NOT_ZERO"
        ? t("members.blocked", {
            name,
            amount: formatAmount(member.balance, group.settlementCurrency),
          })
        : failureMessage(error),
    );
  };
  const setRole = (role: Member["role"]) => {
    onBlocked(null);
    patch.mutate({ memberId: member.id, patch: { role } }, { onError: report });
  };
  const item =
    "flex cursor-pointer items-center justify-between gap-4 rounded-xl px-4 py-3 outline-none data-[highlighted]:bg-sprout-150";

  return (
    <div className="flex items-center gap-1">
      {member.status === "active" && (
        <Menu.Root>
          <Menu.Trigger
            aria-label={t("members.role", { name })}
            className="press-icon flex size-11 items-center justify-center rounded-full text-sprout-700 hover:bg-sprout-150"
          >
            <Pencil aria-hidden="true" className="size-5" />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content
              align="end"
              sideOffset={6}
              className="menu-content z-30 min-w-40 rounded-2xl border border-sprout-200/90 p-1 text-ink"
            >
              {(["admin", "member"] as const).map((role) => (
                <Menu.Item
                  key={role}
                  className={item}
                  onSelect={() => {
                    if (role === member.role) return;
                    if (role === "admin") setConfirming("promote");
                    else setRole("member");
                  }}
                >
                  {t(role === "admin" ? "members.admin" : "members.member")}
                  {role === member.role && (
                    <Check aria-hidden="true" className="size-4 text-sprout-600" />
                  )}
                </Menu.Item>
              ))}
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
      )}
      {member.status === "placeholder" && (
        <button
          type="button"
          ref={renameTriggerRef}
          aria-label={t("members.rename", { name })}
          onClick={() => {
            setDraftName(member.displayName);
            setRenameError(null);
            setRenaming(true);
          }}
          className="press-icon flex size-11 items-center justify-center rounded-full text-sprout-700 hover:bg-sprout-150"
        >
          <Pencil aria-hidden="true" className="size-5" />
        </button>
      )}
      <Dialog.Root open={renaming} onOpenChange={setRenaming}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-30 bg-sprout-900/70" />
          <Dialog.Content
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              renameTriggerRef.current?.focus();
            }}
            className="fixed top-1/2 left-1/2 z-40 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-[2rem] bg-white p-6 shadow-2xl"
          >
            <Dialog.Title className="text-xl font-bold">{t("members.renameTitle")}</Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-ink-muted">
              {t("members.renameDescription")}
            </Dialog.Description>
            <form
              className="mt-4 flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                setRenameError(null);
                patch.mutate(
                  { memberId: member.id, patch: { placeholderName: draftName.trim() } },
                  {
                    onSuccess: () => {
                      setRenaming(false);
                    },
                    onError: (error) => {
                      setRenameError(failureMessage(error));
                    },
                  },
                );
              }}
            >
              <label className="flex flex-col gap-2 text-sm font-bold">
                {t("members.renameLabel")}
                <input
                  autoFocus
                  required
                  maxLength={50}
                  value={draftName}
                  onChange={(event) => {
                    setDraftName(event.target.value);
                  }}
                  className="rounded-xl border border-sprout-200 px-4 py-3"
                />
              </label>
              {renameError !== null && (
                <p role="alert" className="text-sm text-red-700">
                  {renameError}
                </p>
              )}
              <div className="flex gap-3">
                <Dialog.Close className="flex-1 rounded-full border border-sprout-200 px-4 py-3 font-bold">
                  {t("common.cancel")}
                </Dialog.Close>
                <button
                  type="submit"
                  disabled={!draftName.trim() || patch.isPending}
                  className="flex-1 rounded-full bg-sprout-600 px-4 py-3 font-bold text-white disabled:opacity-50"
                >
                  {t("members.renameSave")}
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      {isAdmin && (
        <button
          type="button"
          aria-label={t("members.removeAria", { name })}
          onClick={() => {
            if (member.balance !== 0) report(new ApiFailure("BALANCE_NOT_ZERO", 409));
            else setConfirming("remove");
          }}
          className="press-icon flex size-11 items-center justify-center rounded-full text-red-700 hover:bg-red-50"
        >
          <Trash2 aria-hidden="true" className="size-5" />
        </button>
      )}
      <ConfirmDialog
        open={confirming === "promote"}
        title={t("members.confirmPromoteTitle", { name })}
        body={t("members.confirmPromoteBody")}
        confirmLabel={t("members.confirmPromote")}
        onClose={() => {
          setConfirming(null);
        }}
        onConfirm={() => {
          setRole("admin");
        }}
      />
      <ConfirmDialog
        open={confirming === "remove"}
        title={t("members.confirmRemoveTitle", { name })}
        body={t("members.confirmRemoveBody", { name })}
        confirmLabel={t("members.confirmRemove")}
        danger
        onClose={() => {
          setConfirming(null);
        }}
        onConfirm={() => {
          onBlocked(null);
          remove.mutate(member.id, { onError: report });
        }}
      />
    </div>
  );
}

function ConfirmDialog(props: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog.Root
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-30 bg-sprout-900/70" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-40 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-[2rem] bg-white p-6 shadow-2xl">
          <Dialog.Title className="text-xl font-bold text-sprout-900">{props.title}</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-ink-muted">
            {props.body}
          </Dialog.Description>
          <div className="mt-6 flex gap-3">
            <Dialog.Close className="press-pill flex-1 rounded-full border border-sprout-200 px-6 py-3 font-bold text-sprout-800 hover:border-sprout-500">
              {t("common.cancel")}
            </Dialog.Close>
            <button
              type="button"
              onClick={() => {
                props.onConfirm();
                props.onClose();
              }}
              className={`press-pill flex-1 rounded-full px-6 py-3 font-bold text-white ${props.danger === true ? "bg-red-700 hover:bg-red-800" : "bg-sprout-600 hover:bg-sprout-700"}`}
            >
              {props.confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
