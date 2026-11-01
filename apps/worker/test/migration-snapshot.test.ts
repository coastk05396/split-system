import { describe, expect, it } from "vitest";
import { call } from "./auth-harness.js";
import { createGroup, person } from "./groups-harness.js";

describe("retained Group migration snapshot", () => {
  it("requires an active maintenance gate and uniquely matches the verified Group id", async () => {
    const admin = await person("migration-admin");
    const group = await createGroup(admin, { name: "明天去哪玩" });
    const path = `/maintenance/migration/snapshot/${group.id}`;
    expect((await call(path)).status).toBe(404);
    const bindings = { MAINTENANCE: "migration-gate" };
    expect((await call(path, {}, bindings)).status).toBe(404);
    const headers = { "X-Maintenance-Bypass": "migration-gate" };
    expect(
      (await call(`/maintenance/migration/snapshot/wrong-id`, { headers }, bindings)).status,
    ).toBe(409);
    const response = await call(path, { headers }, bindings);
    expect(response.status).toBe(200);
    const snapshot = await response.json<{
      group: { id: string; name: string };
      members: Array<{ user_id: string }>;
      fingerprint: string;
    }>();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(snapshot.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    const again = await call(path, { headers }, bindings);
    expect((await again.json<{ fingerprint: string }>()).fingerprint).toBe(snapshot.fingerprint);
    expect(snapshot.group).toMatchObject({ id: group.id, name: "明天去哪玩" });
    expect(snapshot.members).toEqual(
      expect.arrayContaining([expect.objectContaining({ user_id: admin.userId })]),
    );
    await createGroup(admin, { name: "明天去哪玩" });
    expect((await call(path, { headers }, bindings)).status).toBe(409);
  });
});
