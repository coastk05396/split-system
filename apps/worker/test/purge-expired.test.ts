import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/db/client.js";
import { purgeExpired } from "../src/maintenance.js";
import { signIn, uniqueSub } from "./auth-harness.js";

const NOW = 1_750_000_000_000;
const HOUR = 3_600_000;

async function count(table: "sessions" | "rate_counters", userId: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT count(*) AS n FROM ${table} WHERE user_id=?`)
    .bind(userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

describe("purgeExpired", () => {
  it("drops lapsed sessions and old rate counters, and keeps the live ones", async () => {
    const { userId } = await signIn("google", uniqueSub("purge"));
    await env.DB.batch([
      env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(userId),
      env.DB.prepare(
        "INSERT INTO sessions(id,user_id,refresh_token_hash,expires_at,created_at) VALUES (?,?,?,?,?)",
      ).bind("gone", userId, "hash-gone", NOW - 1, NOW - 2),
      env.DB.prepare(
        "INSERT INTO sessions(id,user_id,refresh_token_hash,expires_at,created_at) VALUES (?,?,?,?,?)",
      ).bind("live", userId, "hash-live", NOW + 1, NOW - 2),
      env.DB.prepare(
        "INSERT INTO rate_counters(user_id,route_group,window_start,count) VALUES (?,?,?,1)",
      ).bind(userId, "expense_write", NOW - 2 * HOUR),
      env.DB.prepare(
        "INSERT INTO rate_counters(user_id,route_group,window_start,count) VALUES (?,?,?,1)",
      ).bind(userId, "expense_write", NOW - HOUR / 2),
    ]);

    await purgeExpired(createDb(env.DB), NOW);

    expect(await count("sessions", userId)).toBe(1);
    expect(await count("rate_counters", userId)).toBe(1);
  });
});
