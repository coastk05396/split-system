import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, it, vi } from "vitest";
import { groupLedger } from "../src/ledger-client.js";
import { clock } from "./auth-harness.js";
import { failDirectoryWrites } from "./d1-faults.js";
import { createGroup, person } from "./groups-harness.js";

it("a failed D1 projection logs once and schedules its retry", async () => {
  const admin = await person("Sync logging");
  const group = await createGroup(admin);
  const stub = env.GROUP_LEDGER.get(env.GROUP_LEDGER.idFromName(group.id));
  const restore = await failDirectoryWrites();
  const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    const before = Date.now();
    await groupLedger(env, group.id).member({
      action: "add",
      actorMemberId: group.me.memberId,
      targetMemberId: crypto.randomUUID(),
      input: { name: "Future member" },
      now: clock.now,
    });
    const pending = await runInDurableObject(stub, async (_instance, state) => ({
      alarm: await state.storage.getAlarm(),
      retries: state.storage.sql
        .exec<{ retry_count: number }>("SELECT retry_count FROM ledger_meta")
        .one().retry_count,
    }));
    expect(pending.retries).toBe(1);
    expect(pending.alarm).toBeGreaterThan(before);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining(group.id));
    expect(JSON.parse(String(logged.mock.calls[0]?.[0]))).toMatchObject({
      event: "ledger_sync_failed",
      groupId: group.id,
      retryCount: 1,
      error: expect.stringContaining("injected D1 outage") as unknown,
    });
  } finally {
    logged.mockRestore();
    await restore();
  }
});
