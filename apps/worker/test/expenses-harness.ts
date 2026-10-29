import type { Expense, ExpenseInput } from "@split/shared";
import type { Session } from "./auth-harness.js";
import { send } from "./groups-harness.js";

let keyCounter = 0;
export function newKey(): string {
  keyCounter += 1;
  return `key-${String(keyCounter)}-${crypto.randomUUID()}`;
}

/** A NT$ Expense paid in full by `payer`, split equally among `participants`. */
export function twdExpense(
  payer: string,
  participants: string[],
  amount = 600,
  overrides: Partial<ExpenseInput> = {},
): ExpenseInput {
  return {
    description: "晚餐",
    category: "food",
    originalAmount: amount,
    originalCurrency: "TWD",
    fxRateScaled: 1_000_000,
    fxDate: "2026-06-13",
    isCustomRate: false,
    settlementAmount: amount,
    payers: [{ memberId: payer, amountMinor: amount }],
    split: { method: "equal", participants },
    expenseDate: "2026-06-13",
    ...overrides,
  };
}

export function postExpense(
  session: Session,
  groupId: string,
  body: unknown,
  key: string = newKey(),
): Promise<Response> {
  return send(session, "POST", `/groups/${groupId}/expenses`, body, { "Idempotency-Key": key });
}

export async function createExpense(
  session: Session,
  groupId: string,
  body: ExpenseInput,
): Promise<Expense> {
  const res = await postExpense(session, groupId, body);
  if (res.status !== 201) throw new Error(`create expense: ${res.status} ${await res.text()}`);
  return res.json<Expense>();
}

export interface BalancesBody {
  settlementCurrency: string;
  balances: { memberId: string; displayName: string; status: string; balance: number }[];
}

export async function balances(session: Session, groupId: string): Promise<Map<string, number>> {
  const res = await send(session, "GET", `/groups/${groupId}/balances`);
  if (res.status !== 200) throw new Error(`balances: ${res.status} ${await res.text()}`);
  const body = await res.json<BalancesBody>();
  return new Map(body.balances.map((b) => [b.memberId, b.balance]));
}
