import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/db/client.js";
import { members } from "../src/db/schema.js";
import { clock } from "./auth-harness.js";
import {
  at,
  createGroup,
  errorCode,
  groupWith,
  inviteToken,
  listMembers,
  person,
  send,
} from "./groups-harness.js";

const db = createDb(env.DB);
const SEVEN_DAYS = 7 * 24 * 3600 * 1000;

describe("POST /groups/:id/invite", () => {
  it("gives an Admin an unguessable link valid for 7 days", async () => {
    const yu = await person("小宇");
    const group = await createGroup(yu);
    const res = await send(yu, "POST", `/groups/${group.id}/invite`);
    expect(res.status).toBe(201);
    const invite = await res.json<{ token: string; expiresAt: number }>();
    expect(invite.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(invite.expiresAt).toBe(clock.now + SEVEN_DAYS);

    const current = await send(yu, "GET", `/groups/${group.id}/invite`);
    expect(await current.json()).toEqual(invite);
  });

  it("regenerating kills the old link at once", async () => {
    const yu = await person("小宇");
    const group = await createGroup(yu);
    const old = await inviteToken(yu, group.id);
    const fresh = await inviteToken(yu, group.id);
    expect(fresh).not.toBe(old);
    const ming = await person("阿明");
    expect((await send(ming, "GET", `/invites/${old}`)).status).toBe(404);
    expect((await send(ming, "POST", `/invites/${old}/join`)).status).toBe(404);
    expect((await send(ming, "GET", `/invites/${fresh}`)).status).toBe(200);
  });

  it("is Admin only; a plain Member can still read the live link", async () => {
    const { group, others, token } = await groupWith("小宇", "阿明");
    const ming = at(others, 0);
    expect((await send(ming, "POST", `/groups/${group.id}/invite`)).status).toBe(403);
    const current = await send(ming, "GET", `/groups/${group.id}/invite`);
    expect((await current.json<{ token: string }>()).token).toBe(token);
    const stranger = await person("路人");
    expect((await send(stranger, "POST", `/groups/${group.id}/invite`)).status).toBe(404);
    expect((await send(stranger, "GET", `/groups/${group.id}/invite`)).status).toBe(404);
  });

  it("answers 404 for the live link before one is made", async () => {
    const yu = await person("小宇");
    const group = await createGroup(yu);
    expect((await send(yu, "GET", `/groups/${group.id}/invite`)).status).toBe(404);
  });
});

describe("GET /invites/:token", () => {
  it("previews the Group name and Member count", async () => {
    const yu = await person("小宇");
    const group = await createGroup(yu, { name: "室友帳" });
    const token = await inviteToken(yu, group.id);
    const ming = await person("阿明");
    const res = await send(ming, "GET", `/invites/${token}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      groupId: group.id,
      groupName: "室友帳",
      settlementCurrency: "TWD",
      memberCount: 1,
      expiresAt: clock.now + SEVEN_DAYS,
      isMember: false,
      placeholders: [],
    });
    expect((await send(yu, "GET", `/invites/${token}`)).status).toBe(200);
  });

  it("answers 404 for an unknown token", async () => {
    const ming = await person("阿明");
    expect((await send(ming, "GET", "/invites/not-a-real-token")).status).toBe(404);
  });

  it("answers INVITE_EXPIRED once 7 days have passed", async () => {
    const yu = await person("小宇");
    const group = await createGroup(yu);
    const token = await inviteToken(yu, group.id);
    clock.now += SEVEN_DAYS + 1;
    const ming = await person("阿明");
    const preview = await send(ming, "GET", `/invites/${token}`);
    expect(preview.status).toBe(422);
    expect(await errorCode(preview)).toBe("INVITE_EXPIRED");
    const join = await send(ming, "POST", `/invites/${token}/join`);
    expect(join.status).toBe(422);
    expect(await errorCode(join)).toBe("INVITE_EXPIRED");
  });
});

describe("POST /invites/:token/join", () => {
  it("adds a signed-in person as a plain Member at once", async () => {
    const yu = await person("小宇");
    const group = await createGroup(yu);
    const token = await inviteToken(yu, group.id);
    const ming = await person("阿明");
    const res = await send(ming, "POST", `/invites/${token}/join`);
    expect(res.status).toBe(200);
    const joined = await res.json<{ groupId: string; memberId: string }>();
    expect(joined.groupId).toBe(group.id);

    const list = await listMembers(ming, group.id);
    expect(list.find((m) => m.id === joined.memberId)).toMatchObject({
      displayName: "阿明",
      role: "member",
      status: "active",
      isMe: true,
    });
  });

  it("just opens the Group for someone already in it", async () => {
    const { admin, group, token } = await groupWith("小宇");
    const res = await send(admin, "POST", `/invites/${token}/join`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ groupId: group.id, memberId: group.me.memberId });
    expect((await listMembers(admin, group.id)).length).toBe(1);
  });

  it("refuses with GROUP_FULL once 30 Members (Placeholders included) hold a seat", async () => {
    const yu = await person("小宇");
    const group = await createGroup(yu);
    const token = await inviteToken(yu, group.id);
    for (let i = 1; i < 30; i += 1) {
      await db.insert(members).values({
        id: crypto.randomUUID(),
        groupId: group.id,
        placeholderName: `朋友${String(i)}`,
        status: "placeholder",
        createdAt: clock.now,
      });
    }
    const ming = await person("阿明");
    const res = await send(ming, "POST", `/invites/${token}/join`);
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("GROUP_FULL");
    expect((await send(ming, "GET", `/invites/${token}`)).status).toBe(409);
  });

  it("lets a Former Member come back", async () => {
    const { group, others, token } = await groupWith("小宇", "阿明");
    const ming = at(others, 0);
    expect((await send(ming, "POST", `/groups/${group.id}/leave`)).status).toBe(204);
    expect((await send(ming, "GET", `/groups/${group.id}`)).status).toBe(404);
    const res = await send(ming, "POST", `/invites/${token}/join`);
    expect(res.status).toBe(200);
    expect((await send(ming, "GET", `/groups/${group.id}`)).status).toBe(200);
  });
});
