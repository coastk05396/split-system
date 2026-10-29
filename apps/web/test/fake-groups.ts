import {
  type CurrencyCode,
  type Group,
  INVITE_TTL_MS,
  type Invite,
  type InvitePreview,
  type Me,
  type Member,
  type MemberRole,
  type MemberStatus,
} from "@split/shared";

/** The Worker's Group, Member and Invite routes over in-memory rows (ticket 05 contract). */

const MAX_MEMBERS = 30;

interface FakeMember {
  id: string;
  userId: string | null;
  name: string;
  nickname: string | null;
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
  defaultExpenseCurrency: CurrencyCode;
  isTrip: boolean;
  locked: boolean;
  members: FakeMember[];
  invite: Invite | null;
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
    nickname?: string;
    addedBy?: string;
    expenseCount?: number;
  }[];
  invite?: { token: string; expiresAt?: number } | null;
}

export interface FakeGroups {
  /** Seeds a Group with `user` as a Member (Admin by default); returns its id. */
  add(user: Me | null, seed: SeedGroup): string;
  /** A seeded Group's members, for assertions. */
  members(groupId: string): readonly FakeMember[];
  exists(groupId: string): boolean;
  /** A seeded or created Group's settings, for assertions. */
  summary(
    groupId: string,
  ):
    | Pick<FakeGroup, "name" | "isTrip" | "settlementCurrency" | "defaultExpenseCurrency">
    | undefined;
  /** Answers a groups route, or null when the path is not one. */
  handle(
    method: string,
    path: string,
    body: Record<string, unknown>,
    user: Me | undefined,
  ): Response | null;
  now: number;
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
    return m.nickname ?? m.name;
  }

  function toGroup(g: FakeGroup, me: FakeMember): Group {
    return {
      id: g.id,
      name: g.name,
      settlementCurrency: g.settlementCurrency,
      defaultExpenseCurrency: g.defaultExpenseCurrency,
      isTrip: g.isTrip,
      tripDestination: null,
      tripStartDate: null,
      tripEndDate: null,
      tripNotes: null,
      settlementCurrencyLocked: g.locked,
      memberCount: seated(g).length,
      createdAt: 0,
      updatedAt: 0,
      me: { memberId: me.id, role: me.role, balance: me.balance },
    };
  }

  function toMember(m: FakeMember, me: FakeMember | undefined): Member {
    return {
      id: m.id,
      userId: m.userId,
      displayName: displayName(m),
      nickname: m.nickname,
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

  const fake: FakeGroups = {
    now: 1_700_000_000_000,

    add(user, seed) {
      const id = nextId("g");
      const members: FakeMember[] = [];
      if (user !== null) {
        members.push({
          id: nextId("m"),
          userId: user.id,
          name: user.displayName,
          nickname: null,
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
          nickname: o.nickname ?? null,
          role: o.role ?? "member",
          status,
          balance: o.balance ?? 0,
          createdBy: creator?.id ?? null,
          expenseCount: o.expenseCount ?? 0,
        });
      }
      groups.set(id, {
        id,
        name: seed.name,
        settlementCurrency: seed.settlementCurrency ?? "TWD",
        defaultExpenseCurrency: seed.settlementCurrency ?? "TWD",
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

    exists(groupId) {
      return groups.has(groupId);
    },

    summary(groupId) {
      const g = groups.get(groupId);
      if (g === undefined) return undefined;
      const { name, isTrip, settlementCurrency, defaultExpenseCurrency } = g;
      return { name, isTrip, settlementCurrency, defaultExpenseCurrency };
    },

    handle(method, path, body, user) {
      const parts = path.replace(/^\/api\/v1\//, "").split("/");
      if (parts[0] !== "groups" && parts[0] !== "invites") return null;
      if (user === undefined) return error("UNAUTHORIZED", 401);
      const route = `${method} ${parts.map((p, i) => (i % 2 === 1 ? ":" : p)).join("/")}`;

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
              nickname: null,
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
        g.defaultExpenseCurrency = body.defaultExpenseCurrency === "USD" ? "USD" : "TWD";
        const me = activeMine(g, user);
        return me === undefined ? error("INTERNAL", 500) : json(toGroup(g, me), 201);
      }

      const g = groups.get(parts[1] ?? "");
      const me = g === undefined ? undefined : activeMine(g, user);
      if (g === undefined || me === undefined) return error("NOT_FOUND", 404);
      const isAdmin = me.role === "admin";

      switch (route) {
        case "GET groups/:":
          return json(toGroup(g, me));
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
            nickname: null,
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
          if ("nickname" in body) {
            if (target.id !== me.id) return error("FORBIDDEN", 403);
            target.nickname = typeof body.nickname === "string" ? body.nickname : null;
          }
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
          return error("NOT_FOUND", 404);
      }
    },
  };
  return fake;
}
