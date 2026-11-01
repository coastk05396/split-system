import {
  allocateExpense,
  expenseSchema,
  EXPENSE_PAGE_SIZE,
  MAX_EXPENSES_PER_GROUP,
  type Expense,
  type ExpenseInput,
} from "@split/shared";
import { ApiError, invalid } from "./errors.js";
import { newSortableId } from "./ids.js";

type Member = { id: string; status: string };
type Group = { id: string; settlement_currency: Expense["originalCurrency"] };
type Row = { data: string; deleted: number };
export type ExpenseOperation =
  | { action: "balances" }
  | { action: "list"; cursor?: string | undefined }
  | { action: "get"; id: string }
  | { action: "delete"; id: string; now: number }
  | {
      action: "create";
      memberId: string;
      input: ExpenseInput;
      key: string;
      now: number;
      rates: { base: string; quote: string; rate: number }[];
    }
  | {
      action: "update";
      id: string;
      memberId: string;
      input: ExpenseInput;
      expected: number;
      now: number;
      rates: { base: string; quote: string; rate: number }[];
    };

function read(row: Row): Expense {
  return expenseSchema.parse(JSON.parse(row.data));
}
function effect(expense: Expense): Map<string, number> {
  const result = new Map<string, number>();
  for (const p of expense.payers)
    result.set(p.memberId, (result.get(p.memberId) ?? 0) + p.settlementAmount);
  for (const s of expense.splits)
    result.set(s.memberId, (result.get(s.memberId) ?? 0) - s.settlementAmount);
  return result;
}

export function expenseOperation(
  sql: SqlStorage,
  op: ExpenseOperation,
): { value: unknown; changed: boolean } {
  const get = (id: string): Expense => {
    const row = sql
      .exec<Row>("SELECT data, deleted FROM ledger_expenses WHERE id = ? AND deleted = 0", id)
      .toArray()[0];
    if (!row) throw new ApiError("NOT_FOUND");
    return read(row);
  };
  if (op.action === "balances")
    return {
      value: sql
        .exec<{ id: string; net_balance: number }>(
          "SELECT id,net_balance FROM ledger_members ORDER BY created_at,rowid",
        )
        .toArray(),
      changed: false,
    };
  if (op.action === "list") {
    const rows = sql
      .exec<Row>(
        "SELECT data, deleted FROM ledger_expenses WHERE deleted=0 AND (? IS NULL OR id < ?) ORDER BY id DESC LIMIT ?",
        op.cursor ?? null,
        op.cursor ?? null,
        EXPENSE_PAGE_SIZE + 1,
      )
      .toArray();
    const page = rows.slice(0, EXPENSE_PAGE_SIZE).map(read);
    return {
      value: {
        expenses: page,
        nextCursor: rows.length > EXPENSE_PAGE_SIZE ? (page.at(-1)?.id ?? null) : null,
      },
      changed: false,
    };
  }
  if (op.action === "get") return { value: get(op.id), changed: false };
  if (op.action === "create") {
    const row = sql
      .exec<Row>(
        "SELECT data, deleted FROM ledger_expenses WHERE creator_member_id=? AND idempotency_key=?",
        op.memberId,
        op.key,
      )
      .toArray()[0];
    if (row) return { value: read(row), changed: false };
    const count = sql
      .exec<{ n: number }>("SELECT count(*) n FROM ledger_expenses WHERE deleted=0")
      .one().n;
    if (count >= MAX_EXPENSES_PER_GROUP) throw new ApiError("EXPENSE_LIMIT_REACHED");
  }
  const previous = op.action === "create" ? null : get(op.id);
  if (op.action === "update" && previous?.updatedAt !== op.expected)
    throw new ApiError("EDIT_CONFLICT", { current: previous });
  let next: Expense | null = null;
  if (op.action !== "delete") {
    const group = sql
      .exec<Group>("SELECT id, settlement_currency FROM ledger_group WHERE deleted=0")
      .one();
    const roster = sql
      .exec<Member>("SELECT id,status FROM ledger_members ORDER BY created_at,rowid")
      .toArray();
    const refs = [
      ...op.input.payers.map((p) => p.memberId),
      ...(op.input.split.method === "equal"
        ? op.input.split.participants
        : op.input.split.lines.map((l) => l.memberId)),
    ];
    if (refs.some((id) => !roster.some((m) => m.id === id)))
      throw invalid("payers", "MEMBER_NOT_IN_GROUP");
    if (refs.some((id) => roster.some((m) => m.id === id && m.status === "former")))
      throw new ApiError("MEMBER_NOT_ACTIVE");
    if (
      op.input.stopId != null &&
      sql.exec("SELECT id FROM ledger_stops WHERE id=?", op.input.stopId).toArray().length === 0
    )
      throw invalid("stopId", "STOP_NOT_IN_GROUP");
    const rate = op.rates.find(
      (r) => r.base === op.input.originalCurrency && r.quote === group.settlement_currency,
    );
    if (
      !op.input.isCustomRate &&
      op.input.originalCurrency !== group.settlement_currency &&
      rate &&
      rate.rate !== op.input.fxRateScaled
    )
      throw invalid("fxRateScaled", "RATE_MISMATCH_WITH_REFERENCE");
    const allocation = allocateExpense(
      op.input,
      group.settlement_currency,
      roster.map((m) => m.id),
    );
    if (!allocation.ok) {
      if (allocation.error === "EXPENSE_AMOUNT_INVALID")
        throw new ApiError("EXPENSE_AMOUNT_INVALID");
      throw invalid(
        allocation.error.startsWith("SPLIT") ? "split" : "settlementAmount",
        allocation.error,
      );
    }
    next = {
      id: previous?.id ?? newSortableId(op.now),
      groupId: group.id,
      creatorMemberId: previous?.creatorMemberId ?? op.memberId,
      description: op.input.description,
      category: op.input.category,
      originalAmount: op.input.originalAmount,
      originalCurrency: op.input.originalCurrency,
      fxRateScaled: op.input.fxRateScaled,
      fxDate: op.input.fxDate,
      isCustomRate: op.input.isCustomRate,
      settlementAmount: op.input.settlementAmount,
      splitMethod: op.input.split.method,
      payers: allocation.value.payers,
      splits: allocation.value.splits,
      expenseDate: op.input.expenseDate,
      expenseTime: op.input.expenseTime ?? null,
      stopId: op.input.stopId ?? null,
      createdAt: previous?.createdAt ?? op.now,
      updatedAt: previous ? Math.max(op.now, previous.updatedAt + 1) : op.now,
    };
  }
  const delta = next ? effect(next) : new Map<string, number>();
  if (previous)
    for (const [id, value] of effect(previous)) delta.set(id, (delta.get(id) ?? 0) - value);
  for (const [id, value] of delta)
    sql.exec("UPDATE ledger_members SET net_balance=net_balance+? WHERE id=?", value, id);
  if (op.action === "delete") sql.exec("UPDATE ledger_expenses SET deleted=1 WHERE id=?", op.id);
  else if (op.action === "create" && next)
    sql.exec(
      "INSERT INTO ledger_expenses (id,creator_member_id,idempotency_key,data,deleted) VALUES (?,?,?,?,0)",
      next.id,
      op.memberId,
      op.key,
      JSON.stringify(next),
    );
  else if (next)
    sql.exec("UPDATE ledger_expenses SET data=? WHERE id=?", JSON.stringify(next), next.id);
  return { value: next, changed: true };
}
