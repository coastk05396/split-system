import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { reserveGroup, withReservation } from "../src/auth/reservations.js";
import { ApiError } from "../src/errors.js";

async function user(id: string): Promise<void> {
  await env.DB.prepare("INSERT INTO users (id,display_name,created_at,updated_at) VALUES (?,?,?,?)")
    .bind(id, id, 1, 1)
    .run();
}

async function reservations(userId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT count(*) AS n FROM group_reservations WHERE user_id=?")
    .bind(userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

describe("withReservation", () => {
  it("releases a reservation it created when the ledger refuses the attempt", async () => {
    await user("u-fail");
    await expect(
      withReservation(env.DB, "u-fail", "g-1", 10, () =>
        Promise.reject(new ApiError("GROUP_FULL")),
      ),
    ).rejects.toThrow("GROUP_FULL");
    expect(await reservations("u-fail")).toBe(0);
  });

  it("keeps the reservation after a network failure that may have committed", async () => {
    await user("u-net");
    await expect(
      withReservation(env.DB, "u-net", "g-1", 10, () => Promise.reject(new Error("network lost"))),
    ).rejects.toThrow("network lost");
    expect(await reservations("u-net")).toBe(1);
  });

  it("keeps the reservation after a 5xx when the ledger seated the User", async () => {
    await user("u-5xx");
    await expect(
      withReservation(
        env.DB,
        "u-5xx",
        "g-1",
        10,
        () => Promise.reject(new ApiError("INTERNAL")),
        () => Promise.resolve(true),
      ),
    ).rejects.toThrow("INTERNAL");
    expect(await reservations("u-5xx")).toBe(1);
  });

  it("releases after a 5xx once the ledger confirms the User is not seated", async () => {
    await user("u-unseated");
    await expect(
      withReservation(
        env.DB,
        "u-unseated",
        "g-1",
        10,
        () => Promise.reject(new ApiError("INTERNAL")),
        () => Promise.resolve(false),
      ),
    ).rejects.toThrow("INTERNAL");
    expect(await reservations("u-unseated")).toBe(0);
  });

  it("keeps the reservation when the ledger cannot say whether the User is seated", async () => {
    await user("u-unknown");
    await expect(
      withReservation(
        env.DB,
        "u-unknown",
        "g-1",
        10,
        () => Promise.reject(new Error("timeout")),
        () => Promise.reject(new Error("ledger unreachable")),
      ),
    ).rejects.toThrow("timeout");
    expect(await reservations("u-unknown")).toBe(1);
  });

  it("does not remove a reservation a concurrent join re-stamped", async () => {
    await user("u-race");
    let finishSecond: () => void = () => undefined;
    const first = withReservation(env.DB, "u-race", "g-1", 10, async () => {
      // The concurrent join reserves the same seat while the first attempt is in flight.
      const second = withReservation(
        env.DB,
        "u-race",
        "g-1",
        11,
        () => new Promise<void>((resolve) => (finishSecond = resolve)),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      finishSecond();
      await second;
      throw new ApiError("INVITE_EXPIRED");
    });
    await expect(first).rejects.toThrow("INVITE_EXPIRED");
    expect(await reservations("u-race")).toBe(1);
  });

  it("keeps a reservation that existed before the failed attempt", async () => {
    await user("u-kept");
    await reserveGroup(env.DB, "u-kept", "g-1", 10);
    await expect(
      withReservation(env.DB, "u-kept", "g-1", 11, () =>
        Promise.reject(new ApiError("GROUP_FULL")),
      ),
    ).rejects.toThrow("GROUP_FULL");
    expect(await reservations("u-kept")).toBe(1);
  });

  it("keeps the reservation when the attempt succeeds", async () => {
    await user("u-ok");
    await withReservation(env.DB, "u-ok", "g-1", 10, () => Promise.resolve());
    expect(await reservations("u-ok")).toBe(1);
  });
});
