import {
  type CurrencyCode,
  type Expense,
  type Group,
  INVITE_TTL_MS,
  type Invite,
  type InvitePreview,
  type Me,
  type Member,
  type MemberRole,
  type MemberStatus,
  type Stop,
} from "@split/shared";
import { createFakeExpenses, type FakeExpenses } from "./fake-expenses.js";
import { createFakeSettlements, type FakeSettlements } from "./fake-settlements.js";

/** The Worker's Group, Member and Invite routes over in-memory rows (ticket 05 contract). */

const MAX_MEMBERS = 30;

interface FakeMember {
  id: string;
  userId: string | null;
  name: string;
  role: MemberRole;
  status: MemberStatus;
  balance: number;
  createdBy: string | null;
  expenseCount: number;
}

interface FakeGroup {
  id: string;
  name: string;
  settlementCurrency: CurrencyCode;
  isTrip: boolean;
  locked: boolean;
  members: FakeMember[];
  invite: Invite | null;
  trip: FakeTrip;
  updatedAt: number;
  stops: Stop[];
  expenses: Expense[];
}

interface FakeTrip {
  tripDestination: string | null;
  tripStartDate: string | null;
  tripEndDate: string | null;
  tripNotes: string | null;
}

/** A seeded Stop; seeded Stops get ids "s-<title>". */
export interface SeedStop {
  dayDate: string;
  title: string;
  startTime?: string;
  endTime?: string;
  category?: string;
  locationName?: string;
  notes?: string;
}

/** A seeded Expense paid and split by the seeding User; `stop` names a seeded Stop's title. */
export interface SeedExpense {
  description: string;
  amount: number;
  currency?: CurrencyCode;
  stop?: string;
}

export interface SeedGroup {
  name: string;
  settlementCurrency?: CurrencyCode;
  isTrip?: boolean;
  role?: MemberRole;
  myBalance?: number;
  /** Other Members; `userId: null` with status "placeholder" makes a Placeholder Member. */
  others?: {
    name: string;
    role?: MemberRole;
    status?: MemberStatus;
    balance?: number;
    addedBy?: string;
    expenseCount?: number;
  }[];
  invite?: { token: string; expiresAt?: number } | null;
  trip?: { destination?: string; startDate?: string; endDate?: string; notes?: string };
  stops?: SeedStop[];
  expenses?: SeedExpense[];
}

export interface FakeGroups {
  /** Seeds a Group with `user` as a Member (Admin by default); returns its id. */
  add(user: Me | null, seed: SeedGroup): string;
  /** A seeded Group's members, for assertions. */
  members(groupId: string): readonly FakeMember[];
  exists(groupId: string): boolean;
  /** A seeded or created Group's settings, for assertions. */
  summary(groupId: string): Pick<FakeGroup, "name" | "isTrip" | "settlementCurrency"> | undefined;
  /** A Group's Trip settings, for assertions. */
  trip(groupId: string): Readonly<FakeTrip> | undefined;
  /** A Group's Stops in the order they were added, for assertions. */
  stops(groupId: string): readonly Stop[];
  /** Answers a groups route, or null when the path is not one. */
  handle(
    method: string,
    path: string,
    body: Record<string, unknown>,
    user: Me | undefined,
    request?: { headers: Headers; query: URLSearchParams } | Headers,
  ): Response | null;
  now: number;
  /** Expenses and Stops of these Groups. */
  expenses: FakeExpenses;
  /** Seeds an Expense created by the `creator`-th Member (an `ExpenseInput` body); returns its id. */
  addExpense(groupId: string, body: Record<string, unknown>, creator?: number): string;
  /** Balances and Settlements of these Groups. */
  settlements: FakeSettlements;
  /** Seeds a Settlement recorded by the `creator`-th Member; returns it as the API would. */
  addSettlement(
    groupId: string,
    body: { payer: number; receiver: number; amount: number },
    creator?: number,
  ): string;
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

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** The Worker's order: day, then start time, untimed Stops last in the order added. */
function sortedStops(stops: readonly Stop[]): Stop[] {
  return [...stops].sort(
    (a, b) =>
      a.dayDate.localeCompare(b.dayDate) ||
      Number(a.startTime === null) - Number(b.startTime === null) ||
      (a.startTime ?? "").localeCompare(b.startTime ?? "") ||
      a.createdAt - b.createdAt,
  );
}

function dayInTrip(g: FakeGroup, day: string): boolean {
  const { tripStartDate: start, tripEndDate: end } = g.trip;
  return (start === null || day >= start) && (end === null || day <= end);
}

function seedExpense(
  groupId: string,
  memberId: string,
  seed: SeedExpense,
  settlementCurrency: CurrencyCode,
): Expense {
  const currency = seed.currency ?? settlementCurrency;
  return {
    id: `e-${seed.description}`,
    groupId,
    creatorMemberId: memberId,
    description: seed.description,
    category: "餐飲",
    originalAmount: seed.amount,
    originalCurrency: currency,
    fxRateScaled: 1_000_000,
    fxDate: "2026-06-13",
    isCustomRate: false,
    settlementAmount: seed.amount,
    splitMethod: "equal",
    payers: [{ memberId, amountMinor: seed.amount, settlementAmount: seed.amount }],
    splits: [{ memberId, shares: null, amountMinor: seed.amount, settlementAmount: seed.amount }],
    expenseDate: "2026-06-13",
    expenseTime: null,
    stopId: seed.stop === undefined ? null : `s-${seed.stop}`,
    createdAt: 0,
    updatedAt: 0,
  };
}

export function createFakeGroups(): FakeGroups {
  const groups = new Map<string, FakeGroup>();
  let seq = 0;
  const nextId = (prefix: string) => {
    seq += 1;
    return `${prefix}-${String(seq)}`;
  };

  const seated = (g: FakeGroup) => g.members.filter((m) => m.status !== "former");
  const mine = (g: FakeGroup, user: Me) => g.members.find((m) => m.userId === user.id);
  const activeMine = (g: FakeGroup, user: Me) => {
    const m = mine(g, user);
    return m?.status === "active" ? m : undefined;
  };

  function displayName(m: FakeMember): string {
    return m.name;
  }

  function toGroup(g: FakeGroup, me: FakeMember): Group {
    return {
      id: g.id,
      name: g.name,
      settlementCurrency: g.settlementCurrency,
      isTrip: g.isTrip,
      ...g.trip,
      settlementCurrencyLocked: g.locked,
      memberCount: seated(g).length,
      memberPreview: seated(g)
        .slice(0, 4)
        .map((m) => ({ name: displayName(m), pictureUrl: null })),
      createdAt: 0,
      updatedAt: g.updatedAt,
      me: { memberId: me.id, role: me.role, balance: me.balance },
    };
  }

  function toMember(m: FakeMember, me: FakeMember | undefined): Member {
    return {
      id: m.id,
      userId: m.userId,
      displayName: displayName(m),
      pictureUrl: null,
      role: m.role,
      status: m.status,
      balance: m.balance,
      isMe: m.id === me?.id,
    };
  }

  function openInvite(token: string, now: number): FakeGroup | Response {
    const g = [...groups.values()].find((x) => x.invite?.token === token);
    if (g?.invite == null) return error("NOT_FOUND", 404);
    if (g.invite.expiresAt <= now) return error("INVITE_EXPIRED", 422);
    return g;
  }

  const expenses = createFakeExpenses(nextId);
  expenses.addStop = (groupId, stop) => {
    const g = groups.get(groupId);
    seq += 1;
    const id = `s-${String(seq)}`;
    const s: Stop = {
      id,
      dayDate: stop.dayDate,
      startTime: stop.startTime ?? null,
      endTime: null,
      title: stop.title,
      category: "景點",
      locationName: null,
      notes: null,
      createdAt: fake.now + seq,
      updatedAt: fake.now + seq,
    };
    if (g) g.stops.push(s);
    return id;
  };

  const fake: FakeGroups = {
    now: 1_700_000_000_000,
    expenses,
    settlements: createFakeSettlements(nextId),

    addSettlement(groupId, { payer, receiver, amount }, creator = 0) {
      const g = groups.get(groupId);
      const me = g?.members[creator];
      if (g === undefined || me === undefined) throw new Error(`no Group ${groupId}`);
      const res = fake.settlements.handle(
        "POST groups/:/settlements",
        ["groups", groupId, "settlements"],
        { payerMemberId: g.members[payer]?.id, receiverMemberId: g.members[receiver]?.id, amount },
        new Headers({ "Idempotency-Key": nextId("key") }),
        g,
        me,
        fake.now,
      );
      if (res?.status !== 201) throw new Error(`seed Settlement refused: ${String(res?.status)}`);
      return fake.settlements.list(groupId)[0]?.id ?? "";
    },

    add(user, seed) {
      const id = nextId("g");
      const members: FakeMember[] = [];
      if (user !== null) {
        members.push({
          id: nextId("m"),
          userId: user.id,
          name: user.displayName,
          role: seed.role ?? "admin",
          status: "active",
          balance: seed.myBalance ?? 0,
          createdBy: null,
          expenseCount: 0,
        });
      }
      for (const o of seed.others ?? []) {
        const status = o.status ?? "active";
        const creator = members.find((m) => m.name === o.addedBy);
        members.push({
          id: nextId("m"),
          userId: status === "placeholder" ? null : `u-${o.name}`,
          name: o.name,
          role: o.role ?? "member",
          status,
          balance: o.balance ?? 0,
          createdBy: creator?.id ?? null,
          expenseCount: o.expenseCount ?? 0,
        });
      }
      const owner = members[0]?.id ?? "m-none";
      const stops: Stop[] = (seed.stops ?? []).map((x, i) => ({
        id: `s-${x.title}`,
        dayDate: x.dayDate,
        startTime: x.startTime ?? null,
        endTime: x.endTime ?? null,
        title: x.title,
        category: x.category ?? "景點",
        locationName: x.locationName ?? null,
        notes: x.notes ?? null,
        createdAt: fake.now + i,
        updatedAt: fake.now + i,
      }));
      const expenses = (seed.expenses ?? []).map((x) =>
        seedExpense(id, owner, x, seed.settlementCurrency ?? "TWD"),
      );
      fake.expenses.seed(id, expenses);
      groups.set(id, {
        id,
        trip: {
          tripDestination: seed.trip?.destination ?? null,
          tripStartDate: seed.trip?.startDate ?? null,
          tripEndDate: seed.trip?.endDate ?? null,
          tripNotes: seed.trip?.notes ?? null,
        },
        updatedAt: fake.now,
        stops,
        expenses,
        name: seed.name,
        settlementCurrency: seed.settlementCurrency ?? "TWD",
        isTrip: seed.isTrip ?? false,
        locked: false,
        members,
        invite:
          seed.invite == null
            ? null
            : {
                token: seed.invite.token,
                expiresAt: seed.invite.expiresAt ?? fake.now + INVITE_TTL_MS,
              },
      });
      return id;
    },

    members(groupId) {
      return groups.get(groupId)?.members ?? [];
    },

    addExpense(groupId, body, creator = 0) {
      const g = groups.get(groupId);
      const me = g?.members[creator];
      if (g === undefined || me === undefined) throw new Error(`no Group ${groupId}`);
      const headers = new Headers({ "Idempotency-Key": nextId("key") });
      const res = fake.expenses.handle(
        "POST groups/:/expenses",
        ["groups", groupId, "expenses"],
        body,
        { headers, query: new URLSearchParams() },
        g,
        me,
        fake.now,
      );
      if (res?.status !== 201) throw new Error(`seed Expense refused: ${String(res?.status)}`);
      return fake.expenses.list(groupId)[0]?.id ?? "";
    },

    exists(groupId) {
      return groups.has(groupId);
    },

    summary(groupId) {
      const g = groups.get(groupId);
      if (g === undefined) return undefined;
      const { name, isTrip, settlementCurrency } = g;
      return { name, isTrip, settlementCurrency };
    },

    trip(groupId) {
      return groups.get(groupId)?.trip;
    },

    stops(groupId) {
      return groups.get(groupId)?.stops ?? [];
    },

    handle(
      method,
      path,
      body,
      user,
      request = { headers: new Headers(), query: new URLSearchParams() },
    ) {
      const headers = request instanceof Headers ? request : request.headers;
      const parts = path
        .replace(/^\/api\/v1\//, "")
        .split("/")
        .map(decodeURIComponent);
      if (parts[0] !== "groups" && parts[0] !== "invites" && parts[0] !== "settlements") {
        return null;
      }
      if (user === undefined) return error("UNAUTHORIZED", 401);
      const route = `${method} ${parts.map((p, i) => (i % 2 === 1 ? ":" : p)).join("/")}`;

      if (parts[0] === "settlements") {
        const g = groups.get(fake.settlements.groupOf(parts[1] ?? "") ?? "");
        const me = g === undefined ? undefined : activeMine(g, user);
        if (g === undefined || me === undefined) return error("NOT_FOUND", 404);
        return (
          fake.settlements.handle(route, parts, body, headers, g, me, fake.now) ??
          error("NOT_FOUND", 404)
        );
      }

      if (parts[0] === "invites") {
        const opened = openInvite(parts[1] ?? "", fake.now);
        if (opened instanceof Response) return opened;
        const g = opened;
        const own = mine(g, user);
        switch (route) {
          case "GET invites/:": {
            const isMember = own?.status === "active";
            if (!isMember && seated(g).length >= MAX_MEMBERS) return error("GROUP_FULL", 409);
            const preview: InvitePreview = {
              groupId: g.id,
              groupName: g.name,
              settlementCurrency: g.settlementCurrency,
              memberCount: seated(g).length,
              expiresAt: g.invite?.expiresAt ?? 0,
              isMember,
              placeholders: g.members
                .filter((m) => m.status === "placeholder")
                .map((m) => ({
                  memberId: m.id,
                  name: m.name,
                  addedBy: g.members.find((c) => c.id === m.createdBy)?.name ?? null,
                  balance: m.balance,
                  expenseCount: m.expenseCount,
                })),
            };
            return json(preview);
          }
          case "POST invites/:/join": {
            if (own?.status === "active") return json({ groupId: g.id, memberId: own.id });
            if (seated(g).length >= MAX_MEMBERS) return error("GROUP_FULL", 409);
            const row: FakeMember = {
              id: nextId("m"),
              userId: user.id,
              name: user.displayName,
              role: "member",
              status: "active",
              balance: 0,
              createdBy: null,
              expenseCount: 0,
            };
            g.members.push(row);
            return json({ groupId: g.id, memberId: row.id });
          }
          case "POST invites/:/claim": {
            if (own !== undefined) return error("ALREADY_MEMBER", 409);
            const target = g.members.find((m) => m.id === body.memberId);
            if (target === undefined) return error("NOT_FOUND", 404);
            if (target.status !== "placeholder") return error("PLACEHOLDER_CLAIMED", 409);
            Object.assign(target, { userId: user.id, status: "active", name: user.displayName });
            return json({ groupId: g.id, memberId: target.id });
          }
          default:
            return error("NOT_FOUND", 404);
        }
      }

      if (route === "GET groups") {
        const list = [...groups.values()].reverse().flatMap((g) => {
          const me = activeMine(g, user);
          return me === undefined ? [] : [toGroup(g, me)];
        });
        return json(list);
      }
      if (route === "POST groups") {
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (name === "") return error("VALIDATION_FAILED", 400);
        const id = fake.add(user, {
          name,
          settlementCurrency: body.settlementCurrency === "USD" ? "USD" : "TWD",
          isTrip: body.isTrip === true,
        });
        const g = groups.get(id);
        if (g === undefined) return error("INTERNAL", 500);
        const me = activeMine(g, user);
        return me === undefined ? error("INTERNAL", 500) : json(toGroup(g, me), 201);
      }

      const g = groups.get(parts[1] ?? "");
      const me = g === undefined ? undefined : activeMine(g, user);
      if (g === undefined || me === undefined) return error("NOT_FOUND", 404);
      const isAdmin = me.role === "admin";

      const reqObj =
        request instanceof Headers ? { headers: request, query: new URLSearchParams() } : request;
      switch (route) {
        case "GET groups/:":
          return json(toGroup(g, me));
        case "PATCH groups/:": {
          if (!isAdmin) return error("FORBIDDEN", 403);
          if (headers.get("If-Match") !== String(g.updatedAt)) return error("EDIT_CONFLICT", 409);
          const start = "tripStartDate" in body ? body.tripStartDate : g.trip.tripStartDate;
          const end = "tripEndDate" in body ? body.tripEndDate : g.trip.tripEndDate;
          if (typeof start === "string" && typeof end === "string") {
            const days = (Date.parse(end) - Date.parse(start)) / 86_400_000 + 1;
            if (days < 1 || days > 31) return error("VALIDATION_FAILED", 400);
          }
          for (const key of Object.keys(g.trip) as (keyof FakeTrip)[]) {
            if (key in body) g.trip[key] = textOrNull(body[key]);
          }
          g.updatedAt += 1;
          return json(toGroup(g, me));
        }
        case "GET groups/:/stops": {
          const day = reqObj.query.get("day");
          const stops = day ? g.stops.filter((s) => s.dayDate === day) : g.stops;
          return json(sortedStops(stops));
        }
        case "POST groups/:/stops": {
          if (!g.isTrip) return error("TRIP_MODULE_OFF", 409);
          seq += 1;
          const stop: Stop = {
            id: `s-${String(seq)}`,
            dayDate: textOrNull(body.dayDate) ?? "",
            startTime: textOrNull(body.startTime),
            endTime: textOrNull(body.endTime),
            title: textOrNull(body.title) ?? "",
            category: textOrNull(body.category) ?? "",
            locationName: textOrNull(body.locationName),
            notes: textOrNull(body.notes),
            createdAt: fake.now + seq,
            updatedAt: fake.now + seq,
          };
          if (!dayInTrip(g, stop.dayDate)) return error("VALIDATION_FAILED", 400);
          g.stops.push(stop);
          return json(stop, 201);
        }
        case "PATCH groups/:/stops/:": {
          const stop = g.stops.find((x) => x.id === parts[3]);
          if (stop === undefined) return error("NOT_FOUND", 404);
          if (headers.get("If-Match") !== String(stop.updatedAt)) {
            return error("EDIT_CONFLICT", 409);
          }
          const next: Stop = { ...stop, updatedAt: stop.updatedAt + 1 };
          if (typeof body.dayDate === "string") next.dayDate = body.dayDate;
          if (typeof body.title === "string") next.title = body.title;
          if (typeof body.category === "string") next.category = body.category;
          if ("startTime" in body) next.startTime = textOrNull(body.startTime);
          if ("endTime" in body) next.endTime = textOrNull(body.endTime);
          if ("locationName" in body) next.locationName = textOrNull(body.locationName);
          if ("notes" in body) next.notes = textOrNull(body.notes);
          if (!dayInTrip(g, next.dayDate)) return error("VALIDATION_FAILED", 400);
          Object.assign(stop, next);
          return json(stop);
        }
        case "DELETE groups/:/stops/:": {
          const before = g.stops.length;
          g.stops = g.stops.filter((x) => x.id !== parts[3]);
          if (g.stops.length === before) return error("NOT_FOUND", 404);
          for (const e of fake.expenses.list(g.id))
            if (e.stopId === parts[3]) (e as { stopId: string | null }).stopId = null;
          for (const e of g.expenses) if (e.stopId === parts[3]) e.stopId = null;
          return new Response(null, { status: 204 });
        }
        case "DELETE groups/:":
          if (!isAdmin) return error("FORBIDDEN", 403);
          groups.delete(g.id);
          return new Response(null, { status: 204 });
        case "GET groups/:/members":
          return json(g.members.map((m) => toMember(m, me)));
        case "POST groups/:/members": {
          const name = typeof body.name === "string" ? body.name.trim() : "";
          if (name === "") return error("VALIDATION_FAILED", 400);
          if (seated(g).length >= MAX_MEMBERS) return error("GROUP_FULL", 409);
          if (seated(g).some((m) => displayName(m) === name)) {
            return error("PLACEHOLDER_NAME_TAKEN", 409);
          }
          const row: FakeMember = {
            id: nextId("m"),
            userId: null,
            name,
            role: "member",
            status: "placeholder",
            balance: 0,
            createdBy: me.id,
            expenseCount: 0,
          };
          g.members.push(row);
          return json(toMember(row, me), 201);
        }
        case "PATCH groups/:/members/:": {
          const target = g.members.find((m) => m.id === parts[3]);
          if (target === undefined) return error("NOT_FOUND", 404);
          if ("nickname" in body) return error("VALIDATION_FAILED", 400);
          if (body.role === "admin" || body.role === "member") {
            if (!isAdmin) return error("FORBIDDEN", 403);
            const admins = g.members.filter((m) => m.status === "active" && m.role === "admin");
            if (body.role === "member" && target.role === "admin" && admins.length === 1) {
              return error("LAST_ADMIN", 409);
            }
            target.role = body.role;
          }
          return json(toMember(target, me));
        }
        case "DELETE groups/:/members/:": {
          if (!isAdmin) return error("FORBIDDEN", 403);
          const target = g.members.find((m) => m.id === parts[3]);
          if (target === undefined) return error("NOT_FOUND", 404);
          if (target.balance !== 0) return error("BALANCE_NOT_ZERO", 409);
          if (target.status === "placeholder") {
            g.members = g.members.filter((m) => m !== target);
          } else {
            target.status = "former";
          }
          return new Response(null, { status: 204 });
        }
        case "GET groups/:/invite":
          if (g.invite === null || g.invite.expiresAt <= fake.now) return error("NOT_FOUND", 404);
          return json(g.invite);
        case "POST groups/:/invite":
          if (!isAdmin) return error("FORBIDDEN", 403);
          g.invite = { token: nextId("token"), expiresAt: fake.now + INVITE_TTL_MS };
          return json(g.invite, 201);
        default:
          return (
            fake.expenses.handle(route, parts, body, reqObj, g, me, fake.now) ??
            fake.settlements.handle(route, parts, body, headers, g, me, fake.now) ??
            error("NOT_FOUND", 404)
          );
      }
    },
  };
  return fake;
}
