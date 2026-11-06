import type { Invite } from "@split/shared";
import type { Bindings } from "./env.js";
import { ApiError } from "./errors.js";
import type {
  AccountDeletionOperation,
  AccountDeletionValues,
  CreateGroup,
  DeleteGroup,
  ExpenseAction,
  ExpenseValues,
  InviteOperation,
  LedgerMember,
  LedgerResult,
  LedgerState,
  MemberOperation,
  MemberOutcome,
  PatchGroup,
  SettlementOperation,
  SettlementValues,
  StopOperation,
  StopValues,
} from "./ledger-types.js";

/** A ledger operation's value with the Group rev it was read or written at. */
export interface Revised<T> {
  value: T;
  rev: number;
}

/**
 * The one place a ledger's error result becomes an ApiError; each route keeps its own policy
 * on top. RPC drops a method's generic, so the operations below name their value type again.
 */
async function decode<T>(result: Promise<LedgerResult<T>>): Promise<Revised<T>> {
  const answer = await result;
  if (!answer.ok) throw new ApiError(answer.code, answer.details);
  return { value: answer.value, rev: answer.rev };
}

/**
 * The typed client of one Group's ledger: the only way the Worker reaches it. Every operation
 * runs over Durable Object RPC, except the live-update WebSocket, which needs `fetch`.
 */
export function groupLedger(env: Bindings, groupId: string) {
  const stub = env.GROUP_LEDGER.get(env.GROUP_LEDGER.idFromName(groupId));
  return {
    /** The Group and its seated Members; NOT_FOUND once it is deleted or before it exists. */
    state: (): Promise<Revised<LedgerState>> => decode<LedgerState>(stub.state()),
    /** Whether the User is an active Member of a Group that is not deleted. */
    isMember: (userId: string): Promise<boolean> => stub.isMember(userId),
    /** Every Member; with `asUserId`, NOT_FOUND unless that User is an active Member. */
    members: (asUserId?: string): Promise<Revised<LedgerMember[]>> =>
      decode<LedgerMember[]>(stub.members(asUserId)),
    /** False when the creator holds no reservation, or the Group already exists. */
    create: (input: CreateGroup): Promise<boolean> => stub.createGroup(input),
    patch: (input: PatchGroup): Promise<Revised<null>> => decode<null>(stub.patchGroup(input)),
    delete: (by: DeleteGroup): Promise<Revised<null>> => decode<null>(stub.deleteGroup(by)),
    invite: (op: InviteOperation): Promise<Revised<Invite>> => decode<Invite>(stub.invite(op)),
    /** How many Expenses each Member pays or shares in. */
    placeholderCounts: (): Promise<Revised<Record<string, number>>> =>
      decode<Record<string, number>>(stub.placeholderCounts()),
    member: (op: MemberOperation): Promise<Revised<MemberOutcome>> =>
      decode<MemberOutcome>(stub.member(op)),
    expense: <O extends ExpenseAction>(op: O): Promise<Revised<ExpenseValues[O["action"]]>> =>
      decode<unknown>(stub.expense(op)) as Promise<Revised<ExpenseValues[O["action"]]>>,
    settlement: <O extends SettlementOperation>(
      op: O,
    ): Promise<Revised<SettlementValues[O["action"]]>> =>
      decode<unknown>(stub.settlement(op)) as Promise<Revised<SettlementValues[O["action"]]>>,
    stop: <O extends StopOperation>(op: O): Promise<Revised<StopValues[O["action"]]>> =>
      decode<unknown>(stub.stop(op)) as Promise<Revised<StopValues[O["action"]]>>,
    /** Whether the Settlement is in this Group and the User is one of its active Members. */
    settlementCheck: (userId: string, settlementId: string): Promise<boolean> =>
      stub.settlementCheck(userId, settlementId),
    accountDeletion: <O extends AccountDeletionOperation>(
      op: O,
    ): Promise<Revised<AccountDeletionValues[O["action"]]>> =>
      decode<unknown>(stub.accountDeletion(op)) as Promise<
        Revised<AccountDeletionValues[O["action"]]>
      >,
    /** Opens the User's live-update WebSocket; the ledger answers 404 to a non-Member. */
    live: (userId: string, protocol?: string): Promise<Response> => {
      const headers = new Headers({ Upgrade: "websocket", "X-User-Id": userId });
      if (protocol !== undefined) headers.set("Sec-WebSocket-Protocol", protocol);
      return stub.fetch("https://ledger.internal/live", { headers });
    },
  };
}
