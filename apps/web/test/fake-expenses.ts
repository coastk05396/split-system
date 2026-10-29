import {
  allocateExpense,
  type CurrencyCode,
  type Expense,
  EXPENSE_PAGE_SIZE,
  expenseInputSchema,
  type Stop,
} from "@split/shared";

/** The Worker's Expense and Stop routes over in-memory rows (tickets 06 and 08 contract). */

export interface ExpenseGroup {
  id: string;
  settlementCurrency: CurrencyCode;
  locked: boolean;
  members: { id: string; status: string; balance: number }[];
}

export interface FakeExpenses {
  /** A Group's Expenses, newest first. */
  list(groupId: string): readonly Expense[];
  /** Seeds existing Expenses onto a Group. */
  seed(groupId: string, items: readonly Expense[]): void;
  /** Seeds a Stop on a Trip; returns its id. */
  addStop(groupId: string, stop: { dayDate: string; title: string; startTime?: string }): string;
  handle(
    route: string,
    parts: readonly string[],
    body: Record<string, unknown>,
    request: { headers: Headers; query: URLSearchParams },
    g: ExpenseGroup,
    me: { id: string },
    now: number,
  ): Response | null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function error(code: string, status: number): Response {
  return json({ error: { code } }, status);
}

export function createFakeExpenses(nextId: (prefix: string) => string): FakeExpenses {
  const byGroup = new Map<string, Expense[]>();
  const keys = new Map<string, string>();
  const stops = new Map<string, Stop[]>();
  const rows = (groupId: string) => {
    const list = byGroup.get(groupId) ?? [];
    byGroup.set(groupId, list);
    return list;
  };

  function moveBalances(g: ExpenseGroup, e: Expense, sign: 1 | -1) {
    for (const p of e.payers) {
      const m = g.members.find((x) => x.id === p.memberId);
      if (m !== undefined) m.balance += sign * p.settlementAmount;
    }
    for (const s of e.splits) {
      const m = g.members.find((x) => x.id === s.memberId);
      if (m !== undefined) m.balance -= sign * s.settlementAmount;
    }
  }

  /** Validates and allocates a body the way the Worker does; a Response on failure. */
  function build(
    g: ExpenseGroup,
    body: Record<string, unknown>,
    base: Pick<Expense, "id" | "groupId" | "creatorMemberId" | "createdAt" | "updatedAt">,
  ): Expense | Response {
    const parsed = expenseInputSchema.safeParse(body);
    if (!parsed.success) return error("VALIDATION_FAILED", 400);
    const input = parsed.data;
    const allocation = allocateExpense(
      input,
      g.settlementCurrency,
      g.members.map((m) => m.id),
    );
    if (!allocation.ok) return error("VALIDATION_FAILED", 400);
    return {
      ...base,
      description: input.description,
      category: input.category,
      originalAmount: input.originalAmount,
      originalCurrency: input.originalCurrency,
      fxRateScaled: input.fxRateScaled,
      fxDate: input.fxDate,
      isCustomRate: input.isCustomRate,
      settlementAmount: input.settlementAmount,
      splitMethod: input.split.method,
      payers: allocation.value.payers,
      splits: allocation.value.splits,
      expenseDate: input.expenseDate,
      expenseTime: input.expenseTime ?? null,
      stopId: input.stopId ?? null,
    };
  }

  return {
    list: (groupId) => [...rows(groupId)].reverse(),

    seed(groupId, items) {
      rows(groupId).push(...items);
    },

    addStop(groupId, stop) {
      const id = nextId("s");
      const list = stops.get(groupId) ?? [];
      list.push({
        id,
        dayDate: stop.dayDate,
        startTime: stop.startTime ?? null,
        endTime: null,
        title: stop.title,
        category: "景點",
        locationName: null,
        notes: null,
        createdAt: 0,
        updatedAt: 0,
      });
      stops.set(groupId, list);
      return id;
    },

    handle(route, parts, body, { headers, query }, g, me, now) {
      const list = rows(g.id);
      const find = () => list.find((e) => e.id === parts[3]);
      switch (route) {
        case "GET groups/:/stops":
          return json((stops.get(g.id) ?? []).filter((s) => s.dayDate === query.get("day")));
        case "GET groups/:/expenses": {
          const newestFirst = [...list].reverse();
          const cursor = query.get("cursor");
          const start = cursor === null ? 0 : newestFirst.findIndex((e) => e.id === cursor) + 1;
          const page = newestFirst.slice(start, start + EXPENSE_PAGE_SIZE);
          const more = start + EXPENSE_PAGE_SIZE < newestFirst.length;
          return json({ expenses: page, nextCursor: more ? (page.at(-1)?.id ?? null) : null });
        }
        case "POST groups/:/expenses": {
          const key = headers.get("Idempotency-Key");
          if (key === null) return error("IDEMPOTENCY_KEY_REQUIRED", 400);
          const seen = keys.get(`${me.id}:${key}`);
          const repeat = list.find((e) => e.id === seen);
          if (repeat !== undefined) return json(repeat, 201);
          const id = nextId("e");
          const built = build(g, body, {
            id,
            groupId: g.id,
            creatorMemberId: me.id,
            createdAt: now,
            updatedAt: now,
          });
          if (built instanceof Response) return built;
          list.push(built);
          keys.set(`${me.id}:${key}`, id);
          moveBalances(g, built, 1);
          g.locked = true;
          return json(built, 201);
        }
        case "GET groups/:/expenses/:": {
          const found = find();
          return found === undefined ? error("NOT_FOUND", 404) : json(found);
        }
        case "PATCH groups/:/expenses/:": {
          const found = find();
          if (found === undefined) return error("NOT_FOUND", 404);
          const ifMatch = headers.get("If-Match");
          if (ifMatch === null) return error("IF_MATCH_REQUIRED", 400);
          if (Number(ifMatch) !== found.updatedAt) return error("EDIT_CONFLICT", 409);
          const built = build(g, body, {
            id: found.id,
            groupId: g.id,
            creatorMemberId: found.creatorMemberId,
            createdAt: found.createdAt,
            updatedAt: Math.max(now, found.updatedAt + 1),
          });
          if (built instanceof Response) return built;
          moveBalances(g, found, -1);
          moveBalances(g, built, 1);
          list.splice(list.indexOf(found), 1, built);
          return json(built);
        }
        case "DELETE groups/:/expenses/:": {
          const found = find();
          if (found === undefined) return error("NOT_FOUND", 404);
          moveBalances(g, found, -1);
          list.splice(list.indexOf(found), 1);
          return new Response(null, { status: 204 });
        }
        default:
          return null;
      }
    },
  };
}
