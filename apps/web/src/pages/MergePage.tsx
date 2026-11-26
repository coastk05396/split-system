import type { MergePreview, MergeUserPreview, Provider } from "@split/shared";
import { ArrowLeft } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { ApiFailure, type ErrorCode } from "../api/errors.js";
import { useAuth } from "../auth/AuthProvider.js";
import { GoogleG } from "../auth/GoogleButton.js";
import {
  Avatar,
  card,
  GroupAvatar,
  Loading,
  primaryButton,
  secondaryButton,
} from "../groups/ui.js";
import { errorMessage, t } from "../i18n/messages.js";

const PROVIDER_NAME: Record<Provider, string> = { line: "LINE", google: "Google" };

function ProviderTag({ provider }: { provider: Provider }) {
  return (
    <span
      className={
        provider === "line"
          ? "inline-flex items-center gap-1 rounded-full bg-line px-2 py-0.5 text-[11px] font-bold tracking-wide text-sprout-900"
          : "inline-flex items-center gap-1 rounded-full border border-[#747775] bg-white px-2 py-0.5 text-[11px] font-semibold text-[#1F1F1F]"
      }
    >
      {provider === "google" && <GoogleG className="size-3" />}
      {PROVIDER_NAME[provider]}
    </span>
  );
}

function UserSideCard({
  side,
  label,
  badge,
  kept,
  mergingIds,
}: {
  side: MergeUserPreview;
  label: string;
  badge: string;
  kept: boolean;
  mergingIds: ReadonlySet<string>;
}) {
  return (
    <section
      aria-label={label}
      className={`${card} flex min-w-0 flex-col gap-3 p-4 ${
        kept ? "border-sprout-500 ring-1 ring-sprout-500/20" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
            kept ? "bg-sprout-150 text-sprout-700" : "bg-peach text-ink"
          }`}
        >
          {badge}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <Avatar
          name={side.displayName}
          pictureUrl={side.pictureUrl}
          className="size-11 text-lg ring-2 ring-sprout-200"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{side.displayName}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {side.providers.map((provider) => (
              <ProviderTag key={provider} provider={provider} />
            ))}
          </div>
        </div>
      </div>
      <div className="border-t border-sprout-150 pt-3">
        <p className="text-xs font-bold text-ink-muted">
          {t("merge.groupsHeading", { count: side.groupCount })}
        </p>
        {side.groups.length === 0 ? (
          <p className="mt-2 text-xs text-ink-muted">{t("merge.noGroups")}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {side.groups.map((group) => (
              <li key={group.id} className="flex items-center gap-2.5 text-sm">
                <GroupAvatar
                  name={group.name}
                  groupId={group.id}
                  interactive={false}
                  className="size-7 text-xs"
                />
                <span className="min-w-0 flex-1 truncate font-medium">{group.name}</span>
                {(group.merging === true || mergingIds.has(group.id)) && (
                  <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                    {t("merge.mergingGroup")}
                  </span>
                )}
                {group.shared && (
                  <span className="shrink-0 rounded-full bg-sprout-100 px-2 py-0.5 text-[10px] font-bold text-sprout-700">
                    {t("merge.sharedGroup")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/**
 * Confirmation screen when linking an Identity that already belongs to another User (ADR 0017).
 * Shows both Users side by side (kept one on the left), each User's Groups, and on the Link code
 * path warns and requires ticking "both are me" before Merge becomes enabled.
 */
export function MergePage() {
  const { state, session, getPendingMerge, confirmMerge, cancelMerge } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const hasProof = state.status === "signedIn" || session.hasPendingMerge();
  const initial = hasProof
    ? ((location.state as { merge?: MergePreview } | null)?.merge ?? null)
    : null;
  const [preview, setPreview] = useState<MergePreview | null>(initial);
  const [loading, setLoading] = useState(hasProof && initial === null);
  const [loadError, setLoadError] = useState<ErrorCode | null>(
    hasProof ? null : "MERGE_PENDING_INVALID",
  );
  const [confirmed, setConfirmed] = useState(false);
  const [working, setWorking] = useState(false);
  const [submitError, setSubmitError] = useState<ErrorCode | null>(null);
  const [mergingGroupIds, setMergingGroupIds] = useState<string[] | null>(null);
  const tickId = useId();

  useEffect(() => {
    if (!hasProof || preview !== null) return;
    let active = true;
    setLoading(true);
    void getPendingMerge()
      .then((loaded) => {
        if (active) setPreview(loaded);
      })
      .catch((error: unknown) => {
        if (active) setLoadError(error instanceof ApiFailure ? error.code : "INTERNAL");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [hasProof, preview, getPendingMerge]);

  if (loading) return <Loading />;

  if ((!hasProof && mergingGroupIds === null) || preview === null) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-start gap-4">
        <h1 className="text-2xl font-bold md:text-3xl">{t("merge.title")}</h1>
        <p role="alert" className="w-full rounded-2xl bg-peach px-4 py-3 text-sm">
          {errorMessage(loadError ?? "MERGE_PENDING_INVALID")}
        </p>
        <Link
          to={state.status === "signedIn" ? "/settings" : "/sign-in"}
          replace
          className={`${secondaryButton} py-3`}
        >
          {t(state.status === "signedIn" ? "merge.backToSettings" : "merge.backToSignIn")}
        </Link>
      </div>
    );
  }

  const requiresTick = preview.path === "linkCode";
  const canConfirm = !working && (!requiresTick || confirmed);
  const mergingIds = new Set(mergingGroupIds ?? []);
  const linkedProvider =
    preview.other.providers.find((p) => !preview.kept.providers.includes(p)) ??
    preview.other.profileProvider;

  async function onConfirm() {
    if (preview === null) return;
    setSubmitError(null);
    setWorking(true);
    try {
      const result = await confirmMerge(preview.mergeId);
      if (result === null) return;
      if (result.mergingGroupIds.length === 0) {
        void navigate("/settings", { replace: true, state: { linked: linkedProvider } });
        return;
      }
      setMergingGroupIds(result.mergingGroupIds);
      setWorking(false);
    } catch (error) {
      const code = error instanceof ApiFailure ? error.code : "INTERNAL";
      if (code === "MERGE_PENDING_INVALID") {
        setPreview(null);
        setLoadError(code);
      } else {
        setSubmitError(code);
      }
      setWorking(false);
    }
  }

  async function onCancel() {
    if (preview === null) return;
    setSubmitError(null);
    setWorking(true);
    try {
      await cancelMerge(preview.mergeId);
      void navigate(state.status === "signedIn" ? "/settings" : "/sign-in", { replace: true });
    } catch (error) {
      const code = error instanceof ApiFailure ? error.code : "INTERNAL";
      if (code === "MERGE_PENDING_INVALID") {
        setPreview(null);
        setLoadError(code);
      } else {
        setSubmitError(code);
      }
      setWorking(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 pb-8">
      <h1 className="text-2xl font-black md:text-3xl">{t("merge.title")}</h1>

      <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-[1fr_auto_1fr]">
        <UserSideCard
          side={preview.kept}
          label={t("merge.keptCard")}
          badge={t("merge.keptBadge")}
          kept={true}
          mergingIds={mergingIds}
        />
        <div
          aria-hidden="true"
          className="flex items-center justify-center text-sprout-600 max-sm:rotate-90"
        >
          <ArrowLeft className="size-6" />
        </div>
        <UserSideCard
          side={preview.other}
          label={t("merge.otherCard")}
          badge={t("merge.otherBadge")}
          kept={false}
          mergingIds={mergingIds}
        />
      </div>

      {mergingGroupIds !== null ? (
        <>
          <p
            role="status"
            className="rounded-2xl border border-amber-300/80 bg-amber-50/80 px-4 py-3 text-sm font-medium text-amber-950"
          >
            {t("merge.partialNotice")}
          </p>
          <div className="flex gap-3">
            <Link
              to="/settings"
              replace
              state={{ linked: linkedProvider }}
              className={`${secondaryButton} flex-1 py-3.5 text-center`}
            >
              {t("merge.backToSettings")}
            </Link>
            <Link to="/groups" replace className={`${primaryButton} flex-1 py-3.5 text-center`}>
              {t("merge.viewGroups")}
            </Link>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm font-bold text-red-700">{t("merge.irreversible")}</p>

          {requiresTick && (
            <div className={`${card} flex flex-col gap-3 border-amber-300/80 bg-amber-50/70 p-4`}>
              <p className="text-sm font-medium text-amber-950">{t("merge.linkCodeWarning")}</p>
              <label
                htmlFor={tickId}
                className="flex cursor-pointer items-center gap-3 text-sm font-bold select-none"
              >
                <input
                  id={tickId}
                  type="checkbox"
                  checked={confirmed}
                  disabled={working}
                  onChange={(event) => {
                    setConfirmed(event.target.checked);
                  }}
                  className="size-4 accent-sprout-600"
                />
                {t("merge.bothAreMe")}
              </label>
            </div>
          )}

          {submitError !== null && (
            <p role="alert" className="rounded-2xl bg-peach px-4 py-3 text-sm">
              {errorMessage(submitError)}
            </p>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              disabled={working}
              onClick={() => {
                void onCancel();
              }}
              className={`${secondaryButton} flex-1 py-3.5`}
            >
              {t("merge.cancel")}
            </button>
            <button
              type="button"
              disabled={!canConfirm}
              onClick={() => {
                void onConfirm();
              }}
              className={`${primaryButton} flex-1 py-3.5`}
            >
              {working ? t("merge.confirming") : t("merge.confirm")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
