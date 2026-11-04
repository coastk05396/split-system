import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import { failDirectoryWrites } from "./d1-faults.js";
import { createExpense, twdExpense } from "./expenses-harness.js";
import { groupWith, person, send } from "./groups-harness.js";

async function dirtyExpenses(groupId: string) {
  const stub = env.GROUP_LEDGER.get(env.GROUP_LEDGER.idFromName(groupId));
  return runInDurableObject(stub, (_instance, state) =>
    state.storage.sql
      .exec<{ kind: string }>(
        "SELECT kind FROM ledger_dirty WHERE kind LIKE 'expense:%' ORDER BY kind",
      )
      .toArray()
      .map((row) => row.kind),
  );
}

it("a brand-new join leaves existing expenses clean", async () => {
  const { admin, group, token } = await groupWith("Join projection owner");
  await createExpense(admin, group.id, twdExpense(group.me.memberId, [group.me.memberId], 100));
  const newcomer = await person("New member");
  const restore = await failDirectoryWrites();
  try {
    expect((await send(newcomer, "POST", `/invites/${token}/join`)).status).toBe(200);
    expect(await dirtyExpenses(group.id)).toEqual([]);
  } finally {
    await restore();
  }
});

it.each(["claim", "leave", "remove", "revive"] as const)(
  "%s dirties only expenses involving the affected member",
  async (action) => {
    const { admin, group, token, others } = await groupWith("Projection owner", "Existing member");
    const member = others[0];
    if (!member) throw new Error("missing member");
    const members = await (
      await send(admin, "GET", `/groups/${group.id}/members`)
    ).json<{ id: string; isMe: boolean }[]>();
    let targetId = members.find((m) => !m.isMe)?.id;
    if (action === "claim") {
      const added = await send(admin, "POST", `/groups/${group.id}/members`, {
        name: "Future claimant",
      });
      targetId = (await added.json<{ id: string }>()).id;
    }
    if (!targetId) throw new Error("missing target");
    const affected = await createExpense(admin, group.id, twdExpense(targetId, [targetId], 100));
    await createExpense(admin, group.id, twdExpense(group.me.memberId, [group.me.memberId], 100));
    if (action === "revive")
      expect((await send(member, "POST", `/groups/${group.id}/leave`)).status).toBe(204);
    const claimant = action === "claim" ? await person("Claimant") : member;
    const restore = await failDirectoryWrites();
    try {
      const response =
        action === "claim"
          ? await send(claimant, "POST", `/invites/${token}/claim`, { memberId: targetId })
          : action === "revive"
            ? await send(member, "POST", `/invites/${token}/join`)
            : action === "leave"
              ? await send(member, "POST", `/groups/${group.id}/leave`)
              : await send(admin, "DELETE", `/groups/${group.id}/members/${targetId}`);
      expect(response.status).toBe(action === "claim" || action === "revive" ? 200 : 204);
      expect(await dirtyExpenses(group.id)).toEqual([`expense:${affected.id}`]);
    } finally {
      await restore();
    }
  },
);
