import {
  canConfirmSettlement,
  canUndoSettlement,
  maxPayable,
  type MemberRole,
  type Settlement,
  type SettlementInput,
  SETTLEMENT_PAGE_SIZE,
  settlementSchema,
} from "@split/shared";
import { ApiError, invalid } from "./errors.js";
import { newSortableId } from "./ids.js";

export type SettlementCommand =
  | { action: "list"; actorId: string; now: number; cursor?: string | undefined }
  | { action: "create"; actorId: string; now: number; key: string; input: SettlementInput }
  | { action: "undo"; actorId: string; now: number; id: string };

type Party = { id: string; role: MemberRole; status: string; net_balance: number };
interface Row extends Record<string, SqlStorageValue> {
  data: string;
}

/** Must run inside the ledger transaction; callers publish changes only after commit. */
export function settlementOperation(
  sql: SqlStorage,
  op: SettlementCommand,
): { data: unknown; changed: boolean; id?: string } {
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
  if (op.action === "create") {
    const storedKey = `${actor.id}:${op.key}`;
    const existing = sql
      .exec<Row>("SELECT data FROM ledger_settlements WHERE idempotency_key=?", storedKey)
      .toArray()[0];
    if (existing !== undefined)
      return { data: settlementSchema.parse(JSON.parse(existing.data) as unknown), changed: false };
    const input = op.input,
      found = parties(input.payerMemberId, input.receiverMemberId);
    if (
      !canConfirmSettlement(
        { memberId: actor.id, role: actor.role },
        found.payer.id,
        found.receiver.id,
      )
    )
      throw new ApiError("FORBIDDEN");
    const maxAmount = maxPayable(found.payer.net_balance, found.receiver.net_balance);
    if (input.amount > maxAmount) throw new ApiError("SETTLEMENT_EXCEEDS_DEBT", { maxAmount });
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
  const existing = sql
    .exec<Row>("SELECT data FROM ledger_settlements WHERE id=?", op.id)
    .toArray()[0];
  if (existing === undefined) throw new ApiError("NOT_FOUND");
  const item = settlementSchema.parse(JSON.parse(existing.data) as unknown);
  if (item.status !== "confirmed") throw new ApiError("SETTLEMENT_NOT_CONFIRMED");
  if (!canUndoSettlement({ memberId: actor.id, role: actor.role }, item))
    throw new ApiError("FORBIDDEN");
  parties(item.payerMemberId, item.receiverMemberId);
  item.status = "undone";
  item.undoneByMemberId = actor.id;
  item.undoneAt = op.now;
  move(item, -1);
  item.updatedAt = Math.max(op.now, item.updatedAt + 1);
  save(item, null);
  return { data: item, changed: true, id: item.id };
}
