import { describe, expect, it, vi } from "vitest";
import { createExpense, twdExpense } from "./expenses-harness.js";
import { clock, type Session } from "./auth-harness.js";
import { at, createGroup, errorCode, groupWith, person, send } from "./groups-harness.js";

interface StopBody {
  id: string;
  dayDate: string;
  startTime: string | null;
  endTime: string | null;
  title: string;
  category: string;
  locationName: string | null;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
}

async function tripFor(name: string) {
  const admin = await person(name);
  const group = await createGroup(admin, {
    isTrip: true,
    tripDestination: "台南",
    tripStartDate: "2026-07-01",
    tripEndDate: "2026-07-03",
  });
  return { admin, group };
}

async function addStop(
  session: Session,
  groupId: string,
  input: Record<string, unknown>,
): Promise<StopBody> {
  const res = await send(session, "POST", `/groups/${groupId}/stops`, {
    dayDate: "2026-07-01",
    category: "景點",
    ...input,
  });
  if (res.status !== 201) throw new Error(`add stop: ${res.status} ${await res.text()}`);
  return res.json<StopBody>();
}

async function stopTitles(session: Session, groupId: string, query = ""): Promise<string[]> {
  const res = await send(session, "GET", `/groups/${groupId}/stops${query}`);
  if (res.status !== 200) throw new Error(`list stops: ${res.status} ${await res.text()}`);
  return (await res.json<StopBody[]>()).map((s) => s.title);
}

describe("POST and GET /groups/:id/stops", () => {
  it("adds a Stop and returns it with empty optional fields as null", async () => {
    const { admin, group } = await tripFor("小宇");
    const stop = await addStop(admin, group.id, { title: "赤崁樓", startTime: "10:00" });
    expect(stop).toMatchObject({
      dayDate: "2026-07-01",
      startTime: "10:00",
      endTime: null,
      title: "赤崁樓",
      category: "景點",
      locationName: null,
      notes: null,
    });
  });

  it("lists Stops by day, then start time, with untimed Stops last in the order added", async () => {
    const { admin, group } = await tripFor("小宇");
    await addStop(admin, group.id, {
      title: "第二天早餐",
      dayDate: "2026-07-02",
      startTime: "08:00",
    });
    await addStop(admin, group.id, { title: "夜市" });
    await addStop(admin, group.id, { title: "午餐", startTime: "12:00" });
    await addStop(admin, group.id, { title: "伴手禮" });
    await addStop(admin, group.id, { title: "早餐", startTime: "08:30" });

    expect(await stopTitles(admin, group.id)).toEqual([
      "早餐",
      "午餐",
      "夜市",
      "伴手禮",
      "第二天早餐",
    ]);
    expect(await stopTitles(admin, group.id, "?day=2026-07-02")).toEqual(["第二天早餐"]);
  });

  it("rejects a Stop on a Running Tab", async () => {
    const yu = await person("小宇");
    const tab = await createGroup(yu);
    const res = await send(yu, "POST", `/groups/${tab.id}/stops`, {
      dayDate: "2026-07-01",
      title: "赤崁樓",
      category: "景點",
    });
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("TRIP_MODULE_OFF");
  });

  it("rejects a Stop dated outside the Trip", async () => {
    const { admin, group } = await tripFor("小宇");
    const res = await send(admin, "POST", `/groups/${group.id}/stops`, {
      dayDate: "2026-07-04",
      title: "赤崁樓",
      category: "景點",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { details: { issues: [{ message: "STOP_DAY_OUTSIDE_TRIP" }] } },
    });
  });

  it("holds at most 50 Stops on one day", async () => {
    const { admin, group } = await tripFor("小宇");
    for (let i = 0; i < 50; i += 1) await addStop(admin, group.id, { title: `站 ${String(i)}` });
    const res = await send(admin, "POST", `/groups/${group.id}/stops`, {
      dayDate: "2026-07-01",
      title: "第 51 站",
      category: "景點",
    });
    expect(await errorCode(res)).toBe("STOP_LIMIT_REACHED");
    await addStop(admin, group.id, { title: "隔天", dayDate: "2026-07-02" });
  }, 15_000);

  it("lets any Member add Stops but hides them from non-Members", async () => {
    const { admin, group, others } = await groupWith("小宇", "阿明");
    await send(
      admin,
      "PATCH",
      `/groups/${group.id}`,
      { isTrip: true },
      {
        "If-Match": String(group.updatedAt),
      },
    );
    await addStop(at(others, 0), group.id, { title: "安平老街" });

    const stranger = await person("路人");
    const res = await send(stranger, "GET", `/groups/${group.id}/stops`);
    expect(res.status).toBe(404);
  });
});

describe("PATCH /groups/:id/stops/:sid", () => {
  it("edits a Stop, clearing a field with null, under If-Match", async () => {
    const { admin, group } = await tripFor("小宇");
    const stop = await addStop(admin, group.id, {
      title: "赤崁樓",
      startTime: "10:00",
      locationName: "台南市中西區",
    });
    clock.now += 1000;
    const res = await send(
      admin,
      "PATCH",
      `/groups/${group.id}/stops/${stop.id}`,
      { title: "赤崁樓與祀典武廟", locationName: null, endTime: "11:30" },
      { "If-Match": String(stop.updatedAt) },
    );
    expect(res.status).toBe(200);
    const edited = await res.json<StopBody>();
    expect(edited).toMatchObject({
      title: "赤崁樓與祀典武廟",
      startTime: "10:00",
      endTime: "11:30",
      locationName: null,
    });
    expect(edited.updatedAt).toBeGreaterThan(stop.updatedAt);

    const stale = await send(
      admin,
      "PATCH",
      `/groups/${group.id}/stops/${stop.id}`,
      { title: "舊版" },
      { "If-Match": String(stop.updatedAt) },
    );
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      error: { code: "EDIT_CONFLICT", details: { current: { title: "赤崁樓與祀典武廟" } } },
    });
  });

  it("rejects an end time before the stored start time", async () => {
    const { admin, group } = await tripFor("小宇");
    const stop = await addStop(admin, group.id, { title: "赤崁樓", startTime: "10:00" });
    const res = await send(
      admin,
      "PATCH",
      `/groups/${group.id}/stops/${stop.id}`,
      { endTime: "09:00" },
      { "If-Match": String(stop.updatedAt) },
    );
    expect(res.status).toBe(400);
  });

  it("rejects edits once the trip module is off", async () => {
    const { admin, group } = await tripFor("小宇");
    const stop = await addStop(admin, group.id, { title: "赤崁樓" });
    await send(
      admin,
      "PATCH",
      `/groups/${group.id}`,
      { isTrip: false },
      {
        "If-Match": String(group.updatedAt),
      },
    );
    const res = await send(
      admin,
      "PATCH",
      `/groups/${group.id}/stops/${stop.id}`,
      { title: "新名字" },
      { "If-Match": String(stop.updatedAt) },
    );
    expect(await errorCode(res)).toBe("TRIP_MODULE_OFF");
    expect(await stopTitles(admin, group.id)).toEqual(["赤崁樓"]);
  });
});

describe("DELETE /groups/:id/stops/:sid", () => {
  it("deletes a Stop and keeps its Expenses, only unlinking them", async () => {
    const { admin, group } = await tripFor("小宇");
    const stop = await addStop(admin, group.id, { title: "夜市" });
    const expense = await createExpense(
      admin,
      group.id,
      twdExpense(group.me.memberId, [group.me.memberId], 600, { stopId: stop.id }),
    );

    const res = await send(admin, "DELETE", `/groups/${group.id}/stops/${stop.id}`);
    expect(res.status).toBe(204);
    expect(await stopTitles(admin, group.id)).toEqual([]);
    const saved = await (
      await send(admin, "GET", `/groups/${group.id}/expenses/${expense.id}`)
    ).json<{ stopId: string | null }>();
    expect(saved.stopId).toBeNull();

    const again = await send(admin, "DELETE", `/groups/${group.id}/stops/${stop.id}`);
    expect(again.status).toBe(404);
  });

  it("does not reach a Stop of another Group", async () => {
    const trip = await tripFor("小宇");
    const stop = await addStop(trip.admin, trip.group.id, { title: "夜市" });
    const other = await tripFor("阿明");
    const res = await send(other.admin, "DELETE", `/groups/${other.group.id}/stops/${stop.id}`);
    expect(res.status).toBe(404);
  });
});

it("sends a live signal after a Stop is recorded", async () => {
  const { call } = await import("./auth-harness.js");
  const { admin, group } = await tripFor("live-stop");
  const response = await call(`/groups/${group.id}/live`, {
    headers: { Upgrade: "websocket", Authorization: `Bearer ${admin.accessToken}` },
  });
  const socket = response.webSocket;
  if (socket === null) throw new Error("missing socket");
  socket.accept();
  const signal = new Promise<string>((resolve) => {
    socket.addEventListener(
      "message",
      (event) => {
        resolve(String(event.data));
      },
      { once: true },
    );
  });
  await addStop(admin, group.id, { title: "海邊" });
  const received = await Promise.race([
    signal,
    new Promise<string>((_, reject) => {
      setTimeout(() => {
        reject(new Error("missing signal"));
      }, 1000);
    }),
  ]);
  expect(JSON.parse(received) as unknown).toMatchObject({
    version: 1,
    type: "sync needed",
    rev: 1,
  });
  socket.close();
});

it("signals Stop edits and deletion, but not a refused write", async () => {
  const { call } = await import("./auth-harness.js");
  const { admin, group } = await tripFor("live-stop-changes");
  const stop = await addStop(admin, group.id, { title: "初名" });
  const response = await call(`/groups/${group.id}/live`, {
    headers: { Upgrade: "websocket", Authorization: `Bearer ${admin.accessToken}` },
  });
  const socket = response.webSocket;
  if (socket === null) throw new Error("missing socket");
  socket.accept();
  const received: { rev: number }[] = [];
  socket.addEventListener("message", (event) => {
    received.push(JSON.parse(String(event.data)) as { rev: number });
  });
  const edited = await send(
    admin,
    "PATCH",
    `/groups/${group.id}/stops/${stop.id}`,
    { title: "新名" },
    { "If-Match": String(stop.updatedAt) },
  );
  expect(edited.status).toBe(200);
  expect(edited.headers.get("X-Group-Rev")).toBe("2");
  const refused = await send(
    admin,
    "PATCH",
    `/groups/${group.id}/stops/${stop.id}`,
    { title: "過期" },
    { "If-Match": String(stop.updatedAt) },
  );
  expect(refused.status).toBe(409);
  const removed = await send(admin, "DELETE", `/groups/${group.id}/stops/${stop.id}`);
  expect(removed.status).toBe(204);
  expect(removed.headers.get("X-Group-Rev")).toBe("3");
  await vi.waitFor(() => {
    expect(received.map((message) => message.rev)).toEqual([2, 3]);
  });
  socket.close();
});
