import type {
  Expense,
  ExpensePage,
  Group,
  GroupInput,
  GroupPatch,
  MemberPatch,
  MemberRole,
  MemberStatus,
  PlaceholderInput,
  Settlement,
  SettlementPage,
  Stop,
} from "@split/shared";
import type { ErrorCode } from "./errors.js";

/**
 * What a Group ledger operation answers over RPC, which cannot carry an ApiError: the value
 * with the Group's rev, or the error's code and details. The typed client decodes it.
 */
export type LedgerResult<T> =
  { ok: true; value: T; rev: number } | { ok: false; code: ErrorCode; details?: unknown };

/** A Group's own fields as its ledger holds them, without any one Member's view. */
export type GroupFields = Omit<
  Group,
  "settlementCurrencyLocked" | "memberCount" | "memberPreview" | "me"
>;

/** An active or Placeholder Member, in joining order. */
export interface SeatedMember {
  id: string;
  userId: string | null;
  placeholderName: string | null;
  role: MemberRole;
  balance: number;
}

export interface LedgerState {
  group: GroupFields;
  /** True once the Group has an Expense. */
  locked: boolean;
  seated: SeatedMember[];
}

/** Every Member row of a Group, Former Members included, before User names are joined in. */
export interface LedgerMember extends SeatedMember {
  status: MemberStatus;
  nickname: string | null;
  createdByMemberId: string | null;
}

export interface CreateGroup {
  id: string;
  memberId: string;
  userId: string;
  now: number;
  input: GroupInput;
}

export interface PatchGroup {
  patch: GroupPatch;
  /** The `updatedAt` the caller edited. */
  expected: number;
  now: number;
  actorMemberId: string;
}

export interface DeleteGroup {
  actorMemberId: string;
}

export interface InviteOperation {
  action: "get" | "regenerate" | "ensure" | "validate";
  token?: string | undefined;
  actorMemberId?: string | undefined;
  now: number;
  expiresAt?: number | undefined;
}

export type MemberOperation = { now: number } & (
  | {
      action: "add";
      actorMemberId: string;
      targetMemberId: string;
      input: PlaceholderInput;
      names?: Record<string, string> | undefined;
    }
  | {
      action: "patch";
      actorMemberId: string;
      targetMemberId: string;
      input: MemberPatch;
      names?: Record<string, string> | undefined;
    }
  | { action: "leave" | "remove"; actorMemberId: string; targetMemberId: string }
  | { action: "join"; userId: string; targetMemberId: string; inviteToken: string }
  | { action: "claim"; userId: string; targetMemberId: string; inviteToken: string }
);

export interface MemberOutcome {
  memberId: string;
  /** False when a join found the User already seated. */
  changed: boolean;
  closeUserId?: string | null;
  member?: LedgerMember | undefined;
}

export type { ExpenseOperation } from "./ledger-expenses.js";

export interface ExpenseValues {
  list: ExpensePage;
  get: Expense;
  create: Expense;
  update: Expense;
  delete: null;
}

export type {
  SettlementCommand,
  SettlementCommand as SettlementOperation,
} from "./ledger-settlements.js";

export interface SettlementValues {
  list: SettlementPage;
  create: Settlement;
  undo: Settlement;
}

export type { StopOperation } from "./ledger-stops.js";

export interface StopValues {
  list: Stop[];
  create: Stop;
  patch: Stop;
  delete: null;
}

export interface AccountDeletionOperation {
  action: "freeze" | "unfreeze" | "finalize" | "restore" | "commit";
  userId: string;
  now: number;
  expires: number;
}

/** What freezing found: whether the User sits in the Group, owes, or is its last admin. */
export interface FreezeCheck {
  member: boolean;
  balance: number;
  lastAdmin: boolean;
}

export interface AccountDeletionValues {
  freeze: FreezeCheck;
  unfreeze: null;
  finalize: null;
  /** Whether the User's Membership came back. */
  restore: boolean;
  commit: null;
}
