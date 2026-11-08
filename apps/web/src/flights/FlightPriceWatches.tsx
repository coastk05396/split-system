import * as Dialog from "@radix-ui/react-dialog";
import {
  CURRENCIES,
  formatAmount,
  intentToQuery,
  parseAmount,
  type CreateFlightWatch,
  type FlightCard,
  type FlightWatchesReply,
  type FlightPriceWatch,
} from "@split/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type SubmitEvent } from "react";
import { useDeps } from "../app/AppProviders.js";
import { useAuth } from "../auth/AuthProvider.js";
import { readWithRev, send } from "../groups/data.js";
import { failureMessage, input, primaryButton, secondaryButton } from "../groups/ui.js";
import { t } from "../i18n/messages.js";
import { friendlyRange } from "./dates.js";

/** Saves a Price Watch; the caller refreshes the watch list. */
export function useCreateWatch() {
  const { session } = useAuth();
  return (watch: CreateFlightWatch) =>
    readWithRev<FlightPriceWatch>(
      session.fetch("/api/v1/flights/watches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(watch),
      }),
    );
}

export function FlightPriceWatchButton({
  card,
  onWatch,
}: {
  card: FlightCard;
  onWatch: (card: FlightCard) => void;
}) {
  return (
    <button
      type="button"
      aria-label={t("flight.watch")}
      className="press-pill grid size-11 shrink-0 place-items-center text-sprout-900 focus-visible:outline-2 focus-visible:outline-sprout-700"
      onClick={() => {
        onWatch(card);
      }}
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="size-5 fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"
      >
        <path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7M10 20a2 2 0 0 0 4 0" />
      </svg>
    </button>
  );
}
export function FlightPriceWatches({
  card,
  onClose,
}: {
  card: FlightCard | null;
  onClose: () => void;
}) {
  const { session, state } = useAuth();
  const userId = state.status === "signedIn" ? state.user.id : null;
  const { webPush } = useDeps();
  const queryClient = useQueryClient();
  const watches = useQuery({
    queryKey: ["flights", "watches", userId],
    queryFn: ({ signal }) =>
      readWithRev<FlightWatchesReply>(session.fetch("/api/v1/flights/watches", { signal })),
  });
  const vapid = useQuery({
    queryKey: ["flights", "vapid"],
    queryFn: () =>
      readWithRev<{ publicKey: string | null }>(session.fetch("/api/v1/flights/vapid-public-key")),
  });
  const cancel = useMutation({
    mutationFn: async (id: string) => {
      await send(session.fetch(`/api/v1/flights/watches/${id}`, { method: "DELETE" }));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["flights", "watches"] }),
  });
  return (
    <>
      <details className="mt-6 surface-card rounded-3xl border border-sprout-200 bg-white p-5">
        <summary className="cursor-pointer font-bold">{t("flight.myWatches")}</summary>
        <section aria-label={t("flight.myWatches")} className="mt-4 grid gap-3">
          {watches.isPending && <p role="status">{t("app.loading")}</p>}
          {(watches.isError || cancel.isError) && (
            <p role="alert">{failureMessage(watches.error ?? cancel.error)}</p>
          )}
          {watches.data?.watches.length === 0 && (
            <p className="text-ink-muted">{t("flight.noWatches")}</p>
          )}
          {watches.data?.watches.map((watch) => (
            <WatchRow
              key={watch.id}
              watch={watch}
              onCancel={() => {
                cancel.mutate(watch.id);
              }}
              busy={cancel.isPending}
            />
          ))}
        </section>
      </details>
      <Dialog.Root
        open={card !== null}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay glass-overlay fixed inset-0 z-20" />
          <Dialog.Content className="dialog-content glass-dialog fixed inset-x-0 bottom-0 z-30 mx-auto flex max-h-[85dvh] max-w-md flex-col gap-4 overflow-y-auto rounded-t-3xl border border-sprout-200 p-6 text-ink md:top-1/2 md:bottom-auto md:-translate-y-1/2 md:rounded-3xl">
            {card && (
              <WatchForm
                key={card.url}
                card={card}
                publicKey={vapid.data?.publicKey ?? null}
                available={webPush !== undefined}
                onClose={onClose}
              />
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
function WatchRow({
  watch,
  onCancel,
  busy,
}: {
  watch: FlightPriceWatch;
  onCancel: () => void;
  busy: boolean;
}) {
  return (
    <article className="grid gap-2 rounded-2xl bg-sprout-50 p-4">
      <p className="font-bold">
        {watch.intent.origin} → {watch.intent.destination}
      </p>
      <p className="text-sm">
        {friendlyRange(watch.intent.departureDate, watch.intent.returnDate)}
      </p>
      <p className="text-sm">
        {t("flight.watchCondition", {
          amount: formatAmount(watch.targetFare, watch.intent.currency),
        })}
      </p>
      <p className="text-sm text-ink-muted">
        {watch.latestFare === null
          ? t("flight.notChecked")
          : t("flight.latestFare", {
              amount: formatAmount(watch.latestFare, watch.intent.currency),
            })}
      </p>
      {watch.status === "triggered" && <p className="font-bold">{t("flight.watchTriggered")}</p>}
      <button type="button" onClick={onCancel} disabled={busy} className={secondaryButton}>
        {t("flight.cancelWatch")}
      </button>
    </article>
  );
}
function WatchForm({
  card,
  publicKey,
  available,
  onClose,
}: {
  card: FlightCard;
  publicKey: string | null;
  available: boolean;
  onClose: () => void;
}) {
  const { session } = useAuth();
  const { webPush, line } = useDeps();
  const queryClient = useQueryClient();
  const createWatch = useCreateWatch();
  // Browser Web Push does not exist inside LIFF: there the alert goes through LINE Push.
  const inLine = line.isInClient();
  const linePush = useQuery({
    queryKey: ["flights", "line-push"],
    enabled: inLine,
    queryFn: () => readWithRev<{ available: boolean }>(session.fetch("/api/v1/flights/line-push")),
  });
  const lineMode = inLine && linePush.data?.available === true;
  const [target, setTarget] = useState(
    String(
      Math.max(1, Math.floor(card.price * 0.85)) / 10 ** CURRENCIES[card.intent.currency].decimals,
    ),
  );
  const [invalid, setInvalid] = useState(false);
  const save = useMutation({
    mutationFn: async (amount: number) => {
      const watch = {
        intent: card.intent,
        baselineFare: card.price,
        targetFare: amount,
      };
      if (lineMode) return createWatch({ ...watch, channel: "line_push" });
      if (!webPush || !publicKey) throw new Error("Push unavailable");
      const subscription = await webPush.subscribe(publicKey);
      await send(
        session.fetch("/api/v1/flights/push-subscriptions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(subscription),
        }),
      );
      return createWatch({ ...watch, channel: "web_push" });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["flights", "watches"] });
      onClose();
    },
  });
  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = parseAmount(target, card.intent.currency);
    setInvalid(!amount.ok);
    if (amount.ok) save.mutate(amount.value);
  }
  return (
    <form onSubmit={submit} className="grid gap-4">
      <Dialog.Title className="text-xl font-bold">{t("flight.watch")}</Dialog.Title>
      <Dialog.Description className="text-ink-muted">
        {t("flight.watchDescription")}
      </Dialog.Description>
      <p className="font-bold">
        {card.intent.origin} → {card.intent.destination}
      </p>
      <label className="grid gap-1 font-bold">
        {t("flight.targetFare")}
        <input
          className={input}
          type="number"
          min={10 ** -CURRENCIES[card.intent.currency].decimals}
          step={10 ** -CURRENCIES[card.intent.currency].decimals}
          value={target}
          onChange={(event) => {
            setTarget(event.target.value);
          }}
          required
        />
      </label>
      <p className="text-sm text-ink-muted">{card.intent.currency}</p>
      {!inLine && (!available || !publicKey) && <p role="status">{t("flight.pushUnavailable")}</p>}
      {inLine && linePush.isSuccess && !lineMode && <p role="status">{t("flight.lineFull")}</p>}
      {(save.isError || invalid) && (
        <p role="alert">
          {save.error instanceof Error && !("code" in save.error)
            ? t("flight.pushFailed")
            : invalid
              ? t("flight.invalidTarget")
              : failureMessage(save.error)}
        </p>
      )}
      {inLine && linePush.isSuccess && !lineMode ? (
        <button
          className={primaryButton}
          type="button"
          onClick={() => {
            void line.openExternal(
              `${window.location.origin}/travel?${intentToQuery(card.intent)}`,
            );
          }}
        >
          {t("flight.openBrowser")}
        </button>
      ) : (
        <button
          className={primaryButton}
          type="submit"
          disabled={save.isPending || (inLine ? !lineMode : !available || !publicKey)}
        >
          {t(inLine ? "flight.enableLine" : "flight.enablePush")}
        </button>
      )}
      <Dialog.Close className={secondaryButton}>{t("common.cancel")}</Dialog.Close>
    </form>
  );
}
