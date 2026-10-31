import {
  settlementInputSchema,
  settlementSchema,
  SETTLEMENT_PAGE_SIZE,
  type Settlement,
} from "@split/shared";
import { z } from "zod";
import { ApiError, invalid } from "./errors.js";
import { newSortableId } from "./ids.js";

const commandSchema = z.object({
  action: z.enum(["list", "create", "confirm", "cancel", "undo"]),
  actorId: z.string(),
  now: z.number().int(),
  cursor: z.string().optional(),
  id: z.string().optional(),
  key: z.string().optional(),
  input: z.unknown().optional(),
  amount: z.number().int().optional(),
});
type Party = { id: string; role: string; status: string; net_balance: number };
interface Row extends Record<string, SqlStorageValue> {
  data: string;
}

/** Must run inside the ledger transaction; callers publish changes only after commit. */
export function settlementOperation(
  sql: SqlStorage,
  raw: unknown,
): { data: unknown; changed: boolean; id?: string } {
  const parsed = commandSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError("VALIDATION_FAILED");
  const op = parsed.data;
  const actor = sql
    .exec<Party>(
      "SELECT id,role,status,net_balance FROM ledger_members WHERE id=? AND status='active'",
      op.actorId,
    )
    .toArray()[0];
  if (actor === undefined) throw new ApiError("NOT_FOUND");
  if (op.action === "list") {
    const rows =
      op.cursor === undefined
        ? sql
            .exec<Row>(
              "SELECT data FROM ledger_settlements ORDER BY id DESC LIMIT ?",
              SETTLEMENT_PAGE_SIZE + 1,
            )
            .toArray()
        : sql
            .exec<Row>(
              "SELECT data FROM ledger_settlements WHERE id < ? ORDER BY id DESC LIMIT ?",
              op.cursor,
              SETTLEMENT_PAGE_SIZE + 1,
            )
            .toArray();
    const page = rows
      .slice(0, SETTLEMENT_PAGE_SIZE)
      .map((row) => settlementSchema.parse(JSON.parse(row.data) as unknown));
    return {
      data: {
        settlements: page,
        nextCursor: rows.length > SETTLEMENT_PAGE_SIZE ? (page.at(-1)?.id ?? null) : null,
      },
      changed: false,
    };
  }
  const member = (id: string) =>
    sql
      .exec<Party>("SELECT id,role,status,net_balance FROM ledger_members WHERE id=?", id)
      .toArray()[0];
  const save = (item: Settlement, key: string | null) =>
    sql.exec(
      "INSERT INTO ledger_settlements (id,data,idempotency_key) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      item.id,
      JSON.stringify(item),
      key,
    );
  const move = (item: Settlement, sign: number) => {
    sql.exec(
      "UPDATE ledger_members SET net_balance=net_balance+? WHERE id=?",
      item.amount * sign,
      item.payerMemberId,
    );
    sql.exec(
      "UPDATE ledger_members SET net_balance=net_balance-? WHERE id=?",
      item.amount * sign,
      item.receiverMemberId,
    );
  };
  const parties = (payerId: string, receiverId: string) => {
    const payer = member(payerId),
      receiver = member(receiverId);
    if (payer === undefined || receiver === undefined)
      throw invalid("payerMemberId", "MEMBER_NOT_IN_GROUP");
    if (payer.status === "former" || receiver.status === "former")
      throw new ApiError("MEMBER_NOT_ACTIVE");
    return { payer, receiver };
  };
  const withinDebt = (payer: Party, receiver: Party, amount: number) => {
    const maxAmount = Math.max(0, Math.min(-payer.net_balance, receiver.net_balance));
    if (amount > maxAmount) throw new ApiError("SETTLEMENT_EXCEEDS_DEBT", { maxAmount });
  };
  const canConfirm = (payer: Party, receiver: Party) =>
    actor.id === payer.id || actor.id === receiver.id || actor.role === "admin";
  if (op.action === "create") {
    if (op.key === undefined) throw new ApiError("VALIDATION_FAILED");
    const storedKey = `${actor.id}:${op.key}`;
    const existing = sql
      .exec<Row>("SELECT data FROM ledger_settlements WHERE idempotency_key=?", storedKey)
      .toArray()[0];
    if (existing !== undefined)
      return { data: settlementSchema.parse(JSON.parse(existing.data) as unknown), changed: false };
    const result = settlementInputSchema.safeParse(op.input);
    if (!result.success) throw new ApiError("VALIDATION_FAILED");
    const input = result.data,
      found = parties(input.payerMemberId, input.receiverMemberId);
    if (actor.id !== found.payer.id && actor.id !== found.receiver.id && actor.role !== "admin")
      throw new ApiError("FORBIDDEN");
    withinDebt(found.payer, found.receiver, input.amount);
    const group = sql.exec<{ id: string }>("SELECT id FROM ledger_group WHERE deleted=0").one();
    const item: Settlement = {
      id: newSortableId(op.now),
      groupId: group.id,
      ...input,
      status: "confirmed",
      createdByMemberId: actor.id,
      confirmedByMemberId: actor.id,
      confirmedAt: op.now,
      undoneByMemberId: null,
      undoneAt: null,
      createdAt: op.now,
      updatedAt: op.now,
    };
    save(item, storedKey);
    move(item, 1);
    return { data: item, changed: true, id: item.id };
  }
  if (op.id === undefined) throw new ApiError("NOT_FOUND");
  const existing = sql
    .exec<Row>("SELECT data FROM ledger_settlements WHERE id=?", op.id)
    .toArray()[0];
  if (existing === undefined) throw new ApiError("NOT_FOUND");
  const item = settlementSchema.parse(JSON.parse(existing.data) as unknown);
  if (op.action === "confirm") {
    if (item.status !== "pending") throw new ApiError("SETTLEMENT_NOT_PENDING");
    const { payer, receiver } = parties(item.payerMemberId, item.receiverMemberId);
    if (!canConfirm(payer, receiver)) throw new ApiError("FORBIDDEN");
    if (op.amount !== undefined && (op.amount <= 0 || op.amount > item.amount))
      throw invalid("amount", "AMOUNT_EXCEEDS_RECORDED_SETTLEMENT");
    const paid = op.amount ?? item.amount;
    withinDebt(payer, receiver, paid);
    item.amount = paid;
    item.status = "confirmed";
    item.confirmedByMemberId = actor.id;
    item.confirmedAt = op.now;
    move(item, 1);
  } else if (op.action === "cancel") {
    if (item.status !== "pending") throw new ApiError("SETTLEMENT_NOT_PENDING");
    if (
      actor.id !== item.payerMemberId &&
      actor.id !== item.createdByMemberId &&
      actor.role !== "admin"
    )
      throw new ApiError("FORBIDDEN");
    item.status = "cancelled";
  } else {
    if (item.status !== "confirmed") throw new ApiError("SETTLEMENT_NOT_CONFIRMED");
    if (
      actor.id !== item.payerMemberId &&
      actor.id !== item.receiverMemberId &&
      actor.id !== item.confirmedByMemberId &&
      actor.role !== "admin"
    )
      throw new ApiError("FORBIDDEN");
    parties(item.payerMemberId, item.receiverMemberId);
    item.status = "undone";
    item.undoneByMemberId = actor.id;
    item.undoneAt = op.now;
    move(item, -1);
  }
  item.updatedAt = Math.max(op.now, item.updatedAt + 1);
  save(item, null);
  return { data: item, changed: true, id: item.id };
}
