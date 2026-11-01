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
  })
  .post("/maintenance/migration/import/:id", async (c) => {
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

    const memberRows = members?.results ?? [];
    const totalBalance = memberRows.reduce((sum, m) => sum + Number(m.net_balance ?? 0), 0);
    if (totalBalance !== 0) throw new ApiError("EDIT_CONFLICT");

    const snapshot = {
      group: groups.results[0],
      members: memberRows,
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

    const now = Date.now();
    const stub = c.env.GROUP_LEDGER.get(c.env.GROUP_LEDGER.idFromName(id));
    const importRes = await stub.fetch("https://ledger.internal/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snapshot, now }),
    });
    if (!importRes.ok) throw new ApiError("INTERNAL");

    const reservations = memberRows
      .filter((m) => m.user_id && m.status === "active")
      .map((m) =>
        db
          .prepare(
            "INSERT OR IGNORE INTO group_reservations (user_id, group_id, status, created_at) VALUES (?, ?, 'active', ?)",
          )
          .bind(m.user_id, id, now),
      );
    if (reservations.length > 0) {
      await db.batch(reservations);
    }

    c.header("Cache-Control", "no-store");
    return c.json({
      ok: true,
      groupId: id,
      membersCount: memberRows.length,
      expensesCount: snapshot.expenses.length,
      settlementsCount: snapshot.settlements.length,
      stopsCount: snapshot.stops.length,
      fingerprint,
    });
  })
  .post("/maintenance/migration/wipe-excluded/:id", async (c) => {
    const secret = c.env.MAINTENANCE;
    if (!secret || c.req.header("X-Maintenance-Bypass") !== secret) throw new ApiError("NOT_FOUND");

    const id = c.req.param("id");
    const db = c.env.DB;

    // 1. Uniquely verify the retained group "明天去哪玩"
    const groups = await db
      .prepare("SELECT * FROM groups WHERE name = ? ORDER BY id")
      .bind("明天去哪玩")
      .all();
    if (groups.results.length !== 1 || groups.results[0]?.id !== id) {
      throw new ApiError("EDIT_CONFLICT");
    }

    // 2. Verify that the retained group was already imported into its ledger DO
    const ledgerCheck = await c.env.GROUP_LEDGER.get(c.env.GROUP_LEDGER.idFromName(id)).fetch(
      "https://ledger.internal/expense-op",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "balances" }),
      },
    );
    if (!ledgerCheck.ok) {
      throw new ApiError("EDIT_CONFLICT");
    }
    const body = (await ledgerCheck.json()) as { value?: unknown };
    if (!Array.isArray(body?.value) || body.value.length === 0) {
      throw new ApiError("EDIT_CONFLICT");
    }

    // 3. Atomically wipe all excluded groups in D1 and any ledger DOs, preserving users, identities, sessions, and the retained group
    const excluded = await db
      .prepare("SELECT id FROM groups WHERE id != ?")
      .bind(id)
      .all<{ id: string }>();

    const queries = [
      db
        .prepare(
          "DELETE FROM expense_splits WHERE expense_id IN (SELECT id FROM expenses WHERE group_id != ?)",
        )
        .bind(id),
      db
        .prepare(
          "DELETE FROM expense_payers WHERE expense_id IN (SELECT id FROM expenses WHERE group_id != ?)",
        )
        .bind(id),
      db.prepare("DELETE FROM expenses WHERE group_id != ?").bind(id),
      db.prepare("DELETE FROM settlements WHERE group_id != ?").bind(id),
      db.prepare("DELETE FROM stops WHERE group_id != ?").bind(id),
      db.prepare("DELETE FROM invites WHERE group_id != ?").bind(id),
      db.prepare("DELETE FROM members WHERE group_id != ?").bind(id),
      db.prepare("DELETE FROM groups WHERE id != ?").bind(id),
      db.prepare("DELETE FROM group_directory WHERE group_id != ?").bind(id),
      db.prepare("DELETE FROM group_member_summary WHERE group_id != ?").bind(id),
      db.prepare("DELETE FROM group_reservations WHERE group_id != ?").bind(id),
      db.prepare("DELETE FROM personal_spending WHERE group_id != ?").bind(id),
    ];
    await db.batch(queries);

    for (const row of excluded.results) {
      try {
        await c.env.GROUP_LEDGER.get(c.env.GROUP_LEDGER.idFromName(row.id)).fetch(
          "https://ledger.internal/delete",
          { method: "POST" },
        );
      } catch {
        // ledger DO may not have been created for legacy-only groups
      }
    }

    // 4. Verify retained group is still present
    const remaining = await db.prepare("SELECT id FROM groups").all();
    if (remaining.results.length !== 1 || remaining.results[0]?.id !== id) {
      throw new ApiError("INTERNAL");
    }

    c.header("Cache-Control", "no-store");
    return c.json({
      ok: true,
      retainedGroupId: id,
      wiped: true,
    });
  });
}
