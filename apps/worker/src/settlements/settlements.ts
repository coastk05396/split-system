import {
  type Settlement,
  type SettlementInput,
  SETTLEMENT_PAGE_SIZE,
  type SettlementPage,
} from "@split/shared";
import { and, desc, eq, lt, type SQL, sql } from "drizzle-orm";
import { runBatch } from "../db/batch.js";
import type { Db } from "../db/client.js";
import { isConstraintError } from "../db/errors.js";
import { members, settlements } from "../db/schema.js";
import { ApiError, invalid } from "../errors.js";
import { type MemberRow, requireMember } from "../groups/membership.js";
import { newSortableId } from "../ids.js";

/**
 * Settlements (SPEC §5; decisions 12, 15, 16, 23, 31). Only a confirmed Settlement moves
 * Balances: x from payer A to receiver B adds x to A and takes x from B. A confirm may never
 * carry either Balance past zero, so a Settlement is at most what the payer still owes.
 */

type SettlementRow = typeof settlements.$inferSelect;
type Party = Pick<MemberRow, "id" | "status" | "netBalance">;

function toSettlement(row: SettlementRow): Settlement {
  return {
    id: row.id,
    groupId: row.groupId,
    payerMemberId: row.payerMemberId,
    receiverMemberId: row.receiverMemberId,
    amount: row.amount,
    status: row.status,
    createdByMemberId: row.createdByMemberId,
    confirmedByMemberId: row.confirmedByMemberId,
    confirmedAt: row.confirmedAt,
    undoneByMemberId: row.undoneByMemberId,
    undoneAt: row.undoneAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** The most a payer can still pay this receiver: what neither Balance can go past zero for. */
function owed(payer: Party, receiver: Party): number {
  return Math.max(0, Math.min(-payer.netBalance, receiver.netBalance));
}

/**
 * The payer, the receiver, or an Admin confirms a Settlement (decision 31).
 */
function canConfirm(me: MemberRow, payer: Party, receiver: Party): boolean {
  return me.id === payer.id || me.id === receiver.id || me.role === "admin";
}

async function parties(db: Db, groupId: string, payerId: string, receiverId: string) {
  const rows = await db
    .select({ id: members.id, status: members.status, netBalance: members.netBalance })
    .from(members)
    .where(and(eq(members.groupId, groupId), sql`${members.id} IN (${payerId}, ${receiverId})`));
  const payer = rows.find((r) => r.id === payerId);
  const receiver = rows.find((r) => r.id === receiverId);
  return payer === undefined || receiver === undefined ? null : { payer, receiver };
}

/** Both parties are still seated in the Group (not Former Members). */
function seated(groupId: string, payerId: string, receiverId: string): SQL {
  return sql`(SELECT count(*) FROM members p WHERE p.id IN (${payerId}, ${receiverId}) AND p.group_id = ${groupId} AND p.status <> 'former') = 2`;
}

/** Paying `amount` carries neither Balance past zero. */
function withinDebt(payerId: string, receiverId: string, amount: number): SQL {
  return sql`(SELECT net_balance FROM members d WHERE d.id = ${payerId}) + ${amount} <= 0
    AND (SELECT net_balance FROM members r WHERE r.id = ${receiverId}) - ${amount} >= 0`;
}

/**
 * Moves both Balances by a Settlement (`sign` 1 to apply, -1 to reverse), only when the
 * statement just before it in the batch changed exactly one row. Each guarded state change
 * comes first, so a stale or refused change moves nothing.
 */
function moveBalances(payerId: string, receiverId: string, amount: number, sign: 1 | -1): SQL {
  const delta = amount * sign;
  return sql`UPDATE members SET net_balance = net_balance + CASE WHEN id = ${payerId} THEN ${delta} ELSE ${-delta} END
    WHERE id IN (${payerId}, ${receiverId}) AND changes() = 1`;
}

async function findRow(db: Db, settlementId: string): Promise<SettlementRow | null> {
  const [row] = await db.select().from(settlements).where(eq(settlements.id, settlementId));
  return row ?? null;
}

async function reload(db: Db, settlementId: string): Promise<Settlement> {
  const row = await findRow(db, settlementId);
  if (row === null) throw new ApiError("NOT_FOUND");
  return toSettlement(row);
}

/** Why a guarded write changed nothing, read again after the fact. */
async function refusal(db: Db, groupId: string, row: SettlementInput): Promise<ApiError> {
  const found = await parties(db, groupId, row.payerMemberId, row.receiverMemberId);
  if (found === null) return invalid("payerMemberId", "MEMBER_NOT_IN_GROUP");
  if (found.payer.status === "former" || found.receiver.status === "former")
    return new ApiError("MEMBER_NOT_ACTIVE");
  const max = owed(found.payer, found.receiver);
  if (row.amount > max) return new ApiError("SETTLEMENT_EXCEEDS_DEBT", { maxAmount: max });
  return new ApiError("EDIT_CONFLICT");
}

/** A page of 50 Settlements of every status, ordered by ID, newest first. */
export async function listSettlements(
  db: Db,
  me: MemberRow,
  cursor: string | undefined,
): Promise<SettlementPage> {
  const rows = await db
    .select()
    .from(settlements)
    .where(
      and(
        eq(settlements.groupId, me.groupId),
        cursor === undefined ? undefined : lt(settlements.id, cursor),
      ),
    )
    .orderBy(desc(settlements.id))
    .limit(SETTLEMENT_PAGE_SIZE + 1);
  const page = rows.slice(0, SETTLEMENT_PAGE_SIZE);
  const last = page.at(-1);
  return {
    settlements: page.map(toSettlement),
    nextCursor: rows.length > SETTLEMENT_PAGE_SIZE && last !== undefined ? last.id : null,
  };
}

async function findByKey(db: Db, me: MemberRow, storedKey: string): Promise<Settlement | null> {
  const [row] = await db
    .select()
    .from(settlements)
    .where(and(eq(settlements.groupId, me.groupId), eq(settlements.idempotencyKey, storedKey)));
  return row === undefined ? null : toSettlement(row);
}

/**
 * Records and immediately confirms a Settlement. The payer, the receiver, or an Admin may
 * record it, and Balances move in the same batch. Nobody else may record a payment between
 * two other Members (decision 23). The `Idempotency-Key` is kept per recording Member; a
 * repeat returns the first Settlement.
 */
export async function createSettlement(
  db: Db,
  me: MemberRow,
  input: SettlementInput,
  idempotencyKey: string,
  now: number,
): Promise<Settlement> {
  const storedKey = `${me.id}:${idempotencyKey}`;
  const repeat = await findByKey(db, me, storedKey);
  if (repeat !== null) return repeat;

  const { payerMemberId: payerId, receiverMemberId: receiverId, amount } = input;
  const found = await parties(db, me.groupId, payerId, receiverId);
  if (found === null) throw invalid("payerMemberId", "MEMBER_NOT_IN_GROUP");
  if (!canConfirm(me, found.payer, found.receiver)) throw new ApiError("FORBIDDEN");

  const id = newSortableId(now);
  const guard = sql`${seated(me.groupId, payerId, receiverId)} AND ${withinDebt(payerId, receiverId, amount)}`;
  const insert = sql`INSERT INTO settlements (id, group_id, payer_member_id, receiver_member_id, amount, status,
      created_by_member_id, confirmed_by_member_id, confirmed_at, idempotency_key, created_at, updated_at)
    SELECT ${id}, ${me.groupId}, ${payerId}, ${receiverId}, ${amount}, 'confirmed',
      ${me.id}, ${me.id}, ${now}, ${storedKey}, ${now}, ${now}
    WHERE ${guard}`;
  try {
    const [inserted] = await runBatch(db, [insert, moveBalances(payerId, receiverId, amount, 1)]);
    if ((inserted?.meta.changes ?? 0) === 0) throw await refusal(db, me.groupId, input);
  } catch (error) {
    if (!isConstraintError(error, "UNIQUE", "settlements.idempotency_key")) throw error;
    const first = await findByKey(db, me, storedKey);
    if (first === null) throw error;
    return first;
  }
  return reload(db, id);
}

/** The Settlement and the caller's Member row in its Group; 404 to anyone outside it. */
async function settlementFor(db: Db, settlementId: string, userId: string) {
  const row = await findRow(db, settlementId);
  if (row === null) throw new ApiError("NOT_FOUND");
  const me = await requireMember(db, row.groupId, userId);
  return { row, me };
}

/**
 * The receiver (or an Admin) confirms a pending Settlement, optionally at a lower amount
 * up to the recorded amount (decision 12), and Balances move in the same batch.
 */
export async function confirmSettlement(
  db: Db,
  userId: string,
  settlementId: string,
  amount: number | undefined,
  now: number,
): Promise<Settlement> {
  const { row, me } = await settlementFor(db, settlementId, userId);
  if (row.status !== "pending") throw new ApiError("SETTLEMENT_NOT_PENDING");
  const found = await parties(db, row.groupId, row.payerMemberId, row.receiverMemberId);
  if (found === null) throw new ApiError("NOT_FOUND");
  if (!canConfirm(me, found.payer, found.receiver)) throw new ApiError("FORBIDDEN");

  if (amount !== undefined && (amount <= 0 || amount > row.amount)) {
    throw invalid("amount", "AMOUNT_EXCEEDS_RECORDED_SETTLEMENT");
  }

  const paid = amount ?? row.amount;
  const { payerMemberId: payerId, receiverMemberId: receiverId } = row;
  const [confirmed] = await runBatch(db, [
    db
      .update(settlements)
      .set({
        status: "confirmed",
        amount: paid,
        confirmedByMemberId: me.id,
        confirmedAt: now,
        updatedAt: Math.max(now, row.updatedAt + 1),
      })
      .where(
        and(
          eq(settlements.id, row.id),
          eq(settlements.status, "pending"),
          seated(row.groupId, payerId, receiverId),
          withinDebt(payerId, receiverId, paid),
        ),
      ),
    moveBalances(payerId, receiverId, paid, 1),
  ]);
  if ((confirmed?.meta.changes ?? 0) === 0) {
    if ((await reload(db, row.id)).status !== "pending")
      throw new ApiError("SETTLEMENT_NOT_PENDING");
    throw await refusal(db, row.groupId, {
      payerMemberId: payerId,
      receiverMemberId: receiverId,
      amount: paid,
    });
  }
  return reload(db, row.id);
}

/** The payer, whoever recorded it, or an Admin withdraws a pending Settlement. */
export async function cancelSettlement(
  db: Db,
  userId: string,
  settlementId: string,
  now: number,
): Promise<Settlement> {
  const { row, me } = await settlementFor(db, settlementId, userId);
  if (row.status !== "pending") throw new ApiError("SETTLEMENT_NOT_PENDING");
  if (me.id !== row.payerMemberId && me.id !== row.createdByMemberId && me.role !== "admin")
    throw new ApiError("FORBIDDEN");
  const cancelled = await db
    .update(settlements)
    .set({ status: "cancelled", updatedAt: Math.max(now, row.updatedAt + 1) })
    .where(and(eq(settlements.id, row.id), eq(settlements.status, "pending")))
    .returning({ id: settlements.id });
  if (cancelled.length === 0) throw new ApiError("SETTLEMENT_NOT_PENDING");
  return reload(db, row.id);
}

/**
 * The payer, the receiver, whoever confirmed it, or an Admin undoes a confirmed Settlement:
 * Balances move back and the row stays in the history as undone (已撤銷). A Former Member's
 * Balance stays at zero, so a Settlement with one is no longer undoable.
 */
export async function undoSettlement(
  db: Db,
  userId: string,
  settlementId: string,
  now: number,
): Promise<Settlement> {
  const { row, me } = await settlementFor(db, settlementId, userId);
  if (row.status !== "confirmed") throw new ApiError("SETTLEMENT_NOT_CONFIRMED");
  if (
    me.id !== row.payerMemberId &&
    me.id !== row.receiverMemberId &&
    me.id !== row.confirmedByMemberId &&
    me.role !== "admin"
  ) {
    throw new ApiError("FORBIDDEN");
  }

  const { payerMemberId: payerId, receiverMemberId: receiverId } = row;
  const [undone] = await runBatch(db, [
    db
      .update(settlements)
      .set({
        status: "undone",
        undoneByMemberId: me.id,
        undoneAt: now,
        updatedAt: Math.max(now, row.updatedAt + 1),
      })
      .where(
        and(
          eq(settlements.id, row.id),
          eq(settlements.status, "confirmed"),
          seated(row.groupId, payerId, receiverId),
        ),
      ),
    moveBalances(payerId, receiverId, row.amount, -1),
  ]);
  if ((undone?.meta.changes ?? 0) === 0) {
    if ((await reload(db, row.id)).status !== "confirmed")
      throw new ApiError("SETTLEMENT_NOT_CONFIRMED");
    throw new ApiError("MEMBER_NOT_ACTIVE");
  }
  return reload(db, row.id);
}
