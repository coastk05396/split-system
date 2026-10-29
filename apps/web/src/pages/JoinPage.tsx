import * as Dialog from "@radix-ui/react-dialog";
import { type CurrencyCode, formatAmount, type InvitePreview } from "@split/shared";
import { Users } from "lucide-react";
import { useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { ApiFailure } from "../api/errors.js";
import { useInvitePreview, useJoin } from "../groups/api.js";
import {
  Avatar,
  card,
  failureMessage,
  LoadError,
  Loading,
  primaryButton,
  secondaryButton,
} from "../groups/ui.js";
import { type MessageId, t } from "../i18n/messages.js";

type Placeholder = InvitePreview["placeholders"][number];

const INVITE_ERRORS: Partial<Record<string, MessageId>> = {
  INVITE_EXPIRED: "join.expired",
  NOT_FOUND: "join.revoked",
  GROUP_FULL: "join.full",
};

/**
 * The join screen for an Invite (decisions 10, 31): the Group's name and size, the privacy
 * line, joining as a new Member, or "你是這些人之一嗎？" and claiming a Placeholder Member.
 * Signing in first is handled by the app's gate, which returns here afterwards.
 */
export function JoinPage() {
  const token = useParams().token ?? "";
  const preview = useInvitePreview(token);

  if (preview.isPending) return <Loading />;
  if (preview.isError) {
    const known =
      preview.error instanceof ApiFailure ? INVITE_ERRORS[preview.error.code] : undefined;
    if (known === undefined) {
      return <LoadError error={preview.error} onRetry={() => void preview.refetch()} />;
    }
    return (
      <div className="flex max-w-md flex-col items-start gap-4">
        <h1 className="text-2xl font-bold">{t("join.title")}</h1>
        <p role="alert" className="rounded-2xl bg-peach p-4">
          {t(known)}
        </p>
        <Link to="/" className={`${secondaryButton} py-3`}>
          {t("join.home")}
        </Link>
      </div>
    );
  }
  if (preview.data.isMember) return <Navigate to={`/groups/${preview.data.groupId}`} replace />;
  return <JoinForm token={token} preview={preview.data} />;
}

function JoinForm({ token, preview }: { token: string; preview: InvitePreview }) {
  const navigate = useNavigate();
  const join = useJoin(token);
  const [claiming, setClaiming] = useState<Placeholder | null>(null);

  const submit = (memberId: string | null) => {
    join.mutate(memberId, {
      onSuccess: (result) => void navigate(`/groups/${result.groupId}`, { replace: true }),
    });
  };
  const hasPlaceholders = preview.placeholders.length > 0;

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <section className="flex flex-col items-center gap-3 rounded-3xl border border-sprout-200 bg-white p-6 text-center">
        <span className="flex size-20 items-center justify-center rounded-full bg-sprout-100">
          <Users aria-hidden="true" className="size-9 text-sprout-500" />
        </span>
        <p className="text-sm text-ink-muted">{t("join.title")}</p>
        <h1 className="text-2xl font-bold">{preview.groupName}</h1>
        <p className="text-sm text-ink-muted">
          {t("join.summary", { count: preview.memberCount, currency: preview.settlementCurrency })}
        </p>
        <p className="rounded-2xl bg-sprout-150 px-4 py-2 text-sm">{t("join.privacy")}</p>
      </section>
      {join.isError && (
        <p role="alert" className="text-red-700">
          {failureMessage(join.error)}
        </p>
      )}
      {hasPlaceholders && (
        <section className="flex flex-col gap-3">
          <h2 id="who-are-you" className="text-lg font-bold">
            {t("join.whoAreYou")}
          </h2>
          <p className="text-sm text-ink-muted">{t("join.whoAreYouHint")}</p>
          <ul aria-labelledby="who-are-you" className="flex flex-col gap-3">
            {preview.placeholders.map((p) => (
              <li key={p.memberId} className={`${card} flex items-center gap-4 p-4`}>
                <Avatar name={p.name} placeholder />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-bold">{p.name}</span>
                  {p.addedBy !== null && (
                    <span className="text-sm text-ink-muted">
                      {t("join.addedBy", { name: p.addedBy })}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  disabled={join.isPending}
                  onClick={() => {
                    setClaiming(p);
                  }}
                  className={`${secondaryButton} px-4 py-2 text-sm`}
                >
                  {t("join.claim", { name: p.name })}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <button
        type="button"
        disabled={join.isPending}
        onClick={() => {
          submit(null);
        }}
        className={hasPlaceholders ? secondaryButton : primaryButton}
      >
        {t(hasPlaceholders ? "join.asNew" : "join.submit")}
      </button>
      <ClaimDialog
        placeholder={claiming}
        currency={preview.settlementCurrency}
        pending={join.isPending}
        onClose={() => {
          setClaiming(null);
        }}
        onConfirm={(memberId) => {
          submit(memberId);
        }}
      />
    </div>
  );
}

function takeOverLine(p: Placeholder, currency: CurrencyCode): string {
  const balance =
    p.balance < 0
      ? t("join.owes", { amount: formatAmount(-p.balance, currency) })
      : p.balance > 0
        ? t("join.owed", { amount: formatAmount(p.balance, currency) })
        : t("join.even");
  return t("join.takeOver", { name: p.name, count: p.expenseCount, balance });
}

function ClaimDialog(props: {
  placeholder: Placeholder | null;
  currency: CurrencyCode;
  pending: boolean;
  onClose: () => void;
  onConfirm: (memberId: string) => void;
}) {
  const p = props.placeholder;

  return (
    <Dialog.Root
      open={props.placeholder !== null}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-20 bg-ink/40" />
        <Dialog.Content className="fixed inset-x-4 top-1/2 z-30 mx-auto flex max-w-md -translate-y-1/2 flex-col gap-4 rounded-3xl bg-white p-6 text-ink">
          {p !== null && (
            <>
              <Dialog.Title className="text-xl font-bold">
                {t("join.claimTitle", { name: p.name })}
              </Dialog.Title>
              <Dialog.Description className="font-bold">
                {takeOverLine(p, props.currency)}
              </Dialog.Description>
              <p className="text-sm text-ink-muted">
                {p.addedBy === null
                  ? t("join.typedByUnknown")
                  : t("join.typedBy", { name: p.addedBy })}
              </p>
              <p className="text-sm text-ink-muted">{t("join.noUndo")}</p>
              <div className="flex gap-3">
                <Dialog.Close className={`${secondaryButton} flex-1 py-3`}>
                  {t("common.cancel")}
                </Dialog.Close>
                <button
                  type="button"
                  disabled={props.pending}
                  onClick={() => {
                    props.onConfirm(p.memberId);
                  }}
                  className={`${primaryButton} flex-1 py-3`}
                >
                  {t("join.claimConfirm")}
                </button>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
