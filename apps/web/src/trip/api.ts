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
import { withJson } from "../api/client.js";
import {
  abortable,
  groupKeys,
  readWithRev as read,
  refreshGroup,
  send,
  tripKeys,
  useGroupData,
} from "../groups/data.js";

/** TanStack Query hooks over the Worker's Trip settings and Stop routes (SPEC §5.1). */

/** Every Stop of the Trip, in the Worker's day and time order. */
export function useStops(id: string) {
  const { api } = useGroupData();
  return useQuery({
    queryKey: tripKeys.stops(id),
    queryFn: (ctx) =>
      read<Stop[]>(api.groups[":id"].stops.$get({ param: { id } }, { init: abortable(ctx) }), ctx),
  });
}

/** The Group's Expenses that link to a Stop, read page by page. */
export function useStopExpenses(id: string) {
  const { api } = useGroupData();
  return useQuery({
    queryKey: tripKeys.stopExpenses(id),
    queryFn: async (ctx) => {
      const linked: Expense[] = [];
      let cursor: string | null = null;
      do {
        // The route reads `?cursor` without a validator, so the client's types omit `query`;
        // hc still sends any `query` it is given.
        const args: { param: { id: string }; query: { cursor?: string } } = {
          param: { id },
          query: cursor === null ? {} : { cursor },
        };
        const page: ExpensePage = await read<ExpensePage>(
          api.groups[":id"].expenses.$get(args, { init: abortable(ctx) }),
          ctx,
        );
        linked.push(...page.expenses.filter((e) => e.stopId !== null));
        cursor = page.nextCursor;
      } while (cursor !== null);
      return linked;
    },
  });
}

export function useCreateStop(id: string) {
  const { api } = useGroupData();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: StopInput) =>
      read<Stop>(api.groups[":id"].stops.$post({ param: { id } }, withJson(input))),
    onSuccess: () => refreshGroup(client, id),
  });
}

export function usePatchStop(id: string) {
  const { api } = useGroupData();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ stop, patch }: { stop: Stop; patch: StopPatch }) =>
      read<Stop>(
        api.groups[":id"].stops[":sid"].$patch(
          { param: { id, sid: stop.id } },
          withJson(patch, { "If-Match": String(stop.updatedAt) }),
        ),
      ),
    onSuccess: () => refreshGroup(client, id),
  });
}

export function useDeleteStop(id: string) {
  const { api } = useGroupData();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (stopId: string) =>
      send(api.groups[":id"].stops[":sid"].$delete({ param: { id, sid: stopId } })),
    // Deleting a Stop unlinks its Expenses too.
    onSuccess: () => refreshGroup(client, id),
  });
}

/** An Admin changes the Trip settings (destination, dates, notes). */
export function usePatchTrip(group: Group) {
  const { api } = useGroupData();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: GroupPatch) =>
      read<Group>(
        api.groups[":id"].$patch(
          { param: { id: group.id } },
          withJson(patch, { "If-Match": String(group.updatedAt) }),
        ),
      ),
    onSuccess: (next) => {
      client.setQueryData(groupKeys.group(group.id), next);
      return refreshGroup(client, group.id);
    },
  });
}
