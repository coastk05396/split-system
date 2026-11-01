import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { reserveGroup, withReservation } from "../src/auth/reservations.js";

async function user(id: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO users (id,display_name,created_at,updated_at) VALUES (?,?,?,?)",
  )
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
  it("releases a reservation it created when the attempt fails", async () => {
    await user("u-fail");
    await expect(
      withReservation(env.DB, "u-fail", "g-1", 10, () => Promise.reject(new Error("refused"))),
    ).rejects.toThrow("refused");
    expect(await reservations("u-fail")).toBe(0);
  });

  it("keeps a reservation that existed before the failed attempt", async () => {
    await user("u-kept");
    await reserveGroup(env.DB, "u-kept", "g-1", 10);
    await expect(
      withReservation(env.DB, "u-kept", "g-1", 11, () => Promise.reject(new Error("refused"))),
    ).rejects.toThrow("refused");
    expect(await reservations("u-kept")).toBe(1);
  });

  it("keeps the reservation when the attempt succeeds", async () => {
    await user("u-ok");
    await withReservation(env.DB, "u-ok", "g-1", 10, () => Promise.resolve());
    expect(await reservations("u-ok")).toBe(1);
  });
});
