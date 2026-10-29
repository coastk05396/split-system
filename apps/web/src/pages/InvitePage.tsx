import type { Group, Invite } from "@split/shared";
import { ArrowLeft, ArrowUpRight, Copy, RefreshCw, UserPlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { useDeps } from "../app/AppProviders.js";
import { useGroup, useInvite, useRegenerateInvite } from "../groups/api.js";
import {
  failureMessage,
  LoadError,
  Loading,
  primaryButton,
  ScreenHeader,
  secondaryButton,
} from "../groups/ui.js";
import { dateFromTimestamp } from "../i18n/format.js";
import { t } from "../i18n/messages.js";

/** `split.rickchen.si/join/<token>` on the site the app is served from. */
export function joinUrl(token: string): string {
  return `${window.location.origin}/join/${token}`;
}

/**
 * Screen 9 as amended (decision 10): the Group's one live link, its 7-day expiry, LINE's
 * share target picker inside LINE, copy-link everywhere, and regenerate for Admins.
 */
export function InvitePage() {
  const id = useParams().id ?? "";
  const group = useGroup(id);
  const invite = useInvite(id);

  if (group.isError) return <LoadError error={group.error} onRetry={() => void group.refetch()} />;
  if (invite.isError) {
    return <LoadError error={invite.error} onRetry={() => void invite.refetch()} />;
  }
  if (group.isPending || invite.isPending) return <Loading />;
  return <InviteCard group={group.data} invite={invite.data} />;
}

function InviteCard({ group, invite }: { group: Group; invite: Invite | null }) {
  const { line } = useDeps();
  const regenerate = useRegenerateInvite(group.id);
  const isAdmin = group.me.role === "admin";
  const [notice, setNotice] = useState("");

  // An Admin arriving with no live link (a new Group, or a lapsed link) gets one at once.
  const asked = useRef(false);
  useEffect(() => {
    if (invite === null && isAdmin && !asked.current) {
      asked.current = true;
      regenerate.mutate();
    }
  }, [invite, isAdmin, regenerate]);

  const url = invite === null ? null : joinUrl(invite.token);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(t("invite.copied"));
    } catch {
      setNotice(failureMessage(null));
    }
  }

  async function share(text: string) {
    try {
      if (await line.share(t("invite.shareMessage", { name: group.name, url: text }))) {
        setNotice(t("invite.shared"));
      }
    } catch {
      setNotice(failureMessage(null));
    }
  }

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <ScreenHeader
        compact
        title={t("invite.title")}
        back={`/groups/${group.id}`}
        subtitle={group.name}
      />
      <section className="flex flex-col gap-3 rounded-3xl border border-sprout-200 bg-white p-5">
        <div className="flex items-center gap-3">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-sprout-100">
            <UserPlus aria-hidden="true" className="size-6 text-sprout-500" />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-bold">{t("invite.heading")}</h2>
            <p className="text-sm text-ink-muted">{t("invite.body")}</p>
          </div>
        </div>
        {invite === null || url === null ? (
          <p className="text-ink-muted">
            {regenerate.isError
              ? failureMessage(regenerate.error)
              : isAdmin
                ? t("app.loading")
                : t("invite.noneMember")}
          </p>
        ) : (
          <>
            <p
              aria-label={t("invite.link")}
              className="truncate rounded-2xl border border-sprout-200 bg-sprout-50 px-4 py-2.5 text-sm"
            >
              {url}
            </p>
            <p className="text-xs text-ink-muted">
              {t("invite.expires", {
                date: dateFromTimestamp(invite.expiresAt),
              })}
            </p>
          </>
        )}
      </section>
      {url !== null && (
        <div className="flex flex-col gap-2">
          {line.isInClient() && (
            <button
              type="button"
              onClick={() => void share(url)}
              className={`${primaryButton} justify-between py-3`}
            >
              {t("invite.shareLine")}
              <ArrowUpRight aria-hidden="true" className="size-5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => void copy(url)}
            className={`${line.isInClient() ? secondaryButton : primaryButton} justify-between py-3`}
          >
            {t("invite.copy")}
            <Copy aria-hidden="true" className="size-5" />
          </button>
        </div>
      )}
      <p role="status" className="min-h-5 text-center text-sm font-bold text-sprout-600">
        {notice}
      </p>
      <Link to={`/groups/${group.id}`} className={`${secondaryButton} py-3`}>
        <ArrowLeft aria-hidden="true" className="size-5" />
        {t("invite.back")}
      </Link>
      {isAdmin && invite !== null && (
        <div className="flex flex-col items-center gap-1">
          <button
            type="button"
            disabled={regenerate.isPending}
            onClick={() => {
              regenerate.mutate();
            }}
            className="flex items-center gap-2 text-sm font-bold text-sprout-600 disabled:opacity-50"
          >
            <RefreshCw aria-hidden="true" className="size-4" />
            {t("invite.regenerate")}
          </button>
          <p className="text-xs text-ink-muted">{t("invite.regenerateHint")}</p>
        </div>
      )}
    </div>
  );
}
