import { type Group, MAX_GROUPS_PER_USER, MAX_MEMBER_PREVIEW } from "@split/shared";
import { inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { users } from "../db/schema.js";
import type { Bindings } from "../env.js";
import { ApiError } from "../errors.js";
import { groupLedger } from "../ledger-client.js";
import type { MemberRow } from "./membership.js";

export { readBalances } from "./members.js";

/** Hydrates D1 `users` rows in a single batched `inArray` lookup. */
export async function usersById(
  db: Db,
  userIds: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, { id: string; displayName: string; pictureUrl: string | null }>> {
  const ids = [
    ...new Set(userIds.filter((id): id is string => typeof id === "string" && id.length > 0)),
  ];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, displayName: users.displayName, pictureUrl: users.pictureUrl })
    .from(users)
    .where(inArray(users.id, ids));
  return new Map(rows.map((u) => [u.id, u]));
}

/** The Group as one Member sees it, with the rev it was read at. */
export async function readLedgerGroup(
  db: Db,
  env: Bindings,
  groupId: string,
  userId: string,
  fallback?: MemberRow,
): Promise<{ group: Group; rev: number }> {
  const { value: state, rev } = await groupLedger(env, groupId).state();
  const seatedMe =
    state.seated.find(
      (member) => member.userId === userId || (fallback !== undefined && member.id === fallback.id),
    ) ??
    (fallback === undefined
      ? undefined
      : { id: fallback.id, role: fallback.role, balance: fallback.netBalance });
  if (seatedMe === undefined) throw new ApiError("NOT_FOUND");
  const previewMembers = state.seated.slice(0, MAX_MEMBER_PREVIEW);
  const byId = await usersById(
    db,
    previewMembers.map((member) => member.userId),
  );
  const preview = previewMembers.map((member) => {
    const user = member.userId === null ? undefined : byId.get(member.userId);
    return {
      name: user?.displayName ?? member.placeholderName ?? "?",
      pictureUrl: user?.pictureUrl ?? null,
    };
  });
  return {
    rev,
    group: {
      ...state.group,
      settlementCurrencyLocked: state.locked,
      memberCount: state.seated.length,
      memberPreview: preview,
      me: { memberId: seatedMe.id, role: seatedMe.role, balance: seatedMe.balance },
    },
  };
}

/** The Groups the User is an active Member of, newest first. */
export async function listGroups(db: Db, userId: string): Promise<Group[]> {
  const rows = await db.all<{
    id: string;
    name: string;
    settlementCurrency: Group["settlementCurrency"];
    isTrip: number;
    tripDestination: string | null;
    tripStartDate: string | null;
    tripEndDate: string | null;
    tripNotes: string | null;
    createdAt: number;
    updatedAt: number;
    locked: number;
    memberCount: number;
    memberId: string;
    role: Group["me"]["role"];
    balance: number;
    preview: string;
  }>(sql`SELECT d.group_id AS id, d.name, d.settlement_currency AS settlementCurrency,
    d.is_trip AS isTrip, d.trip_destination AS tripDestination, d.trip_start_date AS tripStartDate,
    d.trip_end_date AS tripEndDate, d.trip_notes AS tripNotes, d.created_at AS createdAt,
    d.updated_at AS updatedAt, d.settlement_currency_locked AS locked,
    d.member_count AS memberCount, d.member_preview AS preview,
    m.member_id AS memberId, m.role, m.net_balance AS balance
    FROM group_directory d JOIN group_member_summary m ON m.group_id=d.group_id
    WHERE m.user_id=${userId} AND d.deleted=0
    ORDER BY d.created_at DESC, d.group_id DESC`);
  const previewSchema = z.array(
    z.object({ userId: z.string().nullable(), placeholderName: z.string().nullable().optional() }),
  );
  const parsed = rows.map((row) =>
    previewSchema.parse(JSON.parse(row.preview) as unknown).slice(0, MAX_MEMBER_PREVIEW),
  );
  const byId = await usersById(
    db,
    parsed.flatMap((preview) => preview.map((member) => member.userId)),
  );
  return rows.map((r, index) => ({
    id: r.id,
    name: r.name,
    settlementCurrency: r.settlementCurrency,
    isTrip: r.isTrip === 1,
    tripDestination: r.tripDestination,
    tripStartDate: r.tripStartDate,
    tripEndDate: r.tripEndDate,
    tripNotes: r.tripNotes,
    settlementCurrencyLocked: r.locked === 1,
    memberCount: r.memberCount,
    memberPreview: (parsed[index] ?? []).map((member) => {
      const person = member.userId === null ? undefined : byId.get(member.userId);
      return {
        name: person?.displayName ?? member.placeholderName ?? "?",
        pictureUrl: person?.pictureUrl ?? null,
      };
    }),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    me: { memberId: r.memberId, role: r.role, balance: r.balance },
  }));
}

/** Active Groups of a User, the count the 20-Group cap applies to. */
export async function activeGroupCount(db: Db, userId: string): Promise<number> {
  const [row] = await db.all<{ n: number }>(
    sql`SELECT count(*) AS n FROM group_member_summary s JOIN group_directory d ON d.group_id=s.group_id WHERE s.user_id=${userId} AND d.deleted=0`,
  );
  return row?.n ?? 0;
}

export async function assertUnderGroupCap(db: Db, userId: string): Promise<void> {
  if ((await activeGroupCount(db, userId)) >= MAX_GROUPS_PER_USER) {
    throw new ApiError("GROUP_LIMIT_REACHED");
  }
}
