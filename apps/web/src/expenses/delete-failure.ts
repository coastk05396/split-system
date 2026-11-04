import { useSyncExternalStore } from "react";

/**
 * Why the last Expense delete was undone. A delete leaves its screen at once, so the reason
 * cannot live there; the Group page shows it, only for the Group it happened in. Kept out of the
 * query cache, which is persisted.
 */
let failure: { groupId: string; message: string } | null = null;
const listeners = new Set<() => void>();

function set(next: typeof failure) {
  failure = next;
  listeners.forEach((listener) => {
    listener();
  });
}

export const reportDeleteFailure = (groupId: string, message: string) => {
  set({ groupId, message });
};
export const dismissDeleteFailure = () => {
  set(null);
};

export function useDeleteFailure(groupId: string): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => (failure?.groupId === groupId ? failure.message : null),
  );
}
