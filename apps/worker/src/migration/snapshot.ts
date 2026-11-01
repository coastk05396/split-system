import { Hono } from "hono";
import type { AppEnv } from "../api.js";
import { ApiError } from "../errors.js";

export const RETAINED_GROUP_NAMES = ["明天去哪玩", "YoYoYo", "Test"] as const;
export type RetainedGroupName = (typeof RETAINED_GROUP_NAMES)[number];

/** A consistent snapshot is captured while the maintenance gate blocks normal writes. */
export function migrationSnapshotRoutes() {
  return new Hono<AppEnv>()
    .get("/maintenance/migration/snapshot/:id", async (c) => {
      const secret = c.env.MAINTENANCE;
      if (!secret || c.req.header("X-Maintenance-Bypass") !== secret)
        throw new ApiError("NOT_FOUND");

      const id = c.req.param("id");
      const db = c.env.DB;

      const groupRow = await db
        .prepare("SELECT * FROM groups WHERE id = ?")
        .bind(id)
        .first<{ id: string; name: string }>();
      if (
        groupRow === null ||
        !RETAINED_GROUP_NAMES.includes(groupRow.name as RetainedGroupName)
      ) {
        throw new ApiError("EDIT_CONFLICT");
      }

      const candidates = await db
        .prepare("SELECT id FROM groups WHERE name = ? ORDER BY id")
        .bind(groupRow.name)
        .all<{ id: string }>();
      if (candidates.results.length !== 1 || candidates.results[0]?.id !== id) {
        throw new ApiError("EDIT_CONFLICT");
      }

      const queries = [
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
      const [members, invites, expenses, payers, splits, settlements, stops] =
        await db.batch<Record<string, unknown>>(queries);
      if (
        [members, invites, expenses, payers, splits, settlements, stops].some(
          (r) => r === undefined || !r.success,
        )
      )
        throw new ApiError("INTERNAL");
      const snapshot = {
        group: groupRow,
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
      if (!secret || c.req.header("X-Maintenance-Bypass") !== secret)
        throw new ApiError("NOT_FOUND");

      const id = c.req.param("id");
      const db = c.env.DB;

      const targetGroup = await db
        .prepare("SELECT * FROM groups WHERE id = ?")
        .bind(id)
        .first<{ id: string; name: string }>();
      if (
        targetGroup === null ||
        !RETAINED_GROUP_NAMES.includes(targetGroup.name as RetainedGroupName)
      ) {
        throw new ApiError("EDIT_CONFLICT");
      }
      const candidates = await db
        .prepare("SELECT id FROM groups WHERE name = ? ORDER BY id")
        .bind(targetGroup.name)
        .all<{ id: string }>();
      if (candidates.results.length !== 1 || candidates.results[0]?.id !== id) {
        throw new ApiError("EDIT_CONFLICT");
      }

      const queries = [
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
      const [members, invites, expenses, payers, splits, settlements, stops] =
        await db.batch<Record<string, unknown>>(queries);
      if (
        [members, invites, expenses, payers, splits, settlements, stops].some(
          (r) => r === undefined || !r.success,
        )
      )
        throw new ApiError("INTERNAL");

      const memberRows = members?.results ?? [];
      const totalBalance = memberRows.reduce((sum, m) => sum + Number(m.net_balance ?? 0), 0);
      if (totalBalance !== 0) throw new ApiError("EDIT_CONFLICT");

      const snapshot = {
        group: targetGroup,
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
      if (!secret || c.req.header("X-Maintenance-Bypass") !== secret)
        throw new ApiError("NOT_FOUND");

      const id = c.req.param("id");
      const db = c.env.DB;

      // 1. Verify caller provided a valid retained group ID
      const callerGroup = await db
        .prepare("SELECT * FROM groups WHERE id = ?")
        .bind(id)
        .first<{ id: string; name: string }>();
      if (
        callerGroup === null ||
        !RETAINED_GROUP_NAMES.includes(callerGroup.name as RetainedGroupName)
      ) {
        throw new ApiError("EDIT_CONFLICT");
      }

      // 2. Discover all retained groups that exist in D1
      const namePlaceholders = RETAINED_GROUP_NAMES.map(() => "?").join(",");
      const retainedGroups = await db
        .prepare(`SELECT * FROM groups WHERE name IN (${namePlaceholders}) ORDER BY id`)
        .bind(...RETAINED_GROUP_NAMES)
        .all<{ id: string; name: string }>();
      if (retainedGroups.results.length === 0) {
        throw new ApiError("EDIT_CONFLICT");
      }

      // Verify each retained group in D1 has already been imported into its ledger DO and has zero-sum balance
      for (const group of retainedGroups.results) {
        const ledgerCheck = await c.env.GROUP_LEDGER.get(
          c.env.GROUP_LEDGER.idFromName(group.id),
        ).fetch("https://ledger.internal/expense-op", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "balances", systemBypass: true }),
        });
        if (!ledgerCheck.ok) {
          throw new ApiError("EDIT_CONFLICT");
        }
        const body = await ledgerCheck.json<{
          value?: Array<{ id: string; net_balance: number }>;
        }>();
        if (!Array.isArray(body.value) || body.value.length === 0) {
          throw new ApiError("EDIT_CONFLICT");
        }
        const balanceSum = body.value.reduce((acc, curr) => acc + curr.net_balance, 0);
        if (balanceSum !== 0) {
          throw new ApiError("EDIT_CONFLICT");
        }
      }

      const retainedIds = retainedGroups.results.map((g) => g.id);
      const idPlaceholders = retainedIds.map(() => "?").join(",");

      // Persist the work list in the same D1 transaction as the wipe, so a retry
      // can continue even if the Worker stops after the legacy rows are removed.
      await db
        .prepare(
          "CREATE TABLE IF NOT EXISTS migration_wipe_pending (retained_id TEXT NOT NULL, group_id TEXT NOT NULL, PRIMARY KEY (retained_id, group_id))",
        )
        .run();
      const queries = [
        db
          .prepare(
            `INSERT OR IGNORE INTO migration_wipe_pending (retained_id, group_id) SELECT ?, id FROM groups WHERE id NOT IN (${idPlaceholders})`,
          )
          .bind(id, ...retainedIds),
        db
          .prepare(
            `DELETE FROM expense_splits WHERE expense_id IN (SELECT id FROM expenses WHERE group_id NOT IN (${idPlaceholders}))`,
          )
          .bind(...retainedIds),
        db
          .prepare(
            `DELETE FROM expense_payers WHERE expense_id IN (SELECT id FROM expenses WHERE group_id NOT IN (${idPlaceholders}))`,
          )
          .bind(...retainedIds),
        db
          .prepare(`DELETE FROM expenses WHERE group_id NOT IN (${idPlaceholders})`)
          .bind(...retainedIds),
        db
          .prepare(`DELETE FROM settlements WHERE group_id NOT IN (${idPlaceholders})`)
          .bind(...retainedIds),
        db.prepare(`DELETE FROM stops WHERE group_id NOT IN (${idPlaceholders})`).bind(...retainedIds),
        db
          .prepare(`DELETE FROM invites WHERE group_id NOT IN (${idPlaceholders})`)
          .bind(...retainedIds),
        db
          .prepare(`DELETE FROM members WHERE group_id NOT IN (${idPlaceholders})`)
          .bind(...retainedIds),
        db.prepare(`DELETE FROM groups WHERE id NOT IN (${idPlaceholders})`).bind(...retainedIds),
        db
          .prepare(`DELETE FROM group_directory WHERE group_id NOT IN (${idPlaceholders})`)
          .bind(...retainedIds),
        db
          .prepare(`DELETE FROM group_member_summary WHERE group_id NOT IN (${idPlaceholders})`)
          .bind(...retainedIds),
        db
          .prepare(`DELETE FROM group_reservations WHERE group_id NOT IN (${idPlaceholders})`)
          .bind(...retainedIds),
        db
          .prepare(`DELETE FROM personal_spending WHERE group_id NOT IN (${idPlaceholders})`)
          .bind(...retainedIds),
      ];
      await db.batch(queries);

      const pending = await db
        .prepare(
          "SELECT group_id FROM migration_wipe_pending WHERE retained_id=? ORDER BY group_id",
        )
        .bind(id)
        .all<{ group_id: string }>();
      const failedDeletes: string[] = [];
      for (const row of pending.results) {
        try {
          const res = await c.env.GROUP_LEDGER.get(
            c.env.GROUP_LEDGER.idFromName(row.group_id),
          ).fetch("https://ledger.internal/delete", {
            method: "POST",
            body: JSON.stringify({ systemBypass: true }),
          });
          if (!res.ok && res.status !== 404) {
            failedDeletes.push(row.group_id);
            continue;
          }
          await db
            .prepare("DELETE FROM migration_wipe_pending WHERE retained_id=? AND group_id=?")
            .bind(id, row.group_id)
            .run();
        } catch {
          failedDeletes.push(row.group_id);
        }
      }
      if (failedDeletes.length > 0) {
        throw new ApiError("INTERNAL", { failedLedgers: failedDeletes });
      }

      // 4. Verify all retained groups are still present
      const remaining = await db.prepare("SELECT id FROM groups ORDER BY id").all<{ id: string }>();
      const remainingIds = remaining.results.map((r) => r.id);
      if (
        remainingIds.length !== retainedIds.length ||
        !remainingIds.every((rid) => retainedIds.includes(rid))
      ) {
        throw new ApiError("INTERNAL");
      }

      c.header("Cache-Control", "no-store");
      return c.json({
        ok: true,
        retainedGroupId: id,
        retainedGroupIds: retainedIds,
        wiped: true,
      });
    });
}
