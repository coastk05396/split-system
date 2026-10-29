import type {
  Group,
  GroupInput,
  Invite,
  InvitePreview,
  JoinResult,
  Member,
  MemberPatch,
} from "@split/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { createApiClient, withJson } from "../api/client.js";
import { toApiFailure } from "../api/errors.js";
import { useAuth } from "../auth/AuthProvider.js";

/** TanStack Query hooks over the Worker's Group, Member and Invite routes (SPEC §5.1). */

export const groupKeys = {
  all: ["groups"] as const,
  group: (id: string) => ["groups", id] as const,
  members: (id: string) => ["groups", id, "members"] as const,
  invite: (id: string) => ["groups", id, "invite"] as const,
  preview: (token: string) => ["invites", token] as const,
};

function useApi() {
  const { session } = useAuth();
  return useMemo(() => createApiClient(session.fetch), [session]);
}

/** Reads a JSON answer, throwing ApiFailure for anything but 2xx. */
async function read<T>(call: Promise<Response>): Promise<T> {
  // Widened: the typed client only describes the success status.
  const res: Response = await call;
  if (!res.ok) throw await toApiFailure(res);
  return (await res.json()) as T;
}

async function send(call: Promise<Response>): Promise<void> {
  const res: Response = await call;
  if (!res.ok) throw await toApiFailure(res);
}

export function useGroups() {
  const api = useApi();
  return useQuery({ queryKey: groupKeys.all, queryFn: () => read<Group[]>(api.groups.$get()) });
}

export function useGroup(id: string) {
  const api = useApi();
  return useQuery({
    queryKey: groupKeys.group(id),
    queryFn: () => read<Group>(api.groups[":id"].$get({ param: { id } })),
  });
}

export function useMembers(id: string) {
  const api = useApi();
  return useQuery({
    queryKey: groupKeys.members(id),
    queryFn: () => read<Member[]>(api.groups[":id"].members.$get({ param: { id } })),
  });
}

/** The Group's live Invite, or null when none is live (the Worker answers 404). */
export function useInvite(id: string) {
  const api = useApi();
  return useQuery({
    queryKey: groupKeys.invite(id),
    queryFn: async () => {
      const res: Response = await api.groups[":id"].invite.$get({ param: { id } });
      if (res.status === 404) return null;
      if (!res.ok) throw await toApiFailure(res);
      return (await res.json()) as Invite;
    },
  });
}

export function useInvitePreview(token: string) {
  const api = useApi();
  return useQuery({
    queryKey: groupKeys.preview(token),
    queryFn: () => read<InvitePreview>(api.invites[":token"].$get({ param: { token } })),
    retry: false,
  });
}

export function useCreateGroup() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<GroupInput> & Pick<GroupInput, "name">) =>
      read<Group>(api.groups.$post({}, withJson(input))),
    onSuccess: (group) => {
      client.setQueryData(groupKeys.group(group.id), group);
      return client.invalidateQueries({ queryKey: groupKeys.all, exact: true });
    },
  });
}

export function useDeleteGroup(id: string) {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => send(api.groups[":id"].$delete({ param: { id } })),
    onSuccess: () => {
      client.removeQueries({ queryKey: groupKeys.group(id) });
      return client.invalidateQueries({ queryKey: groupKeys.all, exact: true });
    },
  });
}

/** Re-reads the Group and its Members after a Member change. */
function useRefreshGroup(id: string) {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: groupKeys.group(id) });
}

export function useAddPlaceholder(id: string) {
  const api = useApi();
  const refresh = useRefreshGroup(id);
  return useMutation({
    mutationFn: (name: string) =>
      read<Member>(api.groups[":id"].members.$post({ param: { id } }, withJson({ name }))),
    onSuccess: refresh,
  });
}

export function usePatchMember(id: string) {
  const api = useApi();
  const refresh = useRefreshGroup(id);
  return useMutation({
    mutationFn: ({ memberId, patch }: { memberId: string; patch: MemberPatch }) =>
      read<Member>(
        api.groups[":id"].members[":mid"].$patch({ param: { id, mid: memberId } }, withJson(patch)),
      ),
    onSuccess: refresh,
  });
}

export function useRemoveMember(id: string) {
  const api = useApi();
  const refresh = useRefreshGroup(id);
  return useMutation({
    mutationFn: (memberId: string) =>
      send(api.groups[":id"].members[":mid"].$delete({ param: { id, mid: memberId } })),
    onSuccess: refresh,
  });
}

export function useRegenerateInvite(id: string) {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => read<Invite>(api.groups[":id"].invite.$post({ param: { id } })),
    onSuccess: (invite) => {
      client.setQueryData(groupKeys.invite(id), invite);
    },
  });
}

/** Join as a new Member, or with `memberId` by claiming that Placeholder Member. */
export function useJoin(token: string) {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string | null) =>
      read<JoinResult>(
        memberId === null
          ? api.invites[":token"].join.$post({ param: { token } })
          : api.invites[":token"].claim.$post({ param: { token } }, withJson({ memberId })),
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: groupKeys.all }),
  });
}
