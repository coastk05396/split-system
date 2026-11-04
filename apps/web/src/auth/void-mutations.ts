import type { QueryClient } from "@tanstack/react-query";

/**
 * Called on sign-out: a write still waiting for its answer belongs to the account that left, so
 * its answer must not reach the cache the next account will use. Its own callbacks are dropped
 * (TanStack reads them again when the answer arrives); the request itself cannot be recalled.
 */
export function voidMutationsInFlight(queryClient: QueryClient) {
  for (const mutation of queryClient.getMutationCache().getAll()) {
    if (mutation.state.status !== "pending") continue;
    const kept: Record<string, unknown> = { ...mutation.options };
    kept.onSuccess = undefined;
    kept.onError = undefined;
    kept.onSettled = undefined;
    mutation.setOptions(kept);
  }
}
