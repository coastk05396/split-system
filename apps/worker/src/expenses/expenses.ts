import {
  allocateExpense,
  type Balances,
  type Expense,
  type ExpenseAllocation,
  type ExpenseInput,
  EXPENSE_PAGE_SIZE,
  type ExpensePage,
  MAX_EXPENSES_PER_GROUP,
} from "@split/shared";
import { and, asc, desc, eq, inArray, lt, type SQL, type SQLWrapper, sql } from "drizzle-orm";
import { runBatch } from "../db/batch.js";
import type { Db } from "../db/client.js";
import { isConstraintError } from "../db/errors.js";
import { expensePayers, expenses, expenseSplits, groups, members, stops } from "../db/schema.js";
import { ApiError } from "../errors.js";
import type { MemberRow } from "../groups/membership.js";
import { listMembers } from "../groups/members.js";
import { newSortableId } from "../ids.js";

type ExpenseRow = typeof expenses.$inferSelect;
type PayerRow = typeof expensePayers.$inferSelect;
type SplitRow = typeof expenseSplits.$inferSelect;

/** A rule the shared schema cannot check without the Group: 400 with the code as the issue. */
function invalid(path: string, message: string): ApiError {
  return new ApiError("VALIDATION_FAILED", { issues: [{ path: [path], message }] });
}

function toExpense(row: ExpenseRow, payers: PayerRow[], splits: SplitRow[]): Expense {
  return {
    id: row.id,
    groupId: row.groupId,
    creatorMemberId: row.creatorMemberId,
    description: row.description,
    category: row.category,
    originalAmount: row.originalAmount,
    originalCurrency: row.originalCurrency,
    fxRateScaled: row.fxRateScaled,
    fxDate: row.fxDate,
    isCustomRate: row.isCustomRate,
    settlementAmount: row.settlementAmount,
    splitMethod: row.splitType,
    payers: payers.map((p) => ({
      memberId: p.memberId,
      amountMinor: p.amount,
      settlementAmount: p.settlementAmount,
    })),
    splits: splits.map((s) => ({
      memberId: s.memberId,
      shares: row.splitType === "shares" ? s.shareUnits : null,
      amountMinor: s.amount,
      settlementAmount: s.settlementAmount,
    })),
    expenseDate: row.expenseDate,
    expenseTime: row.expenseTime,
    stopId: row.stopId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Expenses with their payer and split lines, in the order of `rows`. */
async function withLines(db: Db, rows: ExpenseRow[]): Promise<Expense[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [payers, splits] = await db.batch([
    db
      .select()
      .from(expensePayers)
      .where(inArray(expensePayers.expenseId, ids))
      .orderBy(sql`${expensePayers}.rowid`),
    db
      .select()
      .from(expenseSplits)
      .where(inArray(expenseSplits.expenseId, ids))
      .orderBy(sql`${expenseSplits}.rowid`),
  ]);
  return rows.map((row) =>
    toExpense(
      row,
      payers.filter((p) => p.expenseId === row.id),
      splits.filter((s) => s.expenseId === row.id),
    ),
  );
}

async function findExpense(db: Db, groupId: string, expenseId: string): Promise<Expense | null> {
  const rows = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.groupId, groupId), eq(expenses.id, expenseId)));
  const [expense] = await withLines(db, rows);
  return expense ?? null;
}

export async function getExpense(db: Db, me: MemberRow, expenseId: string): Promise<Expense> {
  const expense = await findExpense(db, me.groupId, expenseId);
  if (expense === null) throw new ApiError("NOT_FOUND");
  return expense;
}

/** A page of 50 Expenses ordered by ID, newest first; the cursor is the last ID shown. */
export async function listExpenses(
  db: Db,
  me: MemberRow,
  cursor: string | undefined,
): Promise<ExpensePage> {
  const rows = await db
    .select()
    .from(expenses)
    .where(
      and(
        eq(expenses.groupId, me.groupId),
        cursor === undefined ? undefined : lt(expenses.id, cursor),
      ),
    )
    .orderBy(desc(expenses.id))
    .limit(EXPENSE_PAGE_SIZE + 1);
  const page = rows.slice(0, EXPENSE_PAGE_SIZE);
  const last = page.at(-1);
  return {
    expenses: await withLines(db, page),
    nextCursor: rows.length > EXPENSE_PAGE_SIZE && last !== undefined ? last.id : null,
  };
}

interface Prepared {
  allocation: ExpenseAllocation;
  /** Holds while the Group, its Members and the Stop still allow this Expense. */
  guard: SQL;
}

/**
 * Checks an Expense against its Group: every payer and split Member belongs to it and is not
 * a Former Member, the Stop is the Group's, and the amounts convert into the Settlement
 * currency. The returned SQL guard repeats the Group checks inside the writing batch.
 */
async function prepare(db: Db, me: MemberRow, input: ExpenseInput): Promise<Prepared> {
  const [group] = await db
    .select({ currency: groups.settlementCurrency })
    .from(groups)
    .where(eq(groups.id, me.groupId));
  if (group === undefined) throw new ApiError("NOT_FOUND");
  const roster = await db
    .select({ id: members.id, status: members.status })
    .from(members)
    .where(eq(members.groupId, me.groupId))
    .orderBy(asc(members.createdAt), sql`${members}.rowid`);

  const referenced = [
    ...new Set([
      ...input.payers.map((p) => p.memberId),
      ...(input.split.method === "equal"
        ? input.split.participants
        : input.split.lines.map((l) => l.memberId)),
    ]),
  ];
  const status = new Map(roster.map((m) => [m.id, m.status]));
  if (referenced.some((id) => !status.has(id))) throw invalid("payers", "MEMBER_NOT_IN_GROUP");
  if (referenced.some((id) => status.get(id) === "former")) throw new ApiError("MEMBER_NOT_ACTIVE");

  const stopId = input.stopId ?? null;
  if (stopId !== null) {
    const [stop] = await db
      .select({ id: stops.id })
      .from(stops)
      .where(and(eq(stops.groupId, me.groupId), eq(stops.id, stopId)));
    if (stop === undefined) throw invalid("stopId", "STOP_NOT_IN_GROUP");
  }

  const allocation = allocateExpense(
    input,
    group.currency,
    roster.map((m) => m.id),
  );
  if (!allocation.ok) {
    if (allocation.error === "EXPENSE_AMOUNT_INVALID") throw new ApiError("EXPENSE_AMOUNT_INVALID");
    throw invalid(
      allocation.error.startsWith("SPLIT") ? "split" : "settlementAmount",
      allocation.error,
    );
  }

  const ids = sql.join(
    referenced.map((id) => sql`${id}`),
    sql`, `,
  );
  const guard = sql`EXISTS (SELECT 1 FROM groups g WHERE g.id = ${me.groupId} AND g.settlement_currency = ${group.currency})
    AND NOT EXISTS (SELECT 1 FROM members m WHERE m.id IN (${ids}) AND (m.group_id <> ${me.groupId} OR m.status = 'former'))
    AND ${stopId === null ? sql`1` : sql`EXISTS (SELECT 1 FROM stops st WHERE st.id = ${stopId} AND st.group_id = ${me.groupId})`}`;
  return { allocation: allocation.value, guard };
}

/** Each Member's Balance change: payers gain their converted share, split Members lose theirs. */
function balanceEffect(lines: {
  payers: readonly { memberId: string; settlementAmount: number }[];
  splits: readonly { memberId: string; settlementAmount: number }[];
}): Map<string, number> {
  const effect = new Map<string, number>();
  const add = (memberId: string, amount: number) => {
    effect.set(memberId, (effect.get(memberId) ?? 0) + amount);
  };
  for (const p of lines.payers) add(p.memberId, p.settlementAmount);
  for (const s of lines.splits) add(s.memberId, -s.settlementAmount);
  return effect;
}

function difference(next: Map<string, number>, previous: Map<string, number>): Map<string, number> {
  const delta = new Map(next);
  for (const [memberId, amount] of previous)
    delta.set(memberId, (delta.get(memberId) ?? 0) - amount);
  return delta;
}

/** Statements that write the lines and move Balances, each only while `guard` holds. */
function lineStatements(
  db: Db,
  expenseId: string,
  allocation: ExpenseAllocation,
  delta: Map<string, number>,
  guard: SQL,
): SQLWrapper[] {
  return [
    ...allocation.payers.map(
      (p) => sql`INSERT INTO expense_payers (id, expense_id, member_id, amount, settlement_amount)
        SELECT ${crypto.randomUUID()}, ${expenseId}, ${p.memberId}, ${p.amountMinor}, ${p.settlementAmount} WHERE ${guard}`,
    ),
    ...allocation.splits.map(
      (
        s,
      ) => sql`INSERT INTO expense_splits (id, expense_id, member_id, share_units, amount, settlement_amount)
        SELECT ${crypto.randomUUID()}, ${expenseId}, ${s.memberId}, ${s.shares ?? 1}, ${s.amountMinor}, ${s.settlementAmount} WHERE ${guard}`,
    ),
    ...moveBalances(db, delta, guard),
  ];
}

/** One guarded `UPDATE` per Member whose Balance changes. */
function moveBalances(db: Db, delta: Map<string, number>, guard: SQL): SQLWrapper[] {
  return [...delta]
    .filter(([, amount]) => amount !== 0)
    .map(([memberId, amount]) =>
      db
        .update(members)
        .set({ netBalance: sql`${members.netBalance} + ${amount}` })
        .where(and(eq(members.id, memberId), guard)),
    );
}

function expenseColumns(input: ExpenseInput, now: number) {
  return {
    description: input.description,
    category: input.category,
    originalAmount: input.originalAmount,
    originalCurrency: input.originalCurrency,
    fxRateScaled: input.fxRateScaled,
    fxDate: input.fxDate,
    isCustomRate: input.isCustomRate,
    settlementAmount: input.settlementAmount,
    splitType: input.split.method,
    expenseDate: input.expenseDate,
    expenseTime: input.expenseTime ?? null,
    stopId: input.stopId ?? null,
    updatedAt: now,
  };
}

async function findByKey(db: Db, me: MemberRow, storedKey: string): Promise<Expense | null> {
  const rows = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.groupId, me.groupId), eq(expenses.idempotencyKey, storedKey)));
  const [expense] = await withLines(db, rows);
  return expense ?? null;
}

/**
 * Creates an Expense and moves Balances in one batch. The `Idempotency-Key` is stored per
 * creating Member (decision 15's UNIQUE (created_by_member, idempotency_key)), so a repeat
 * returns the first Expense and never writes twice.
 */
export async function createExpense(
  db: Db,
  me: MemberRow,
  input: ExpenseInput,
  idempotencyKey: string,
  now: number,
): Promise<Expense> {
  const storedKey = `${me.id}:${idempotencyKey}`;
  const repeat = await findByKey(db, me, storedKey);
  if (repeat !== null) return repeat;

  const { allocation, guard } = await prepare(db, me, input);
  const id = newSortableId(now);
  const columns = { ...expenseColumns(input, now), createdAt: now };
  const createGuard = sql`${guard} AND (SELECT count(*) FROM expenses c WHERE c.group_id = ${me.groupId}) < ${MAX_EXPENSES_PER_GROUP}`;
  const written = sql`EXISTS (SELECT 1 FROM expenses w WHERE w.id = ${id})`;
  try {
    const [inserted] = await runBatch(db, [
      sql`INSERT INTO expenses (id, group_id, creator_member_id, description, category, original_amount, original_currency,
          fx_rate_scaled, fx_date, is_custom_rate, settlement_amount, split_type, expense_date, expense_time, stop_id,
          idempotency_key, created_at, updated_at)
        SELECT ${id}, ${me.groupId}, ${me.id}, ${columns.description}, ${columns.category}, ${columns.originalAmount},
          ${columns.originalCurrency}, ${columns.fxRateScaled}, ${columns.fxDate}, ${columns.isCustomRate ? 1 : 0},
          ${columns.settlementAmount}, ${columns.splitType}, ${columns.expenseDate}, ${columns.expenseTime}, ${columns.stopId},
          ${storedKey}, ${now}, ${now}
        WHERE ${createGuard}`,
      ...lineStatements(db, id, allocation, balanceEffect(allocation), written),
    ]);
    if ((inserted?.meta.changes ?? 0) === 0) {
      const [row] = await db
        .select({ n: sql<number>`count(*)` })
        .from(expenses)
        .where(eq(expenses.groupId, me.groupId));
      if ((row?.n ?? 0) >= MAX_EXPENSES_PER_GROUP) throw new ApiError("EXPENSE_LIMIT_REACHED");
      // The Group changed between the checks and the write: check again for the reason.
      await prepare(db, me, input);
      throw new ApiError("EDIT_CONFLICT");
    }
  } catch (error) {
    if (!isConstraintError(error, "UNIQUE", "expenses.idempotency_key")) throw error;
    const first = await findByKey(db, me, storedKey);
    if (first === null) throw error;
    return first;
  }
  return getExpense(db, me, id);
}

/**
 * Replaces an Expense under `If-Match: <updatedAt>` and applies the Balance difference in one
 * batch. Every statement re-checks that the row is unchanged, so a clashing edit writes nothing
 * and gets 409 EDIT_CONFLICT with the current Expense.
 */
export async function updateExpense(
  db: Db,
  me: MemberRow,
  expenseId: string,
  input: ExpenseInput,
  expectedUpdatedAt: number,
  now: number,
): Promise<Expense> {
  const current = await getExpense(db, me, expenseId);
  if (current.updatedAt !== expectedUpdatedAt) throw new ApiError("EDIT_CONFLICT", { current });
  const { allocation, guard } = await prepare(db, me, input);

  const fresh = sql`EXISTS (SELECT 1 FROM expenses f WHERE f.id = ${expenseId} AND f.updated_at = ${expectedUpdatedAt}) AND ${guard}`;
  const delta = difference(balanceEffect(allocation), balanceEffect(current));
  const results = await runBatch(db, [
    db.delete(expensePayers).where(and(eq(expensePayers.expenseId, expenseId), fresh)),
    db.delete(expenseSplits).where(and(eq(expenseSplits.expenseId, expenseId), fresh)),
    ...lineStatements(db, expenseId, allocation, delta, fresh),
    // Last, because it ends the row's freshness the statements above depend on.
    db
      .update(expenses)
      .set(expenseColumns(input, Math.max(now, expectedUpdatedAt + 1)))
      .where(and(eq(expenses.id, expenseId), fresh)),
  ]);
  if ((results.at(-1)?.meta.changes ?? 0) === 0) {
    const latest = await getExpense(db, me, expenseId);
    if (latest.updatedAt !== expectedUpdatedAt)
      throw new ApiError("EDIT_CONFLICT", { current: latest });
    await prepare(db, me, input);
    throw new ApiError("EDIT_CONFLICT", { current: latest });
  }
  return getExpense(db, me, expenseId);
}

/** Hard-deletes an Expense and reverses its Balance effect in the same batch (decision 15). */
export async function deleteExpense(db: Db, me: MemberRow, expenseId: string): Promise<void> {
  const current = await getExpense(db, me, expenseId);
  const fresh = sql`EXISTS (SELECT 1 FROM expenses f WHERE f.id = ${expenseId} AND f.updated_at = ${current.updatedAt})`;
  const reverse = difference(new Map(), balanceEffect(current));
  const results = await runBatch(db, [
    ...moveBalances(db, reverse, fresh),
    db.delete(expenses).where(and(eq(expenses.id, expenseId), fresh)),
  ]);
  // D1 counts the cascaded line deletes in `changes` too, so test for zero, not one.
  if ((results.at(-1)?.meta.changes ?? 0) === 0) {
    const latest = await findExpense(db, me.groupId, expenseId);
    if (latest === null) throw new ApiError("NOT_FOUND");
    throw new ApiError("EDIT_CONFLICT", { current: latest });
  }
}

/** Every Member's stored Balance in the Group's Settlement currency. */
export async function groupBalances(db: Db, me: MemberRow): Promise<Balances> {
  const [group] = await db
    .select({ currency: groups.settlementCurrency })
    .from(groups)
    .where(eq(groups.id, me.groupId));
  if (group === undefined) throw new ApiError("NOT_FOUND");
  const list = await listMembers(db, me.groupId, me.id);
  return {
    settlementCurrency: group.currency,
    balances: list.map((m) => ({
      memberId: m.id,
      displayName: m.displayName,
      status: m.status,
      balance: m.balance,
    })),
  };
}
