import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import { z } from "zod";
import { call, clock, type Session } from "./auth-harness.js";
import { createExpense, newKey, twdExpense } from "./expenses-harness.js";
import {
  at,
  createGroup,
  groupWith,
  inviteToken,
  listMembers,
  person,
  send,
} from "./groups-harness.js";

/*
 * What each kind of Group ledger write does after it commits, as it behaves today: whether the
 * Group's rev moves, whether its summary reaches D1, the signal an open screen gets, and which
 * live connections close.
 *
 * Signals: "unordered" goes out before the push starts, so only its count is observable;
 * "after push" finds D1's summary already final when it arrives. A one-batch push wins that race
 * anyway, so claim, leave and remove carry enough Expenses to need a second batch.
 * Closes: "target" closes the screens of the Member the write is about; "all" closes every screen.
 */

interface Scene {
  /** Absent until the write itself creates the Group. */
  groupId?: string;
  /** A Member whose open screen watches for the signal. */
  observer?: Session;
  /** The Member whose screens the write closes. */
  target?: Session;
  /** The write under test; resolves to the Group's id. */
  write: () => Promise<string>;
}

interface Row {
  write: string;
  rev: "bumped" | "unchanged" | "starts at 0";
  pushed: boolean;
  signal: "none" | "unordered" | "after push";
  closes: "none" | "target" | "all";
  scene: () => Promise<Scene>;
}

const expires = clock.now + 600_000;

function ledger(groupId: string) {
  return env.GROUP_LEDGER.get(env.GROUP_LEDGER.idFromName(groupId));
}

function ledgerRev(groupId: string): Promise<number> {
  return runInDurableObject(
    ledger(groupId),
    (_instance, state) =>
      state.storage.sql.exec<{ rev: number }>("SELECT rev FROM ledger_meta").one().rev,
  );
}

async function summaryRev(groupId: string): Promise<number | null> {
  const row = await env.DB.prepare("SELECT rev FROM group_directory WHERE group_id = ?")
    .bind(groupId)
    .first<{ rev: number }>();
  return row?.rev ?? null;
}

/** The Group's summary in D1: its directory rev and every Personal spending row. */
async function summary(groupId: string): Promise<string> {
  const spending = await env.DB.prepare(
    "SELECT expense_id, user_id, rev FROM personal_spending WHERE group_id = ? ORDER BY expense_id, user_id",
  )
    .bind(groupId)
    .all();
  return JSON.stringify([await summaryRev(groupId), spending.results]);
}

/** 26 zero-balance Expenses involving `memberId`: re-projecting them takes two push batches. */
async function history(admin: Session, groupId: string, memberId: string): Promise<void> {
  for (let i = 0; i < 26; i += 1)
    await createExpense(admin, groupId, twdExpense(memberId, [memberId], 100));
}

async function ok(response: Promise<Response>): Promise<void> {
  const res = await response;
  if (!res.ok) throw new Error(`${String(res.status)} ${await res.text()}`);
}

/** Account deletion has no route of its own per step; the account flow calls the ledger. */
async function accountDeletion(
  groupId: string,
  action: "freeze" | "finalize" | "restore" | "commit" | "unfreeze",
  userId: string,
): Promise<void> {
  await ok(
    ledger(groupId).fetch("https://ledger.internal/account-deletion", {
      method: "POST",
      body: JSON.stringify({ action, userId, now: clock.now, expires }),
    }),
  );
}

function within<T>(promise: Promise<T>, failure: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => {
        reject(new Error(failure));
      }, 2000);
    }),
  ]);
}

const signalSchema = z.object({
  version: z.literal(1),
  type: z.literal("sync needed"),
  rev: z.number(),
});

/** An open live screen that records every signal and what D1 held when it arrived. */
async function openScreen(session: Session, groupId: string) {
  const response = await call(`/groups/${groupId}/live`, {
    headers: { Upgrade: "websocket", Authorization: `Bearer ${session.accessToken}` },
  });
  const socket = response.webSocket;
  if (socket === null) throw new Error(`live: ${String(response.status)}`);
  socket.accept();
  const signals: { rev: number; summary: Promise<string> }[] = [];
  let signalled = (): void => undefined;
  const firstSignal = new Promise<void>((resolve) => (signalled = resolve));
  let ponged = (): void => undefined;
  socket.addEventListener("message", (event) => {
    const data = String(event.data);
    if (data === "pong") {
      ponged();
      return;
    }
    signals.push({
      rev: signalSchema.parse(JSON.parse(data)).rev,
      summary: summary(groupId),
    });
    signalled();
  });
  const closed = new Promise<number>((resolve) => {
    socket.addEventListener(
      "close",
      (event) => {
        resolve(event.code);
      },
      { once: true },
    );
  });
  return {
    signals,
    firstSignal,
    closed,
    /** Resolves once everything the ledger sent before this ping has arrived. */
    async ping(): Promise<void> {
      const pong = new Promise<void>((resolve) => (ponged = resolve));
      socket.send("ping");
      await within(pong, "screen did not answer");
    },
    close(): void {
      try {
        socket.close();
      } catch {
        /* already closed */
      }
    },
  };
}

/** An admin alone in a fresh Group. */
async function solo(label: string, input: Record<string, unknown> = {}) {
  const admin = await person(`${label} admin`);
  const group = await createGroup(admin, input);
  return { admin, group };
}

/** An admin and one plain Member. */
async function pair(label: string) {
  const { admin, group, token, others } = await groupWith(`${label} admin`, `${label} member`);
  const member = at(others, 0);
  const row = (await listMembers(admin, group.id)).find((m) => m.userId === member.userId);
  if (row === undefined) throw new Error("missing Member row");
  return { admin, group, token, member, memberId: row.id };
}

const rows: Row[] = [
  {
    write: "Stop",
    rev: "bumped",
    pushed: true,
    signal: "unordered",
    closes: "none",
    scene: async () => {
      const { admin, group } = await solo("stop", {
        isTrip: true,
        tripStartDate: "2026-07-01",
        tripEndDate: "2026-07-03",
      });
      return {
        groupId: group.id,
        observer: admin,
        write: async () => {
          await ok(
            send(admin, "POST", `/groups/${group.id}/stops`, {
              dayDate: "2026-07-01",
              title: "赤崁樓",
              category: "景點",
            }),
          );
          return group.id;
        },
      };
    },
  },
  {
    write: "Settlement",
    rev: "bumped",
    pushed: true,
    signal: "unordered",
    closes: "none",
    scene: async () => {
      const { admin, group, member, memberId } = await pair("settlement");
      await createExpense(
        admin,
        group.id,
        twdExpense(group.me.memberId, [group.me.memberId, memberId]),
      );
      return {
        groupId: group.id,
        observer: admin,
        write: async () => {
          await ok(
            send(
              member,
              "POST",
              `/groups/${group.id}/settlements`,
              { payerMemberId: memberId, receiverMemberId: group.me.memberId, amount: 100 },
              { "Idempotency-Key": newKey() },
            ),
          );
          return group.id;
        },
      };
    },
  },
  {
    write: "Expense",
    rev: "bumped",
    pushed: true,
    signal: "unordered",
    closes: "none",
    scene: async () => {
      const { admin, group } = await solo("expense");
      return {
        groupId: group.id,
        observer: admin,
        write: async () => {
          await createExpense(admin, group.id, twdExpense(group.me.memberId, [group.me.memberId]));
          return group.id;
        },
      };
    },
  },
  {
    write: "Member add",
    rev: "bumped",
    pushed: true,
    signal: "after push",
    closes: "none",
    scene: async () => {
      const { admin, group } = await solo("add");
      return {
        groupId: group.id,
        observer: admin,
        write: async () => {
          await ok(send(admin, "POST", `/groups/${group.id}/members`, { name: "小明" }));
          return group.id;
        },
      };
    },
  },
  {
    write: "Member join",
    rev: "bumped",
    pushed: true,
    signal: "after push",
    closes: "none",
    scene: async () => {
      const { admin, group } = await solo("join");
      const token = await inviteToken(admin, group.id);
      const joiner = await person("join joiner");
      return {
        groupId: group.id,
        observer: admin,
        write: async () => {
          await ok(send(joiner, "POST", `/invites/${token}/join`));
          return group.id;
        },
      };
    },
  },
  {
    write: "Member claim",
    rev: "bumped",
    pushed: true,
    signal: "after push",
    closes: "none",
    scene: async () => {
      const { admin, group } = await solo("claim");
      const added = await send(admin, "POST", `/groups/${group.id}/members`, { name: "小明" });
      const placeholder = await added.json<{ id: string }>();
      await history(admin, group.id, placeholder.id);
      const token = await inviteToken(admin, group.id);
      const claimant = await person("claim claimant");
      return {
        groupId: group.id,
        observer: admin,
        write: async () => {
          await ok(send(claimant, "POST", `/invites/${token}/claim`, { memberId: placeholder.id }));
          return group.id;
        },
      };
    },
  },
  {
    write: "Member patch",
    rev: "bumped",
    pushed: true,
    signal: "after push",
    closes: "none",
    scene: async () => {
      const { admin, group, memberId } = await pair("patch");
      return {
        groupId: group.id,
        observer: admin,
        write: async () => {
          await ok(
            send(admin, "PATCH", `/groups/${group.id}/members/${memberId}`, { role: "admin" }),
          );
          return group.id;
        },
      };
    },
  },
  {
    write: "Member leave",
    rev: "bumped",
    pushed: true,
    signal: "after push",
    closes: "target",
    scene: async () => {
      const { admin, group, member, memberId } = await pair("leave");
      await history(admin, group.id, memberId);
      return {
        groupId: group.id,
        observer: admin,
        target: member,
        write: async () => {
          await ok(send(member, "POST", `/groups/${group.id}/leave`));
          return group.id;
        },
      };
    },
  },
  {
    write: "Member remove",
    rev: "bumped",
    pushed: true,
    signal: "after push",
    closes: "target",
    scene: async () => {
      const { admin, group, member, memberId } = await pair("remove");
      await history(admin, group.id, memberId);
      return {
        groupId: group.id,
        observer: admin,
        target: member,
        write: async () => {
          await ok(send(admin, "DELETE", `/groups/${group.id}/members/${memberId}`));
          return group.id;
        },
      };
    },
  },
  {
    write: "Invite",
    rev: "bumped",
    pushed: true,
    signal: "unordered",
    closes: "none",
    scene: async () => {
      const { admin, group } = await solo("invite");
      return {
        groupId: group.id,
        observer: admin,
        write: async () => {
          await ok(send(admin, "POST", `/groups/${group.id}/invite`));
          return group.id;
        },
      };
    },
  },
  {
    write: "Group patch",
    rev: "bumped",
    pushed: true,
    signal: "unordered",
    closes: "none",
    scene: async () => {
      const { admin, group } = await solo("group patch");
      return {
        groupId: group.id,
        observer: admin,
        write: async () => {
          await ok(
            send(
              admin,
              "PATCH",
              `/groups/${group.id}`,
              { name: "新的名稱" },
              { "If-Match": String(group.updatedAt) },
            ),
          );
          return group.id;
        },
      };
    },
  },
  {
    write: "Group delete",
    rev: "bumped",
    pushed: true,
    signal: "unordered",
    closes: "all",
    scene: async () => {
      const { admin, group } = await solo("delete");
      return {
        groupId: group.id,
        observer: admin,
        write: async () => {
          await ok(send(admin, "DELETE", `/groups/${group.id}`));
          return group.id;
        },
      };
    },
  },
  {
    // No screen can be open on a Group that does not exist yet.
    write: "Group create",
    rev: "starts at 0",
    pushed: true,
    signal: "none",
    closes: "none",
    scene: async () => {
      const admin = await person("create admin");
      return { write: async () => (await createGroup(admin)).id };
    },
  },
  {
    write: "Account freeze",
    rev: "unchanged",
    pushed: false,
    signal: "none",
    closes: "none",
    scene: async () => {
      const { admin, group, member } = await pair("freeze");
      return {
        groupId: group.id,
        observer: admin,
        write: async () => {
          await accountDeletion(group.id, "freeze", member.userId);
          return group.id;
        },
      };
    },
  },
  {
    write: "Account finalize",
    rev: "bumped",
    pushed: true,
    signal: "unordered",
    closes: "target",
    scene: async () => {
      const { admin, group, member } = await pair("finalize");
      await accountDeletion(group.id, "freeze", member.userId);
      return {
        groupId: group.id,
        observer: admin,
        target: member,
        write: async () => {
          await accountDeletion(group.id, "finalize", member.userId);
          return group.id;
        },
      };
    },
  },
  {
    write: "Account restore",
    rev: "bumped",
    pushed: true,
    signal: "after push",
    closes: "none",
    scene: async () => {
      const { admin, group, member } = await pair("restore");
      await accountDeletion(group.id, "freeze", member.userId);
      await accountDeletion(group.id, "finalize", member.userId);
      return {
        groupId: group.id,
        observer: admin,
        write: async () => {
          await accountDeletion(group.id, "restore", member.userId);
          return group.id;
        },
      };
    },
  },
  {
    write: "Account commit",
    rev: "unchanged",
    pushed: false,
    signal: "none",
    closes: "none",
    scene: async () => {
      const { admin, group, member } = await pair("commit");
      await accountDeletion(group.id, "freeze", member.userId);
      await accountDeletion(group.id, "finalize", member.userId);
      return {
        groupId: group.id,
        observer: admin,
        write: async () => {
          await accountDeletion(group.id, "commit", member.userId);
          return group.id;
        },
      };
    },
  },
  {
    write: "Account unfreeze",
    rev: "unchanged",
    pushed: false,
    signal: "none",
    closes: "none",
    scene: async () => {
      const { admin, group, member } = await pair("unfreeze");
      await accountDeletion(group.id, "freeze", member.userId);
      return {
        groupId: group.id,
        observer: admin,
        write: async () => {
          await accountDeletion(group.id, "unfreeze", member.userId);
          return group.id;
        },
      };
    },
  },
];

it.each(rows)(
  "after a $write: rev $rev, pushed $pushed, signal $signal, closes $closes",
  async (row) => {
    const scene = await row.scene();
    const { groupId: knownId } = scene;
    const before = knownId === undefined ? undefined : await ledgerRev(knownId);
    const summaryBefore = knownId === undefined ? null : await summaryRev(knownId);
    const observer =
      knownId !== undefined && scene.observer
        ? await openScreen(scene.observer, knownId)
        : undefined;
    const target =
      knownId !== undefined && scene.target ? await openScreen(scene.target, knownId) : undefined;
    try {
      const groupId = await scene.write();
      const rev = await ledgerRev(groupId);
      expect(rev).toBe(
        row.rev === "starts at 0" ? 0 : row.rev === "bumped" ? (before ?? NaN) + 1 : before,
      );

      if (row.signal !== "none") {
        if (observer === undefined) throw new Error("a signal needs an open screen");
        await within(observer.firstSignal, "no signal");
      }
      if (observer !== undefined) {
        if (row.closes === "all")
          expect(await within(observer.closed, "screen stayed open")).toBe(4003);
        else await observer.ping();
        expect(observer.signals.map((signal) => signal.rev)).toEqual(
          row.signal === "none" ? [] : [rev],
        );
        if (row.signal === "after push")
          expect(await observer.signals[0]?.summary).toBe(await summary(groupId));
      }
      if (row.closes === "target") {
        if (target === undefined) throw new Error("closing a target needs its open screen");
        expect(await within(target.closed, "target's screen stayed open")).toBe(4003);
      }

      expect(await summaryRev(groupId)).toBe(row.pushed ? rev : summaryBefore);
    } finally {
      observer?.close();
      target?.close();
    }
  },
);
