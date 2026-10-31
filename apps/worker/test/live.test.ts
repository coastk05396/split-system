import { describe, expect, it } from "vitest";
import { call } from "./auth-harness.js";
import { createGroup, person } from "./groups-harness.js";

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
