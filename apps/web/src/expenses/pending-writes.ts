import type { CurrencyCode } from "@split/shared";
import { useMemo, useSyncExternalStore } from "react";

/**
 * Writes the server has not answered yet, shown by the Group page. They live here and not in
 * the query cache, which is persisted: a reload must not bring back a row that never existed.
 */

export interface PendingSave {
  key: string;
  groupId: string;
  /** The Expense being edited; null for a new one. */
  expenseId: string | null;
  description: string;
  category: string;
  amount: number;
  currency: CurrencyCode;
  status: "saving" | "failed";
  error: string | null;
  retry: () => void;
}

const NONE: readonly string[] = [];
let saves: readonly PendingSave[] = [];
let deletes: ReadonlyMap<string, readonly string[]> = new Map();
const listeners = new Set<() => void>();

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

export function startSave(save: PendingSave) {
  saves = [...saves.filter((s) => s.key !== save.key), save];
  emit();
}

export function updateSave(key: string, patch: Partial<Pick<PendingSave, "status" | "error">>) {
  saves = saves.map((s) => (s.key === key ? { ...s, ...patch } : s));
  emit();
}

export function removeSave(key: string) {
  saves = saves.filter((s) => s.key !== key);
  emit();
}

export function markDeleting(groupId: string, expenseId: string) {
  deletes = new Map(deletes).set(groupId, [...(deletes.get(groupId) ?? NONE), expenseId]);
  emit();
}

export function unmarkDeleting(groupId: string, expenseId: string) {
  const left = (deletes.get(groupId) ?? NONE).filter((id) => id !== expenseId);
  deletes = new Map(deletes).set(groupId, left.length === 0 ? NONE : left);
  emit();
}

/** Signing out forgets everything still waiting. */
/** Counts sign-outs, so an answer to a write asked by an earlier account can be told apart. */
let epoch = 0;

export const currentEpoch = () => epoch;

export function clearPendingWrites() {
  epoch += 1;
  saves = [];
  deletes = new Map();
  justSaved = null;
  emit();
}

/** The saves of one Group still waiting or failed, oldest first. */
export function usePendingSaves(groupId: string): readonly PendingSave[] {
  const all = useSyncExternalStore(subscribe, () => saves);
  return useMemo(() => all.filter((s) => s.groupId === groupId), [all, groupId]);
}

/** The Expenses of one Group whose delete has been asked for and not yet answered. */
export function usePendingDeletes(groupId: string): readonly string[] {
  return useSyncExternalStore(subscribe, () => deletes.get(groupId) ?? NONE);
}

/** The Expense just saved, so the Group page can highlight it and show its share note. */
let justSaved: { groupId: string; expenseId: string } | null = null;

export function announceSaved(groupId: string, expenseId: string) {
  const mine = { groupId, expenseId };
  justSaved = mine;
  emit();
  // A hint nobody picked up (the user left) must not greet them on a later visit.
  setTimeout(() => {
    if (justSaved === mine) clearJustSaved();
  }, 60_000);
}

export function clearJustSaved() {
  justSaved = null;
  emit();
}

export function useJustSaved(groupId: string): string | undefined {
  return useSyncExternalStore(subscribe, () =>
    justSaved?.groupId === groupId ? justSaved.expenseId : undefined,
  );
}
