import type { Group, Invite } from "@split/shared";
import { ArrowUpRight, Check, Copy, RefreshCw, UserPlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import { useDeps } from "../app/AppProviders.js";
import { useGroup, useInvite, useRegenerateInvite } from "../groups/api.js";
import { failureMessage, LoadError, Loading, primaryButton, ScreenHeader } from "../groups/ui.js";
import { dateFromTimestamp } from "../i18n/format.js";
import { t } from "../i18n/messages.js";
import { LineShareUnavailableError } from "../platform/line.js";

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
  const [justCopied, setJustCopied] = useState(false);

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
      setJustCopied(true);
    } catch {
      setNotice(failureMessage(null));
    }
  }

  async function share(text: string) {
    try {
      if (await line.share(t("invite.shareMessage", { name: group.name, url: text }))) {
        setNotice(t("invite.shared"));
      }
    } catch (error) {
      setNotice(
        error instanceof LineShareUnavailableError
          ? t("invite.shareUnavailable")
          : failureMessage(null),
      );
    }
  }

  return (
    <div className="flex max-w-lg flex-col gap-6 md:mx-auto">
      <ScreenHeader compact title={t("invite.title")} back={`/groups/${group.id}`} />
      <section className="relative isolate overflow-hidden rounded-[2rem] bg-sprout-900 px-6 pt-7 pb-6 text-white shadow-[0_20px_45px_-28px_#143f2a] md:px-8 md:pt-8">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -right-20 size-64 rounded-full border border-white/10"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-10 -right-7 size-40 rounded-full border border-white/10"
        />
        <div className="relative flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-bold tracking-[0.16em] text-white/65">
              {t("invite.heading")}
            </p>
            <h2 className="mt-3 text-3xl leading-tight font-bold wrap-break-word md:text-4xl">
              {group.name}
            </h2>
          </div>
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-white/12 text-white">
            <UserPlus aria-hidden="true" className="size-6" />
          </span>
        </div>
        <p className="relative mt-5 max-w-sm text-sm leading-relaxed text-white/75">
          {t(line.isInClient() ? "invite.bodyLine" : "invite.bodyWeb")}
        </p>
        {invite === null || url === null ? (
          <p className="relative mt-6 border-t border-white/20 pt-4 text-sm text-white/80">
            {regenerate.isError
              ? failureMessage(regenerate.error)
              : isAdmin
                ? t("app.loading")
                : t("invite.noneMember")}
          </p>
        ) : (
          <p className="relative mt-6 border-t border-white/20 pt-4 text-xs text-white/65">
            {t("invite.expires", { date: dateFromTimestamp(invite.expiresAt) })}
          </p>
        )}
      </section>
      {url !== null && (
        <div className="flex flex-col items-center gap-4">
          {line.isInClient() ? (
            <button
              type="button"
              onClick={() => void share(url)}
              className={`${primaryButton} w-full justify-between bg-line py-3.5 hover:bg-line/90`}
            >
              {t("invite.shareLine")}
              <ArrowUpRight aria-hidden="true" className="size-5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void copy(url)}
              className={`${primaryButton} w-full justify-between py-3.5`}
            >
              {t("invite.copy")}
              {justCopied ? (
                <Check aria-hidden="true" className="size-5" />
              ) : (
                <Copy aria-hidden="true" className="size-5" />
              )}
            </button>
          )}
          {line.isInClient() && (
            <button
              type="button"
              onClick={() => void copy(url)}
              className="flex items-center gap-1.5 text-sm font-semibold text-sprout-700 underline-offset-4 hover:underline"
            >
              {justCopied ? (
                <Check aria-hidden="true" className="size-4" />
              ) : (
                <Copy aria-hidden="true" className="size-4" />
              )}
              {t("invite.copy")}
            </button>
          )}
          <p
            role="status"
            className={
              notice === "" ? "sr-only" : "text-center text-sm font-medium text-sprout-700"
            }
          >
            {notice}
          </p>
        </div>
      )}
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
