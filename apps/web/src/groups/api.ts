import type {
  Group,
  GroupInput,
  Invite,
  InvitePreview,
  JoinResult,
  Member,
  MemberPatch,
} from "@split/shared";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryFunctionContext,
} from "@tanstack/react-query";
import { useMemo } from "react";
import { createApiClient, withJson } from "../api/client.js";
import { toApiFailure } from "../api/errors.js";
import { useAuth } from "../auth/AuthProvider.js";
import { readWithRev, useGroupLiveSync } from "./sync.js";

/** TanStack Query hooks over the Worker's Group, Member and Invite routes (SPEC §5.1). */

export const groupKeys = {
  all: ["groups"] as const,
  group: (id: string) => ["groups", id] as const,
  members: (id: string) => ["groups", id, "members"] as const,
  invite: (id: string) => ["groups", id, "invite"] as const,
  preview: (token: string) => ["invites", token] as const,
};

export function useApi() {
  const { session } = useAuth();
  return useMemo(() => createApiClient(session.fetch), [session]);
}

/** Reads a JSON answer, throwing ApiFailure for anything but 2xx. Records and checks X-Group-Rev. */
export async function read<T>(call: Promise<Response>, context?: QueryFunctionContext): Promise<T> {
  return readWithRev<T>(call, context);
}

export async function send(call: Promise<Response>): Promise<void> {
  const res: Response = await call;
  if (!res.ok) throw await toApiFailure(res);
}

export function useGroups() {
  const api = useApi();
  return useQuery({ queryKey: groupKeys.all, queryFn: () => read<Group[]>(api.groups.$get()) });
}

export function useGroup(id: string) {
  const api = useApi();
  useGroupLiveSync(id);
  return useQuery({
    queryKey: groupKeys.group(id),
    queryFn: (ctx) => read<Group>(api.groups[":id"].$get({ param: { id } }), ctx),
  });
}

export function useMembers(id: string) {
  const api = useApi();
  return useQuery({
    queryKey: groupKeys.members(id),
    queryFn: (ctx) => read<Member[]>(api.groups[":id"].members.$get({ param: { id } }), ctx),
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

const TEMP_ID_PREFIX = "tmp-";

/** A Member the browser has shown but the server has not yet confirmed. */
export function isUnsavedMember(member: Member): boolean {
  return member.id.startsWith(TEMP_ID_PREFIX);
}

type MembersEdit = {
  members: Member[];
  /** Takes back only this edit, leaving any later edit in place. */
  undo: (members: Member[]) => Member[];
  tempId?: string;
};
type MembersEditContext = { undo?: MembersEdit["undo"]; tempId?: string | undefined };

function isMember(data: unknown): data is Member {
  return (
    typeof data === "object" &&
    data !== null &&
    "id" in data &&
    typeof data.id === "string" &&
    "role" in data &&
    "status" in data &&
    "displayName" in data
  );
}

/**
 * Shows a Member change in the cached list at once, takes back just that change if the server
 * refuses it, and re-reads the Group once the last pending edit is done so the server's answer
 * wins. Only for changes the browser can compute exactly; never use it for anything that moves a
 * Balance (docs/adr/0004).
 */
function useOptimisticMembers<TVariables>(
  id: string,
  edit: (members: Member[], variables: TVariables) => MembersEdit,
) {
  const client = useQueryClient();
  const key = groupKeys.members(id);
  const mutationKey = [...key, "edit"] as const;
  return {
    mutationKey,
    onMutate: async (variables: TVariables): Promise<MembersEditContext> => {
      await client.cancelQueries({ queryKey: key });
      const current = client.getQueryData<Member[]>(key);
      if (current === undefined) return {};
      const { members, undo, tempId } = edit(current, variables);
      client.setQueryData(key, members);
      return { undo, tempId };
    },
    onSuccess: (data: unknown, _variables: TVariables, context: MembersEditContext | undefined) => {
      if (context?.tempId !== undefined && isMember(data)) {
        client.setQueryData<Member[]>(key, (members) =>
          members?.map((m) => (m.id === context.tempId ? data : m)),
        );
      }
    },
    onError: (_error: unknown, _variables: TVariables, context: MembersEditContext | undefined) => {
      const undo = context?.undo;
      if (undo !== undefined)
        client.setQueryData<Member[]>(key, (members) => members && undo(members));
    },
    onSettled: () => {
      // The edit being settled still counts as pending here; an early re-read could drop a later
      // edit's row, so only the last one to finish asks.
      if (client.isMutating({ mutationKey }) > 1) return;
      void client.invalidateQueries({ queryKey: key });
      void client.invalidateQueries({ queryKey: groupKeys.group(id) });
    },
  };
}

export function useAddPlaceholder(id: string) {
  const api = useApi();
  const optimistic = useOptimisticMembers(id, (members, name: string): MembersEdit => {
    const tempId = `${TEMP_ID_PREFIX}${crypto.randomUUID()}`;
    const unsaved: Member = {
      id: tempId,
      userId: null,
      displayName: name,
      pictureUrl: null,
      role: "member",
      status: "placeholder",
      balance: 0,
      isMe: false,
    };
    return {
      members: [...members, unsaved],
      undo: (current) => current.filter((member) => member.id !== tempId),
      tempId,
    };
  });
  return useMutation({
    mutationFn: (name: string) =>
      read<Member>(api.groups[":id"].members.$post({ param: { id } }, withJson({ name }))),
    ...optimistic,
  });
}

type PatchMemberVariables = { memberId: string; patch: MemberPatch };

export function usePatchMember(id: string) {
  const api = useApi();
  const optimistic = useOptimisticMembers(
    id,
    (members, { memberId, patch }: PatchMemberVariables): MembersEdit => {
      const before = members.find((member) => member.id === memberId);
      const apply = (member: Member): Member =>
        member.id === memberId
          ? {
              ...member,
              role: patch.role ?? member.role,
              displayName: patch.placeholderName ?? member.displayName,
            }
          : member;
      return {
        members: members.map(apply),
        undo: (current) =>
          current.map((member) =>
            member.id === memberId && before !== undefined
              ? { ...member, role: before.role, displayName: before.displayName }
              : member,
          ),
      };
    },
  );
  return useMutation({
    mutationFn: ({ memberId, patch }: PatchMemberVariables) =>
      read<Member>(
        api.groups[":id"].members[":mid"].$patch({ param: { id, mid: memberId } }, withJson(patch)),
      ),
    ...optimistic,
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

export function useEnsureInvite(id: string) {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => read<Invite>(api.groups[":id"].invite.ensure.$post({ param: { id } })),
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
