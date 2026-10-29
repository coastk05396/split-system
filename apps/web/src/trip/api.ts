import type {
  Expense,
  ExpensePage,
  Group,
  GroupPatch,
  Stop,
  StopInput,
  StopPatch,
} from "@split/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ClientRequestOptions } from "hono/client";
import { withJson } from "../api/client.js";
import { groupKeys, read, send, useApi } from "../groups/api.js";

/** TanStack Query hooks over the Worker's Trip settings and Stop routes (SPEC §5.1). */

export const tripKeys = {
  stops: (id: string) => ["groups", id, "stops"] as const,
  /** Under the Group's key, so an Expense change that refreshes the Group refreshes these. */
  stopExpenses: (id: string) => ["groups", id, "stopExpenses"] as const,
};

/** A JSON body plus `If-Match`; the client's `init` replaces its headers wholesale. */
function withJsonIfMatch(body: unknown, updatedAt: number): ClientRequestOptions {
  return {
    init: {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", "If-Match": String(updatedAt) },
    },
  };
}

/** Every Stop of the Trip, in the Worker's day and time order. */
export function useStops(id: string) {
  const api = useApi();
  return useQuery({
    queryKey: tripKeys.stops(id),
    queryFn: () => read<Stop[]>(api.groups[":id"].stops.$get({ param: { id } })),
  });
}

/** The Group's Expenses that link to a Stop, read page by page. */
export function useStopExpenses(id: string) {
  const api = useApi();
  return useQuery({
    queryKey: tripKeys.stopExpenses(id),
    queryFn: async () => {
      const linked: Expense[] = [];
      let cursor: string | null = null;
      do {
        // The route reads `?cursor` without a validator, so the client's types omit `query`;
        // hc still sends any `query` it is given.
        const args: { param: { id: string }; query: { cursor?: string } } = {
          param: { id },
          query: cursor === null ? {} : { cursor },
        };
        const page: ExpensePage = await read<ExpensePage>(api.groups[":id"].expenses.$get(args));
        linked.push(...page.expenses.filter((e) => e.stopId !== null));
        cursor = page.nextCursor;
      } while (cursor !== null);
      return linked;
    },
  });
}

export function useCreateStop(id: string) {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: StopInput) =>
      read<Stop>(api.groups[":id"].stops.$post({ param: { id } }, withJson(input))),
    onSuccess: () => client.invalidateQueries({ queryKey: tripKeys.stops(id) }),
  });
}

export function usePatchStop(id: string) {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ stop, patch }: { stop: Stop; patch: StopPatch }) =>
      read<Stop>(
        api.groups[":id"].stops[":sid"].$patch(
          { param: { id, sid: stop.id } },
          withJsonIfMatch(patch, stop.updatedAt),
        ),
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: tripKeys.stops(id) }),
  });
}

export function useDeleteStop(id: string) {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (stopId: string) =>
      send(api.groups[":id"].stops[":sid"].$delete({ param: { id, sid: stopId } })),
    // Deleting a Stop unlinks its Expenses too.
    onSuccess: () => client.invalidateQueries({ queryKey: groupKeys.group(id) }),
  });
}

/** An Admin changes the Trip settings (destination, dates, notes). */
export function usePatchTrip(group: Group) {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: GroupPatch) =>
      read<Group>(
        api.groups[":id"].$patch(
          { param: { id: group.id } },
          withJsonIfMatch(patch, group.updatedAt),
        ),
      ),
    onSuccess: (next) => {
      client.setQueryData(groupKeys.group(group.id), next);
      return client.invalidateQueries({ queryKey: groupKeys.all, exact: true });
    },
  });
}
