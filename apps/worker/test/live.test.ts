import { describe, expect, it } from "vitest";
import { z } from "zod";
import { call } from "./auth-harness.js";
import { createGroup, person } from "./groups-harness.js";

it("closes a removed Member's live connection", async () => {
  const { groupWith, listMembers, send } = await import("./groups-harness.js");
  const { admin, group, others } = await groupWith("admin", "member");
  const member = others[0];
  if (member === undefined) throw new Error("missing Member");
  const row = (await listMembers(admin, group.id)).find((item) => item.userId === member.userId);
  if (row === undefined) throw new Error("missing Member row");
  const response = await call(`/groups/${group.id}/live`, {
    headers: { Upgrade: "websocket", Authorization: `Bearer ${member.accessToken}` },
  });
  const socket = response.webSocket;
  if (socket === null) throw new Error("missing socket");
  socket.accept();
  const closed = new Promise<number>((resolve) => {
    socket.addEventListener(
      "close",
      (event) => {
        resolve(event.code);
      },
      { once: true },
    );
  });
  expect((await send(admin, "DELETE", `/groups/${group.id}/members/${row.id}`)).status).toBe(204);
  expect(
    await Promise.race([
      closed,
      new Promise<number>((_, reject) => {
        setTimeout(() => {
          reject(new Error("socket remained open"));
        }, 1000);
      }),
    ]),
  ).toBe(4003);
});

describe("Group live connection", () => {
  it("requires authentication before connecting", async () => {
    const admin = await person("live-admin");
    const group = await createGroup(admin);
    const response = await call(`/groups/${group.id}/live`, { headers: { Upgrade: "websocket" } });
    expect(response.status).toBe(401);
  });
});

it("connects members using a bearer token or web subprotocol and refuses outsiders", async () => {
  const admin = await person("socket-admin");
  const stranger = await person("socket-stranger");
  const group = await createGroup(admin);
  const url = `/groups/${group.id}/live`;
  const native = await call(url, {
    headers: { Upgrade: "websocket", Authorization: `Bearer ${admin.accessToken}` },
  });
  expect(native.status).toBe(101);
  expect(native.headers.get("Sec-WebSocket-Protocol")).toBeNull();
  const socket = native.webSocket;
  expect(socket).not.toBeNull();
  if (socket === null) throw new Error("missing socket");
  socket.accept();
  const pong = new Promise<string>((resolve) => {
    socket.addEventListener(
      "message",
      (event) => {
        resolve(String(event.data));
      },
      { once: true },
    );
  });
  socket.send("ping");
  expect(await pong).toBe("pong");
  socket.close();
  const web = await call(url, {
    headers: { Upgrade: "websocket", "Sec-WebSocket-Protocol": `split.v1, ${admin.accessToken}` },
  });
  expect(web.status).toBe(101);
  expect(web.headers.get("Sec-WebSocket-Protocol")).toBe("split.v1");
  web.webSocket?.accept();
  web.webSocket?.close();
  const denied = await call(url, {
    headers: { Upgrade: "websocket", Authorization: `Bearer ${stranger.accessToken}` },
  });
  expect(denied.status).toBe(404);
  const plain = await call(url, { headers: { Authorization: `Bearer ${admin.accessToken}` } });
  expect(plain.status).toBe(426);
  const forged = await call(url, {
    headers: { Upgrade: "websocket", Authorization: "Bearer forged" },
  });
  expect(forged.status).toBe(401);
});

it("signals both connected Members after an Expense commits", async () => {
  const { groupWith, listMembers } = await import("./groups-harness.js");
  const { postExpense, twdExpense } = await import("./expenses-harness.js");
  const { admin, group, others } = await groupWith("socket-writer", "socket-reader");
  const other = others[0];
  const [a, b] = (await listMembers(admin, group.id)).map((member) => member.id);
  if (!other || !a || !b) throw new Error("missing member");
  const sockets = await Promise.all(
    [admin, other].map(async (person) => {
      const response = await call(`/groups/${group.id}/live`, {
        headers: { Upgrade: "websocket", Authorization: `Bearer ${person.accessToken}` },
      });
      if (!response.webSocket) throw new Error("missing socket");
      response.webSocket.accept();
      return response.webSocket;
    }),
  );
  const received = sockets.map(
    (socket) =>
      new Promise<unknown>((resolve) => {
        socket.addEventListener(
          "message",
          (event) => {
            resolve(JSON.parse(String(event.data)));
          },
          {
            once: true,
          },
        );
      }),
  );
  expect((await postExpense(admin, group.id, twdExpense(a, [a, b], 600))).status).toBe(201);
  const messages = await Promise.all(received);
  for (const message of messages) {
    const parsed = z
      .object({
        version: z.literal(1),
        type: z.literal("sync needed"),
        rev: z.number(),
        timestamp: z.number(),
      })
      .parse(message);
    expect(parsed.rev).toBeGreaterThan(0);
  }
  for (const socket of sockets) socket.close();
});

it("sends no signal for a refused Expense or an idempotent retry", async () => {
  const { groupWith, listMembers } = await import("./groups-harness.js");
  const { newKey, postExpense, twdExpense } = await import("./expenses-harness.js");
  const { admin, group } = await groupWith("socket-retry", "socket-member");
  const [a, b] = (await listMembers(admin, group.id)).map((member) => member.id);
  if (!a || !b) throw new Error("missing member");
  const response = await call(`/groups/${group.id}/live`, {
    headers: { Upgrade: "websocket", Authorization: `Bearer ${admin.accessToken}` },
  });
  const socket = response.webSocket;
  if (!socket) throw new Error("missing socket");
  socket.accept();
  const revisions: number[] = [];
  socket.addEventListener("message", (event) => {
    const message = z.object({ rev: z.number() }).parse(JSON.parse(String(event.data)));
    revisions.push(message.rev);
  });
  const key = newKey();
  const first = await postExpense(admin, group.id, twdExpense(a, [a, b], 600), key);
  expect(first.status).toBe(201);
  expect((await postExpense(admin, group.id, twdExpense(a, [a, b], 600), key)).status).toBe(201);
  expect(
    (await postExpense(admin, group.id, twdExpense(a, [a, crypto.randomUUID()], 600))).status,
  ).toBe(400);
  const nextMessage = new Promise<void>((resolve) => {
    socket.addEventListener("message", () => {
      if (revisions.length >= 2) resolve();
    });
  });
  expect((await postExpense(admin, group.id, twdExpense(a, [a, b], 200))).status).toBe(201);
  await nextMessage;
  expect(revisions).toHaveLength(2);
  expect(revisions[1]).toBe((revisions[0] ?? 0) + 1);
  socket.close();
});
