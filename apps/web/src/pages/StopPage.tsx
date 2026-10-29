import * as Dialog from "@radix-ui/react-dialog";
import type { Group, Stop, StopInput } from "@split/shared";
import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useGroup } from "../groups/api.js";
import { failureMessage, LoadError, Loading, ScreenHeader, secondaryButton } from "../groups/ui.js";
import { t } from "../i18n/messages.js";
import { useCreateStop, useDeleteStop, usePatchStop, useStops } from "../trip/api.js";
import { stopCategories } from "../trip/categories.js";
import { localToday } from "../trip/days.js";
import { nullable, StopForm, type StopValues } from "../trip/StopForm.js";

/** Back to the Trip tab on the Stop's day. */
function planPath(groupId: string, day: string): string {
  return `/groups/${groupId}?tab=trip&day=${day}`;
}

/** Screen 27 as amended (加入一站): any Member adds a Stop to a day of the Trip. */
export function NewStopPage() {
  const id = useParams().id ?? "";
  const group = useGroup(id);
  if (group.isPending) return <Loading />;
  if (group.isError) return <LoadError error={group.error} onRetry={() => void group.refetch()} />;
  return <NewStop group={group.data} />;
}

function NewStop({ group }: { group: Group }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const create = useCreateStop(group.id);
  const initial: StopValues = {
    dayDate: params.get("day") ?? group.tripStartDate ?? localToday(),
    startTime: "",
    endTime: "",
    title: "",
    category: stopCategories[0] ?? "",
    locationName: "",
    notes: "",
  };

  function submit(values: StopValues) {
    const input: StopInput = {
      dayDate: values.dayDate,
      title: values.title.trim(),
      category: values.category,
    };
    const startTime = nullable(values.startTime);
    const endTime = nullable(values.endTime);
    const locationName = nullable(values.locationName);
    const notes = nullable(values.notes);
    if (startTime !== null) input.startTime = startTime;
    if (endTime !== null) input.endTime = endTime;
    if (locationName !== null) input.locationName = locationName;
    if (notes !== null) input.notes = notes;
    create.mutate(input, {
      onSuccess: (stop) => void navigate(planPath(group.id, stop.dayDate), { replace: true }),
    });
  }

  return (
    <>
      <ScreenHeader
        title={t("stop.newTitle")}
        back={planPath(group.id, initial.dayDate)}
        subtitle={group.tripDestination ?? group.name}
      />
      <StopForm
        group={group}
        initial={initial}
        submitLabel="stop.add"
        pending={create.isPending}
        error={create.error}
        onSubmit={submit}
      />
    </>
  );
}

/** Any Member edits or deletes a Stop; its Expenses stay, unlinked (decision 13). */
export function EditStopPage() {
  const params = useParams();
  const id = params.id ?? "";
  const group = useGroup(id);
  const stops = useStops(id);
  if (group.isPending || stops.isPending) return <Loading />;
  if (group.isError) return <LoadError error={group.error} onRetry={() => void group.refetch()} />;
  if (stops.isError) return <LoadError error={stops.error} onRetry={() => void stops.refetch()} />;
  const stop = stops.data.find((s) => s.id === params.sid);
  if (stop === undefined) {
    return (
      <>
        <ScreenHeader title={t("stop.editTitle")} back={`/groups/${id}?tab=trip`} />
        <p role="alert">{t("stop.notFound")}</p>
      </>
    );
  }
  return <EditStop key={`${stop.id}:${String(stop.updatedAt)}`} group={group.data} stop={stop} />;
}

function EditStop({ group, stop }: { group: Group; stop: Stop }) {
  const navigate = useNavigate();
  const patch = usePatchStop(group.id);
  const initial: StopValues = {
    dayDate: stop.dayDate,
    startTime: stop.startTime ?? "",
    endTime: stop.endTime ?? "",
    title: stop.title,
    category: stop.category,
    locationName: stop.locationName ?? "",
    notes: stop.notes ?? "",
  };

  function submit(values: StopValues) {
    patch.mutate(
      {
        stop,
        patch: {
          dayDate: values.dayDate,
          title: values.title.trim(),
          category: values.category,
          startTime: nullable(values.startTime),
          endTime: nullable(values.endTime),
          locationName: nullable(values.locationName),
          notes: nullable(values.notes),
        },
      },
      { onSuccess: (next) => void navigate(planPath(group.id, next.dayDate), { replace: true }) },
    );
  }

  return (
    <>
      <ScreenHeader
        title={t("stop.editTitle")}
        back={planPath(group.id, stop.dayDate)}
        subtitle={group.tripDestination ?? group.name}
      />
      <StopForm
        group={group}
        initial={initial}
        submitLabel="stop.save"
        pending={patch.isPending}
        error={patch.error}
        onSubmit={submit}
        footer={<DeleteStopDialog group={group} stop={stop} />}
      />
    </>
  );
}

function DeleteStopDialog({ group, stop }: { group: Group; stop: Stop }) {
  const navigate = useNavigate();
  const remove = useDeleteStop(group.id);
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className={`${secondaryButton} text-red-700`}>
        {t("stop.delete")}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay glass-overlay fixed inset-0 z-20" />
        <Dialog.Content className="dialog-content glass-dialog fixed inset-x-4 top-1/2 z-30 mx-auto flex max-w-md -translate-y-1/2 flex-col gap-4 rounded-3xl border border-sprout-200/80 p-6 text-ink">
          <Dialog.Title className="text-xl font-bold">
            {t("stop.deleteTitle", { title: stop.title })}
          </Dialog.Title>
          <Dialog.Description className="text-ink-muted">{t("stop.deleteBody")}</Dialog.Description>
          {remove.isError && (
            <p role="alert" className="text-red-700">
              {failureMessage(remove.error)}
            </p>
          )}
          <div className="flex gap-3">
            <Dialog.Close className={`${secondaryButton} flex-1 py-3`}>
              {t("stop.cancel")}
            </Dialog.Close>
            <button
              type="button"
              disabled={remove.isPending}
              onClick={() => {
                remove.mutate(stop.id, {
                  onSuccess: () =>
                    void navigate(planPath(group.id, stop.dayDate), { replace: true }),
                });
              }}
              className="press-pill flex flex-1 items-center justify-center rounded-full bg-red-700 py-3 font-bold text-white hover:bg-red-700/90 disabled:opacity-50"
            >
              {t("stop.deleteConfirm")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
