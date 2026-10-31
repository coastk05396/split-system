import type { Settlement } from "@split/shared";

/** The Worker's Balance and Settlement routes over in-memory rows (tickets 06 and 07 contract). */

export interface SettlementGroup {
  id: string;
  settlementCurrency: string;
  members: {
    id: string;
    name: string;
    status: string;
    role: string;
    balance: number;
  }[];
}

type Caller = SettlementGroup["members"][number];

export interface FakeSettlements {
  /** A Group's Settlements, newest first. */
  list(groupId: string): readonly Settlement[];
  /** The Group a Settlement belongs to, for `/settlements/:sid` routes. */
  groupOf(settlementId: string): string | undefined;
  handle(
    route: string,
    parts: readonly string[],
    body: Record<string, unknown>,
    headers: Headers,
    g: SettlementGroup,
    me: Caller,
    now: number,
  ): Response | null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function error(code: string, status: number, details?: unknown): Response {
  return json({ error: { code, ...(details === undefined ? {} : { details }) } }, status);
}

export function createFakeSettlements(nextId: (prefix: string) => string): FakeSettlements {
  const byGroup = new Map<string, Settlement[]>();
  const keys = new Map<string, string>();
  const rows = (groupId: string) => {
    const list = byGroup.get(groupId) ?? [];
    byGroup.set(groupId, list);
    return list;
  };

  const owed = (payer: Caller, receiver: Caller) =>
    Math.max(0, Math.min(-payer.balance, receiver.balance));
  const canConfirm = (me: Caller, payer: Caller, receiver: Caller) =>
    me.id === payer.id || me.id === receiver.id || me.role === "admin";
  const move = (payer: Caller, receiver: Caller, amount: number) => {
    payer.balance += amount;
    receiver.balance -= amount;
  };

  return {
    list: (groupId) => [...rows(groupId)].reverse(),
    groupOf: (settlementId) =>
      [...byGroup.entries()].find(([, list]) => list.some((s) => s.id === settlementId))?.[0],

    handle(route, parts, body, headers, g, me, now) {
      const list = rows(g.id);
      const member = (id: unknown) => g.members.find((m) => m.id === id);
      switch (route) {
        case "GET groups/:/balances":
          return json({
            settlementCurrency: g.settlementCurrency,
            balances: g.members.map((m) => ({
              memberId: m.id,
              displayName: m.name,
              status: m.status,
              balance: m.balance,
            })),
          });
        case "GET groups/:/settlements":
          return json({ settlements: [...list].reverse(), nextCursor: null });
        case "POST groups/:/settlements": {
          const key = headers.get("Idempotency-Key");
          if (key === null) return error("IDEMPOTENCY_KEY_REQUIRED", 400);
          const repeat = list.find((s) => s.id === keys.get(`${me.id}:${key}`));
          if (repeat !== undefined) return json(repeat, 201);
          const payer = member(body.payerMemberId);
          const receiver = member(body.receiverMemberId);
          const amount = body.amount;
          if (
            payer === undefined ||
            receiver === undefined ||
            payer === receiver ||
            typeof amount !== "number" ||
            !Number.isInteger(amount) ||
            amount < 1
          ) {
            return error("VALIDATION_FAILED", 400);
          }
          if (!canConfirm(me, payer, receiver)) {
            return error("FORBIDDEN", 403);
          }
          const max = owed(payer, receiver);
          if (amount > max) return error("SETTLEMENT_EXCEEDS_DEBT", 422, { maxAmount: max });
          const row: Settlement = {
            id: nextId("st"),
            groupId: g.id,
            payerMemberId: payer.id,
            receiverMemberId: receiver.id,
            amount,
            status: "confirmed",
            createdByMemberId: me.id,
            confirmedByMemberId: me.id,
            confirmedAt: now,
            undoneByMemberId: null,
            undoneAt: null,
            createdAt: now,
            updatedAt: now,
          };
          move(payer, receiver, amount);
          list.push(row);
          keys.set(`${me.id}:${key}`, row.id);
          return json(row, 201);
        }
      }

      const row = list.find((s) => s.id === parts[1]);
      if (row === undefined) return null;
      const payer = member(row.payerMemberId);
      const receiver = member(row.receiverMemberId);
      if (payer === undefined || receiver === undefined) return error("NOT_FOUND", 404);
      switch (route) {
        case "POST settlements/:/confirm": {
          if (row.status !== "pending") return error("SETTLEMENT_NOT_PENDING", 409);
          if (!canConfirm(me, payer, receiver)) return error("FORBIDDEN", 403);
          const paid = typeof body.amount === "number" ? body.amount : row.amount;
          const max = owed(payer, receiver);
          if (paid > max) return error("SETTLEMENT_EXCEEDS_DEBT", 422, { maxAmount: max });
          Object.assign(row, {
            status: "confirmed",
            amount: paid,
            confirmedByMemberId: me.id,
            confirmedAt: now,
            updatedAt: now,
          });
          move(payer, receiver, paid);
          return json(row);
        }
        case "POST settlements/:/cancel":
          if (row.status !== "pending") return error("SETTLEMENT_NOT_PENDING", 409);
          if (me.id !== payer.id && me.id !== row.createdByMemberId && me.role !== "admin") {
            return error("FORBIDDEN", 403);
          }
          Object.assign(row, { status: "cancelled", updatedAt: now });
          return json(row);
        case "POST settlements/:/undo":
          if (row.status !== "confirmed") return error("SETTLEMENT_NOT_CONFIRMED", 409);
          if (
            me.id !== payer.id &&
            me.id !== receiver.id &&
            me.id !== row.confirmedByMemberId &&
            me.role !== "admin"
          ) {
            return error("FORBIDDEN", 403);
          }
          Object.assign(row, { status: "undone", undoneByMemberId: me.id, undoneAt: now });
          move(payer, receiver, -row.amount);
          return json(row);
        default:
          return null;
      }
    },
  };
}
