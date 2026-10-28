import { env } from "cloudflare:workers";
import { createDb } from "../src/db/client.js";
import { expensePayers, expenses, expenseSplits } from "../src/db/schema.js";
import { bearer, call, clock, json, type Session, signIn, uniqueSub } from "./auth-harness.js";

export interface GroupBody {
  id: string;
  name: string;
  settlementCurrency: string;
  defaultExpenseCurrency: string;
  isTrip: boolean;
  tripDestination: string | null;
  tripStartDate: string | null;
  tripEndDate: string | null;
  tripNotes: string | null;
  settlementCurrencyLocked: boolean;
  memberCount: number;
  updatedAt: number;
  me: { memberId: string; role: "admin" | "member"; balance: number };
}

export interface MemberBody {
  id: string;
  userId: string | null;
  displayName: string;
  nickname: string | null;
  pictureUrl: string | null;
  role: "admin" | "member";
  status: "active" | "former" | "placeholder";
  balance: number;
  isMe: boolean;
}

/** `list[index]`, failing the test when it is missing. */
export function at<T>(list: readonly T[], index: number): T {
  const item = list[index];
  if (item === undefined) throw new Error(`no item at ${String(index)}`);
  return item;
}

export async function person(name: string): Promise<Session> {
  return signIn("google", uniqueSub(name), name);
}

export function send(
  session: Session,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  const init: RequestInit =
    body === undefined
      ? { method, headers: { ...bearer(session.accessToken), ...headers } }
      : { ...json(body, { ...bearer(session.accessToken), ...headers }), method };
  return call(path, init);
}

export async function createGroup(admin: Session, input: Record<string, unknown> = {}) {
  const res = await send(admin, "POST", "/groups", { name: "台南小旅行", ...input });
  if (res.status !== 201) throw new Error(`create group: ${res.status} ${await res.text()}`);
  return res.json<GroupBody>();
}

export async function listMembers(session: Session, groupId: string): Promise<MemberBody[]> {
  const res = await send(session, "GET", `/groups/${groupId}/members`);
  if (res.status !== 200) throw new Error(`members: ${res.status} ${await res.text()}`);
  return res.json<MemberBody[]>();
}

export async function inviteToken(admin: Session, groupId: string): Promise<string> {
  const res = await send(admin, "POST", `/groups/${groupId}/invite`);
  if (res.status !== 201) throw new Error(`invite: ${res.status} ${await res.text()}`);
  return (await res.json<{ token: string }>()).token;
}

/** A Group whose admin invited and let in the given people as plain Members. */
export async function groupWith(adminName: string, ...memberNames: string[]) {
  const admin = await person(adminName);
  const group = await createGroup(admin);
  const token = await inviteToken(admin, group.id);
  const others: Session[] = [];
  for (const name of memberNames) {
    const member = await person(name);
    const res = await send(member, "POST", `/invites/${token}/join`);
    if (res.status !== 200) throw new Error(`join: ${res.status} ${await res.text()}`);
    others.push(member);
  }
  return { admin, group, token, others };
}

/**
 * Expense routes come in a later ticket, so an Expense is seeded straight into D1: created
 * and paid by `memberId`, split to `splitMemberIds` (default: the payer alone).
 */
export async function seedExpense(
  groupId: string,
  memberId: string,
  splitMemberIds: string[] = [memberId],
): Promise<string> {
  const db = createDb(env.DB);
  const id = crypto.randomUUID();
  await db.batch([
    db.insert(expenses).values({
      id,
      groupId,
      creatorMemberId: memberId,
      description: "晚餐",
      category: "food",
      originalAmount: 600,
      originalCurrency: "TWD",
      fxRateScaled: 1_000_000,
      fxDate: "2026-06-13",
      settlementAmount: 600,
      splitType: "equal",
      expenseDate: "2026-06-13",
      createdAt: clock.now,
      updatedAt: clock.now,
    }),
    db.insert(expensePayers).values({
      id: crypto.randomUUID(),
      expenseId: id,
      memberId,
      amount: 600,
      settlementAmount: 600,
    }),
    ...splitMemberIds.map((splitMemberId) =>
      db.insert(expenseSplits).values({
        id: crypto.randomUUID(),
        expenseId: id,
        memberId: splitMemberId,
        settlementAmount: 600 / splitMemberIds.length,
      }),
    ),
  ]);
  return id;
}

export async function errorCode(res: Response): Promise<string | undefined> {
  const body = await res.json<{ error?: { code: string } }>();
  return body.error?.code;
}
