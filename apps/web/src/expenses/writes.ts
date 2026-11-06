import type { CurrencyCode, Expense, ExpenseInput, ExpensePage } from "@split/shared";
import { type InfiniteData, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { withJson } from "../api/client.js";
import { ApiFailure, toApiFailure } from "../api/errors.js";
import { expenseKeys, readWithRev as read, refreshGroup, useGroupData } from "../groups/data.js";
import { failureMessage } from "../groups/ui.js";
import { t } from "../i18n/messages.js";
import { sameEdit } from "./edit-reconcile.js";
import type { SavedShare } from "./expense-sharing.js";

export interface PendingSave {
  key: string;
  groupId: string;
  expenseId: string | null;
  description: string;
  category: string;
  amount: number;
  currency: CurrencyCode;
  status: "saving" | "failed";
  error: string | null;
  retry: () => void;
  discard: () => void;
}

const NONE: readonly string[] = [];
let saves: readonly PendingSave[] = [];
let deletes: ReadonlyMap<string, readonly string[]> = new Map();
let failure: { groupId: string; message: string } | null = null;
let justSaved: { groupId: string; expenseId: string } | null = null;
const shares = new Map<string, { groupId: string; result: Promise<SavedShare | null> }>();
const listeners = new Set<() => void>();
let epoch = 0;

function emit() {
  listeners.forEach((listener) => {
    listener();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function removeSave(key: string) {
  saves = saves.filter((save) => save.key !== key);
  emit();
}

function updateSave(key: string, patch: Pick<PendingSave, "status" | "error">) {
  saves = saves.map((save) => (save.key === key ? { ...save, ...patch } : save));
  emit();
}

function unmarkDeleting(groupId: string, expenseId: string) {
  deletes = new Map(deletes).set(
    groupId,
    (deletes.get(groupId) ?? NONE).filter((id) => id !== expenseId),
  );
  emit();
}

/** Shared with share preparation so awaited work cannot continue as another User. */
export const currentEpoch = () => epoch;

/** Transient Expense state never enters the persisted query cache. */
export function clearExpenseWrites() {
  epoch += 1;
  saves = [];
  deletes = new Map();
  failure = null;
  justSaved = null;
  shares.clear();
  emit();
}

export function usePendingSaves(groupId: string): readonly PendingSave[] {
  const all = useSyncExternalStore(subscribe, () => saves);
  return useMemo(() => all.filter((save) => save.groupId === groupId), [all, groupId]);
}

export function usePendingDeletes(groupId: string): readonly string[] {
  return useSyncExternalStore(subscribe, () => deletes.get(groupId) ?? NONE);
}

export function useJustSaved(groupId: string): string | undefined {
  return useSyncExternalStore(subscribe, () =>
    justSaved?.groupId === groupId ? justSaved.expenseId : undefined,
  );
}

export function useDeleteFailure(groupId: string) {
  const message = useSyncExternalStore(subscribe, () =>
    failure?.groupId === groupId ? failure.message : null,
  );
  return {
    message,
    dismiss: () => {
      if (failure?.groupId === groupId) {
        failure = null;
        emit();
      }
    },
  };
}

type SaveRequest =
  | { kind: "create"; input: ExpenseInput; idempotencyKey: string }
  | { kind: "edit"; input: ExpenseInput; expense: Expense };

interface SaveAttempt {
  request: SaveRequest;
  key: string;
  epoch: number;
  onSaved: (expense: Expense) => void | Promise<void>;
}

/** A Group's writes own retry identity, pending rows, cache updates and late-answer guards. */
export function useExpenseWrites(groupId: string) {
  const { api } = useGroupData();
  const client = useQueryClient();
  const saving = useRef(false);
  const saveMutation = useMutation({
    mutationFn: async (attempt: SaveAttempt) => {
      if (attempt.epoch !== epoch) throw new Error("Expense write belongs to a signed-out User");
      const request = attempt.request;
      if (request.kind === "create") {
        return read<Expense>(
          api.groups[":id"].expenses.$post(
            { param: { id: groupId } },
            withJson(request.input, { "Idempotency-Key": request.idempotencyKey }),
          ),
        );
      }
      const param = { id: groupId, eid: request.expense.id };
      try {
        return await read<Expense>(
          api.groups[":id"].expenses[":eid"].$patch(
            { param },
            withJson(request.input, { "If-Match": String(request.expense.updatedAt) }),
          ),
        );
      } catch (error) {
        if (attempt.epoch !== epoch) throw error;
        if (!(error instanceof ApiFailure) || error.code !== "EDIT_CONFLICT") throw error;
        // A lost edit answer meets its own version conflict; matching content means success.
        const held = await read<Expense>(api.groups[":id"].expenses[":eid"].$get({ param }));
        if (sameEdit(request.input, held)) return held;
        throw error;
      }
    },
    onSuccess: (expense, attempt) => {
      if (attempt.epoch !== epoch) return;
      client.setQueryData(expenseKeys.one(groupId, expense.id), expense);
      client.setQueryData<InfiniteData<ExpensePage>>(expenseKeys.list(groupId), (data) => {
        if (!data || data.pages.some((page) => page.expenses.some((row) => row.id === expense.id)))
          return data;
        const [first, ...rest] = data.pages;
        return first === undefined
          ? data
          : { ...data, pages: [{ ...first, expenses: [expense, ...first.expenses] }, ...rest] };
      });
      void refreshGroup(client, groupId);
      removeSave(attempt.key);
      void attempt.onSaved(expense);
    },
    onError: (error, attempt) => {
      if (attempt.epoch !== epoch) return;
      updateSave(attempt.key, {
        status: "failed",
        error: error instanceof ApiFailure ? failureMessage(error) : t("expense.networkError"),
      });
    },
    onSettled: () => {
      saving.current = false;
    },
  });
  const deleteMutation = useMutation({
    mutationFn: async (attempt: { expenseId: string; epoch: number }) => {
      if (attempt.epoch !== epoch) throw new Error("Expense write belongs to a signed-out User");
      const res: Response = await api.groups[":id"].expenses[":eid"].$delete({
        param: { id: groupId, eid: attempt.expenseId },
      });
      if (!res.ok) throw await toApiFailure(res);
    },
    onError: (error, attempt) => {
      if (attempt.epoch !== epoch) return;
      unmarkDeleting(groupId, attempt.expenseId);
      failure = { groupId, message: t("expense.deleteFailed", { reason: failureMessage(error) }) };
      emit();
      void refreshGroup(client, groupId);
    },
    onSuccess: (_, attempt) => {
      if (attempt.epoch !== epoch) return;
      client.removeQueries({ queryKey: expenseKeys.one(groupId, attempt.expenseId) });
      client.setQueryData<InfiniteData<ExpensePage>>(expenseKeys.list(groupId), (data) =>
        data === undefined
          ? data
          : {
              ...data,
              pages: data.pages.map((page) => ({
                ...page,
                expenses: page.expenses.filter((expense) => expense.id !== attempt.expenseId),
              })),
            },
      );
      unmarkDeleting(groupId, attempt.expenseId);
      void refreshGroup(client, groupId);
    },
  });
  return {
    isPending: saveMutation.isPending,
    save({
      input,
      expense,
      onSaved,
    }: {
      input: ExpenseInput;
      expense: Expense | undefined;
      onSaved: SaveAttempt["onSaved"];
    }) {
      if (saving.current) return false;
      const key = crypto.randomUUID();
      const attempt: SaveAttempt = {
        request:
          expense === undefined
            ? { kind: "create", input, idempotencyKey: key }
            : { kind: "edit", input, expense },
        key,
        epoch,
        onSaved,
      };
      const retry = () => {
        if (attempt.epoch !== epoch || saving.current || !saves.some((save) => save.key === key))
          return;
        saving.current = true;
        updateSave(key, { status: "saving", error: null });
        saveMutation.mutate(attempt);
      };
      saves = [
        ...saves,
        {
          key,
          groupId,
          expenseId: expense?.id ?? null,
          description: input.description,
          category: input.category,
          amount: input.originalAmount,
          currency: input.originalCurrency,
          status: "saving",
          error: null,
          retry,
          discard: () => {
            removeSave(key);
          },
        },
      ];
      retry();
      return true;
    },
    delete(expenseId: string) {
      if ((deletes.get(groupId) ?? NONE).includes(expenseId)) return false;
      failure = null;
      deletes = new Map(deletes).set(groupId, [...(deletes.get(groupId) ?? NONE), expenseId]);
      emit();
      deleteMutation.mutate({ expenseId, epoch });
      return true;
    },
  };
}

/** Share preparation and its saved hint are retained together, outside persisted queries. */
export function rememberShare(
  groupId: string,
  expenseId: string,
  result: Promise<SavedShare | null>,
) {
  const pending = { groupId, result };
  shares.set(expenseId, pending);
  const hint = { groupId, expenseId };
  justSaved = hint;
  emit();
  setTimeout(() => {
    if (shares.get(expenseId) === pending) shares.delete(expenseId);
    if (justSaved === hint) {
      justSaved = null;
      emit();
    }
  }, 60_000);
}

/** Claimed shares may finish after their hint expires, but never after their Group or User leaves. */
export function useSavedShares(groupId: string) {
  const expenseId = useJustSaved(groupId);
  const [saved, setSaved] = useState<{ expenseId: string; share: SavedShare }[]>([]);
  const waiting = useMemo(() => new Set<string>(), [groupId]);
  const active = useRef<string | null>(null);
  useEffect(() => {
    const asked = epoch;
    active.current = groupId;
    return () => {
      active.current = null;
      // StrictMode's immediate effect replay keeps this Group mounted.
      queueMicrotask(() => {
        if (active.current === groupId || asked !== epoch) return;
        waiting.clear();
        for (const [id, pending] of shares) {
          if (pending.groupId === groupId) shares.delete(id);
        }
        if (justSaved?.groupId === groupId) {
          justSaved = null;
          emit();
        }
      });
    };
  }, [groupId, waiting]);
  useEffect(() => {
    if (expenseId === undefined) return;
    const pending = shares.get(expenseId);
    if (pending?.groupId !== groupId) return;
    const asked = epoch;
    waiting.add(expenseId);
    void pending.result
      .then((share) => {
        if (
          share === null ||
          asked !== epoch ||
          active.current !== groupId ||
          !waiting.has(expenseId)
        )
          return;
        setSaved((all) =>
          all.some((row) => row.expenseId === expenseId) ? all : [...all, { expenseId, share }],
        );
      })
      .catch(() => undefined)
      .finally(() => {
        waiting.delete(expenseId);
        if (shares.get(expenseId) === pending) shares.delete(expenseId);
      });
  }, [expenseId, groupId, waiting]);
  const dismiss = useCallback(() => {
    setSaved((all) => all.slice(1));
  }, []);
  return { first: saved[0], dismiss };
}
