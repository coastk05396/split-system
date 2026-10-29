import * as Menu from "@radix-ui/react-dropdown-menu";
import { formatAmount, type Group, type Member } from "@split/shared";
import { ArrowRight, Ellipsis, Link2 } from "lucide-react";
import { type SubmitEvent, useState } from "react";
import { Link, useParams } from "react-router";
import { ApiFailure } from "../api/errors.js";
import {
  useAddPlaceholder,
  useGroup,
  useMembers,
  usePatchMember,
  useRemoveMember,
} from "../groups/api.js";
import {
  Avatar,
  card,
  failureMessage,
  input,
  LoadError,
  Loading,
  primaryButton,
  ScreenHeader,
  secondaryButton,
} from "../groups/ui.js";
import { localName } from "../i18n/format.js";
import { t } from "../i18n/messages.js";

/**
 * Screen 13 as amended (decisions 10, 31): Members with roles, shown by their LINE or Google
 * name and picture, Placeholder Members in a dashed circle, Former Members apart, the Admin
 * "…" menu with the zero-Balance block message, and adding a Placeholder Member by name.
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
  const [blocked, setBlocked] = useState<string | null>(null);
  const [freshMemberId, setFreshMemberId] = useState<string | null>(null);

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <ScreenHeader
        title={t("members.title")}
        back={`/groups/${group.id}`}
        subtitle={t("members.summary", { name: group.name, count: seated.length })}
      />
      {blocked !== null && (
        <p role="alert" className="rounded-2xl bg-peach p-4 font-bold">
          {blocked}
        </p>
      )}
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
            {isAdmin && !m.isMe && <MemberMenu group={group} member={m} onBlocked={setBlocked} />}
          </li>
        ))}
      </ul>
      <p className="text-sm text-ink-muted">{t("members.cap")}</p>
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
      <AddPlaceholderForm groupId={group.id} onAdded={setFreshMemberId} />
      <Link
        to={`/groups/${group.id}/invite`}
        className="flex items-start gap-3 rounded-3xl bg-sprout-150 p-5"
      >
        <Link2 aria-hidden="true" className="mt-0.5 size-5 text-sprout-500" />
        <span className="flex flex-col gap-1">
          <span className="font-bold">{t("members.inviteMore")}</span>
          <span className="text-sm text-ink-muted">{t("members.inviteMoreBody")}</span>
        </span>
      </Link>
      <Link to={`/groups/${group.id}/invite`} className={`${primaryButton} justify-between`}>
        {t("members.invite")}
        <ArrowRight aria-hidden="true" className="size-5" />
      </Link>
    </div>
  );
}

function MemberMenu({
  group,
  member,
  onBlocked,
}: {
  group: Group;
  member: Member;
  onBlocked: (message: string | null) => void;
}) {
  const patch = usePatchMember(group.id);
  const remove = useRemoveMember(group.id);
  const report = (error: unknown) => {
    onBlocked(
      error instanceof ApiFailure && error.code === "BALANCE_NOT_ZERO"
        ? t("members.blocked", {
            name: localName(member.displayName),
            amount: formatAmount(member.balance, group.settlementCurrency),
          })
        : failureMessage(error),
    );
  };
  const setRole = (role: Member["role"]) => {
    onBlocked(null);
    patch.mutate({ memberId: member.id, patch: { role } }, { onError: report });
  };
  const item = "cursor-pointer rounded-xl px-4 py-3 outline-none data-[highlighted]:bg-sprout-150";

  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={t("members.actions", { name: localName(member.displayName) })}
        className="press-icon rounded-full p-2 text-sprout-600 hover:bg-sprout-150"
      >
        <Ellipsis aria-hidden="true" className="size-5" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="end"
          sideOffset={6}
          className="menu-content z-30 min-w-40 rounded-2xl border border-sprout-200/90 p-1 text-ink"
        >
          {member.status === "active" && member.role === "member" && (
            <Menu.Item
              className={item}
              onSelect={() => {
                setRole("admin");
              }}
            >
              {t("members.promote")}
            </Menu.Item>
          )}
          {member.status === "active" && member.role === "admin" && (
            <Menu.Item
              className={item}
              onSelect={() => {
                setRole("member");
              }}
            >
              {t("members.demote")}
            </Menu.Item>
          )}
          <Menu.Item
            className={`${item} text-red-700`}
            onSelect={() => {
              onBlocked(null);
              remove.mutate(member.id, { onError: report });
            }}
          >
            {t("members.remove")}
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

function AddPlaceholderForm({
  groupId,
  onAdded,
}: {
  groupId: string;
  onAdded: (memberId: string) => void;
}) {
  const add = useAddPlaceholder(groupId);
  const [name, setName] = useState("");

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    add.mutate(name.trim(), {
      onSuccess: (member) => {
        setName("");
        onAdded(member.id);
      },
    });
  }

  return (
    <form onSubmit={submit} className={`${card} flex flex-col gap-3 p-5`}>
      <h2 className="font-bold">{t("members.addPlaceholder")}</h2>
      <p className="text-sm text-ink-muted">{t("members.placeholderHint")}</p>
      <div className="flex gap-3">
        <label className="flex-1">
          <span className="sr-only">{t("members.placeholderName")}</span>
          <input
            value={name}
            maxLength={60}
            placeholder={t("members.placeholderName")}
            onChange={(e) => {
              setName(e.target.value);
              add.reset();
            }}
            className={input}
          />
        </label>
        <button
          type="submit"
          disabled={name.trim() === "" || add.isPending}
          className={`${secondaryButton} py-2.5`}
        >
          {t("members.add")}
        </button>
      </div>
      {add.isError && (
        <p role="alert" className="text-red-700">
          {failureMessage(add.error)}
        </p>
      )}
    </form>
  );
}
