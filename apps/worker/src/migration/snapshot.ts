import { Hono } from "hono";
import type { AppEnv } from "../api.js";
import { ApiError } from "../errors.js";

/** A consistent snapshot is captured while the maintenance gate blocks normal writes. */
export function migrationSnapshotRoutes() {
  return new Hono<AppEnv>().get("/maintenance/migration/snapshot/:id", async (c) => {
    const secret = c.env.MAINTENANCE;
    if (!secret || c.req.header("X-Maintenance-Bypass") !== secret) throw new ApiError("NOT_FOUND");

    const id = c.req.param("id");
    const db = c.env.DB;
    const queries = [
      db.prepare("SELECT * FROM groups WHERE name = ? ORDER BY id").bind("明天去哪玩"),
      db.prepare("SELECT * FROM members WHERE group_id = ? ORDER BY id").bind(id),
      db.prepare("SELECT * FROM invites WHERE group_id = ? ORDER BY id").bind(id),
      db.prepare("SELECT * FROM expenses WHERE group_id = ? ORDER BY id").bind(id),
      db
        .prepare(
          "SELECT p.* FROM expense_payers p JOIN expenses e ON e.id=p.expense_id WHERE e.group_id = ? ORDER BY p.id",
        )
        .bind(id),
      db
        .prepare(
          "SELECT s.* FROM expense_splits s JOIN expenses e ON e.id=s.expense_id WHERE e.group_id = ? ORDER BY s.id",
        )
        .bind(id),
      db.prepare("SELECT * FROM settlements WHERE group_id = ? ORDER BY id").bind(id),
      db.prepare("SELECT * FROM stops WHERE group_id = ? ORDER BY id").bind(id),
    ];
    const [groups, members, invites, expenses, payers, splits, settlements, stops] =
      await db.batch<Record<string, unknown>>(queries);
    if (
      [groups, members, invites, expenses, payers, splits, settlements, stops].some(
        (r) => r === undefined || !r.success,
      )
    )
      throw new ApiError("INTERNAL");
    if (groups === undefined || groups.results.length !== 1 || groups.results[0]?.id !== id)
      throw new ApiError("EDIT_CONFLICT");
    const snapshot = {
      group: groups.results[0],
      members: members?.results ?? [],
      invites: invites?.results ?? [],
      expenses: expenses?.results ?? [],
      payers: payers?.results ?? [],
      splits: splits?.results ?? [],
      settlements: settlements?.results ?? [],
      stops: stops?.results ?? [],
    };
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(snapshot)),
    );
    const fingerprint = Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    c.header("Cache-Control", "no-store");
    return c.json({ ...snapshot, fingerprint });
  });
}
