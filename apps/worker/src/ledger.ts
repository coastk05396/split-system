import {
  assertFrozenBalancesUnchanged,
  frozenBalances,
  finalizeAccount,
  freezeAccount,
  isFrozen,
} from "./ledger-account-deletion.js";
import { DurableObject } from "cloudflare:workers";
import {
  groupInputSchema,
  expenseSchema,
  groupPatchSchema,
  memberPatchSchema,
  placeholderInputSchema,
  settlementSchema,
  tripDatesValid,
} from "@split/shared";
import { z } from "zod";
import type { Bindings } from "./env.js";
import { ApiError } from "./errors.js";
import { expenseOperation, type ExpenseOperation } from "./ledger-expenses.js";
import { settlementOperation } from "./ledger-settlements.js";

const initialiseGroupSchema = z.object({
  id: z.uuid(),
  memberId: z.uuid(),
  userId: z.uuid(),
  now: z.number().int(),
  input: groupInputSchema,
});

const memberOpSchema = z.object({
  action: z.enum(["add", "patch", "remove", "leave", "join", "claim"]),
  actorMemberId: z.string().optional(),
  targetMemberId: z.string().optional(),
  userId: z.string().optional(),
  input: z.unknown().optional(),
  now: z.number().int(),
  names: z.record(z.string(), z.string()).optional(),
  targetBalance: z.number().optional(),
  hasHistory: z.boolean().optional(),
});

interface LedgerGroup extends Record<string, SqlStorageValue> {
  id: string;
  name: string;
  settlement_currency: string;
  default_expense_currency: string;
  is_trip: number;
  trip_destination: string | null;
  trip_start_date: string | null;
  trip_end_date: string | null;
  trip_notes: string | null;
  created_at: number;
  updated_at: number;
  deleted: number;
}

interface LedgerMember extends Record<string, SqlStorageValue> {
  id: string;
  user_id: string | null;
  placeholder_name: string | null;
  nickname: string | null;
  created_by_member_id: string | null;
  role: string;
  status: string;
  net_balance: number;
  created_at: number;
}

export interface SyncNeeded {
  version: 1;
  type: "sync needed";
  rev: number;
  timestamp: number;
}

export class GroupLedger extends DurableObject<Bindings> {
  private drainInFlight: Promise<void> | undefined;
  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    this.upgrade();
    void ctx.blockConcurrencyWhile(async () => {
      const sql = ctx.storage.sql;
      const tables = sql
        .exec<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='ledger_dirty'",
        )
        .toArray();
      if (
        tables.length === 0 ||
        sql.exec("SELECT kind FROM ledger_dirty LIMIT 1").toArray().length === 0
      )
        return;
      if ((await ctx.storage.getAlarm()) === null) await ctx.storage.setAlarm(Date.now() + 1);
    });
  }

  private upgrade(): void {
    const sql = this.ctx.storage.sql;
    const exists = sql
      .exec<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ledger_meta'",
      )
      .toArray();
    if (exists.length === 0) return;
    this.ctx.storage.transactionSync(() => {
      this.upgradeSchema();
    });
  }

  private upgradeSchema(): void {
    const sql = this.ctx.storage.sql;
    const meta = sql
      .exec<{ schema_version: number }>("SELECT schema_version FROM ledger_meta")
      .one();
    if (meta.schema_version < 2) {
      sql.exec(`CREATE TABLE ledger_group (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, settlement_currency TEXT NOT NULL,
        default_expense_currency TEXT NOT NULL, is_trip INTEGER NOT NULL,
        trip_destination TEXT, trip_start_date TEXT, trip_end_date TEXT, trip_notes TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0
      )`);
      sql.exec(`CREATE TABLE ledger_members (
        id TEXT PRIMARY KEY, user_id TEXT, role TEXT NOT NULL, status TEXT NOT NULL,
        net_balance INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
      )`);
      sql.exec("CREATE TABLE ledger_dirty (kind TEXT PRIMARY KEY, rev INTEGER NOT NULL)");
      sql.exec("UPDATE ledger_meta SET schema_version = 2");
    }
    if (meta.schema_version < 3) {
      sql.exec("ALTER TABLE ledger_meta ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0");
      sql.exec("UPDATE ledger_meta SET schema_version = 3");
    }
    if (meta.schema_version < 4) {
      sql.exec("ALTER TABLE ledger_members ADD COLUMN placeholder_name TEXT");
      sql.exec("ALTER TABLE ledger_members ADD COLUMN nickname TEXT");
      sql.exec("ALTER TABLE ledger_members ADD COLUMN created_by_member_id TEXT");
      sql.exec("UPDATE ledger_meta SET schema_version = 4");
    }
    if (meta.schema_version < 5) {
      sql.exec(
        "CREATE TABLE ledger_settlements (id TEXT PRIMARY KEY, data TEXT NOT NULL, idempotency_key TEXT UNIQUE)",
      );
      sql.exec("UPDATE ledger_meta SET schema_version = 5");
    }
    if (meta.schema_version < 6) {
      sql.exec(
        "CREATE TABLE IF NOT EXISTS ledger_expenses (id TEXT PRIMARY KEY, creator_member_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, data TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, UNIQUE(creator_member_id,idempotency_key))",
      );
      sql.exec("UPDATE ledger_meta SET schema_version = 6");
    }
  }

  private drain(): Promise<void> {
    if (this.drainInFlight !== undefined) return this.drainInFlight;
    this.drainInFlight = this.push().finally(() => {
      this.drainInFlight = undefined;
    });
    return this.drainInFlight;
  }

  private async push(): Promise<void> {
    const snapshot = this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql;
      if (
        sql
          .exec("SELECT name FROM sqlite_master WHERE type='table' AND name='ledger_dirty'")
          .toArray().length === 0
      )
        return null;
      const dirty = sql
        .exec<{ rev: number }>(
          "SELECT rev FROM ledger_meta WHERE EXISTS (SELECT 1 FROM ledger_dirty)",
        )
        .toArray()[0];
      if (dirty === undefined) return null;
      const expenseIds = sql
        .exec<{ kind: string }>(
          "SELECT kind FROM ledger_dirty WHERE kind LIKE 'expense:%' ORDER BY rev,kind LIMIT 25",
        )
        .toArray()
        .map((row) => row.kind.slice(8));
      const expenseRows = expenseIds.flatMap((id) =>
        sql
          .exec<{ data: string }>("SELECT data FROM ledger_expenses WHERE id=? AND deleted=0", id)
          .toArray(),
      );
      return {
        rev: dirty.rev,
        expenseIds,
        group: sql.exec<LedgerGroup>("SELECT * FROM ledger_group").one(),
        expenses: expenseRows.map((row) => expenseSchema.parse(JSON.parse(row.data) as unknown)),
        locked:
          sql.exec<{ n: number }>("SELECT count(*) n FROM ledger_expenses WHERE deleted=0").one()
            .n > 0,
        members: sql
          .exec<LedgerMember>("SELECT * FROM ledger_members ORDER BY created_at, rowid")
          .toArray(),
        settlements: sql
          .exec<{ data: string; idempotency_key: string | null }>(
            "SELECT data,idempotency_key FROM ledger_settlements WHERE id IN (SELECT substr(kind,12) FROM ledger_dirty WHERE kind LIKE 'settlement:%' AND rev <= ?)",
            dirty.rev,
          )
          .toArray(),
        deletedStops: sql
          .exec<{ id: string }>(
            "SELECT substr(kind,6) AS id FROM ledger_dirty WHERE kind LIKE 'stop:%' AND rev <= ?",
            dirty.rev,
          )
          .toArray(),
      };
    });
    if (snapshot === null) return;
    const {
      group: g,
      members,
      settlements,
      deletedStops,
      rev,
      locked,
      expenses,
      expenseIds,
    } = snapshot;
    const db = this.env.DB;
    const fence = "COALESCE((SELECT rev FROM group_directory WHERE group_id = ?), -1) <= ?";
    try {
      const statements: D1PreparedStatement[] = [
        db
          .prepare(`DELETE FROM group_member_summary WHERE group_id = ? AND ${fence}`)
          .bind(g.id, g.id, rev),
      ];
      if (!g.deleted) {
        for (const stop of deletedStops)
          statements.push(
            db
              .prepare(`DELETE FROM stops WHERE id=? AND group_id=? AND ${fence}`)
              .bind(stop.id, g.id, g.id, rev),
          );
        statements.push(
          db
            .prepare(
              `INSERT INTO groups (id,name,settlement_currency,default_expense_currency,is_trip,trip_destination,trip_start_date,trip_end_date,trip_notes,created_at,updated_at)
          SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${fence} ON CONFLICT(id) DO UPDATE SET name=excluded.name, settlement_currency=excluded.settlement_currency, default_expense_currency=excluded.default_expense_currency, is_trip=excluded.is_trip, trip_destination=excluded.trip_destination, trip_start_date=excluded.trip_start_date, trip_end_date=excluded.trip_end_date, trip_notes=excluded.trip_notes, updated_at=excluded.updated_at`,
            )
            .bind(
              g.id,
              g.name,
              g.settlement_currency,
              g.default_expense_currency,
              g.is_trip,
              g.trip_destination,
              g.trip_start_date,
              g.trip_end_date,
              g.trip_notes,
              g.created_at,
              g.updated_at,
              g.id,
              rev,
            ),
        );
        const ids = members.map((member) => member.id);
        if (ids.length > 0) {
          statements.push(
            db
              .prepare(
                `DELETE FROM members WHERE group_id = ? AND id NOT IN (${ids.map(() => "?").join(",")}) AND ${fence}`,
              )
              .bind(g.id, ...ids, g.id, rev),
          );
        }
        for (const member of members) {
          statements.push(
            db
              .prepare(
                `INSERT INTO members (id,group_id,user_id,role,status,net_balance,created_at,placeholder_name,nickname,created_by_member_id)
                 SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${fence} ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id,role=excluded.role,status=excluded.status,net_balance=excluded.net_balance,placeholder_name=excluded.placeholder_name,nickname=excluded.nickname,created_by_member_id=excluded.created_by_member_id`,
              )
              .bind(
                member.id,
                g.id,
                member.user_id,
                member.role,
                member.status,
                member.net_balance,
                member.created_at,
                member.placeholder_name,
                member.nickname,
                member.created_by_member_id,
                g.id,
                rev,
              ),
          );
          if (member.user_id !== null && member.status !== "active") {
            statements.push(
              db
                .prepare(
                  `DELETE FROM group_reservations WHERE user_id = ? AND group_id = ? AND ${fence}`,
                )
                .bind(member.user_id, g.id, g.id, rev),
            );
          }
          if (member.user_id !== null && member.status === "active") {
            statements.push(
              db
                .prepare(
                  `INSERT INTO group_member_summary (user_id,group_id,member_id,role,net_balance,rev) SELECT ?,?,?,?,?,? WHERE ${fence}`,
                )
                .bind(
                  member.user_id,
                  g.id,
                  member.id,
                  member.role,
                  member.net_balance,
                  rev,
                  g.id,
                  rev,
                ),
            );
            statements.push(
              db
                .prepare(
                  `UPDATE group_reservations SET status = 'active' WHERE user_id = ? AND group_id = ? AND ${fence}`,
                )
                .bind(member.user_id, g.id, g.id, rev),
            );
          }
        }
      } else {
        statements.push(
          db.prepare(`DELETE FROM groups WHERE id = ? AND ${fence}`).bind(g.id, g.id, rev),
        );
        statements.push(
          db
            .prepare(`DELETE FROM group_reservations WHERE group_id = ? AND ${fence}`)
            .bind(g.id, g.id, rev),
        );
      }
      if (!g.deleted)
        for (const row of settlements) {
          const item = settlementSchema.parse(JSON.parse(row.data) as unknown);
          statements.push(
            db
              .prepare(
                `INSERT INTO settlements (id,group_id,payer_member_id,receiver_member_id,amount,status,created_by_member_id,confirmed_by_member_id,confirmed_at,undone_by_member_id,undone_at,idempotency_key,created_at,updated_at)
          SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${fence} ON CONFLICT(id) DO UPDATE SET amount=excluded.amount,status=excluded.status,confirmed_by_member_id=excluded.confirmed_by_member_id,confirmed_at=excluded.confirmed_at,undone_by_member_id=excluded.undone_by_member_id,undone_at=excluded.undone_at,updated_at=excluded.updated_at`,
              )
              .bind(
                item.id,
                item.groupId,
                item.payerMemberId,
                item.receiverMemberId,
                item.amount,
                item.status,
                item.createdByMemberId,
                item.confirmedByMemberId,
                item.confirmedAt,
                item.undoneByMemberId,
                item.undoneAt,
                row.idempotency_key,
                item.createdAt,
                item.updatedAt,
                g.id,
                rev,
              ),
          );
        }
      const spending = g.deleted
        ? []
        : expenses.flatMap((expense) =>
            expense.splits.flatMap((split) => {
              const member = members.find(
                (m) => m.id === split.memberId && m.status === "active" && m.user_id !== null,
              );
              return member?.user_id
                ? [
                    {
                      expenseId: expense.id,
                      userId: member.user_id,
                      description: expense.description,
                      expenseDate: expense.expenseDate,
                      category: expense.category,
                      currency: g.settlement_currency,
                      amount: split.settlementAmount,
                    },
                  ]
                : [];
            }),
          );
      statements.push(
        db
          .prepare(
            `DELETE FROM personal_spending WHERE group_id = ? AND (? = 1 OR expense_id IN (SELECT value FROM json_each(?))) AND ${fence}`,
          )
          .bind(g.id, g.deleted, JSON.stringify(expenseIds), g.id, rev),
      );
      statements.push(
        db
          .prepare(
            `INSERT INTO personal_spending (group_id,expense_id,user_id,description,expense_date,category,currency,amount,rev)
        SELECT ?,json_extract(j.value,'$.expenseId'),json_extract(j.value,'$.userId'),json_extract(j.value,'$.description'),json_extract(j.value,'$.expenseDate'),json_extract(j.value,'$.category'),json_extract(j.value,'$.currency'),json_extract(j.value,'$.amount'),? FROM json_each(?) j WHERE ${fence}`,
          )
          .bind(g.id, rev, JSON.stringify(spending), g.id, rev),
      );
      const active = members.filter((m) => m.status === "active" || m.status === "placeholder");
      statements.push(
        db
          .prepare(
            `INSERT INTO group_directory (group_id,name,settlement_currency,is_trip,trip_destination,trip_start_date,trip_end_date,trip_notes,settlement_currency_locked,member_count,member_preview,created_at,updated_at,rev,deleted)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(group_id) DO UPDATE SET name=excluded.name,settlement_currency=excluded.settlement_currency,is_trip=excluded.is_trip,trip_destination=excluded.trip_destination,trip_start_date=excluded.trip_start_date,trip_end_date=excluded.trip_end_date,trip_notes=excluded.trip_notes,settlement_currency_locked=excluded.settlement_currency_locked,member_count=excluded.member_count,member_preview=excluded.member_preview,created_at=excluded.created_at,updated_at=excluded.updated_at,rev=excluded.rev,deleted=excluded.deleted WHERE group_directory.rev <= excluded.rev`,
          )
          .bind(
            g.id,
            g.deleted ? null : g.name,
            g.deleted ? null : g.settlement_currency,
            g.deleted ? null : g.is_trip,
            g.deleted ? null : g.trip_destination,
            g.deleted ? null : g.trip_start_date,
            g.deleted ? null : g.trip_end_date,
            g.deleted ? null : g.trip_notes,
            g.deleted ? null : Number(locked),
            g.deleted ? null : active.length,
            g.deleted
              ? null
              : JSON.stringify(
                  active
                    .slice(0, 4)
                    .map((m) => ({ userId: m.user_id, placeholderName: m.placeholder_name })),
                ),
            g.deleted ? null : g.created_at,
            g.deleted ? null : g.updated_at,
            rev,
            g.deleted,
          ),
      );
      await db.batch(statements);
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          "DELETE FROM ledger_dirty WHERE (kind='group' OR kind LIKE 'settlement:%' OR kind LIKE 'stop:%') AND rev <= ?",
          rev,
        );
        for (const id of expenseIds)
          this.ctx.storage.sql.exec(
            "DELETE FROM ledger_dirty WHERE kind=? AND rev <= ?",
            `expense:${id}`,
            rev,
          );
        this.ctx.storage.sql.exec("UPDATE ledger_meta SET retry_count = 0");
      });
      if (this.ctx.storage.sql.exec("SELECT kind FROM ledger_dirty LIMIT 1").toArray().length > 0)
        await this.ctx.storage.setAlarm(Date.now() + 1);
    } catch {
      const retries = this.ctx.storage.sql
        .exec<{ retry_count: number }>("SELECT retry_count FROM ledger_meta")
        .one().retry_count;
      this.ctx.storage.sql.exec("UPDATE ledger_meta SET retry_count = retry_count + 1");
      const delay = Math.min(300_000, 2_000 * 2 ** Math.min(retries, 8));
      await this.ctx.storage.setAlarm(
        Date.now() + Math.min(300_000, delay * (0.8 + Math.random() * 0.4)),
      );
    }
  }

  override async alarm(): Promise<void> {
    await this.drain();
  }

  override async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname === "/delete-stop" && request.method === "POST") {
      const input = z.object({ stopId: z.string() }).safeParse(await request.json());
      if (!input.success) return new Response(null, { status: 400 });
      if ((await this.ctx.storage.getAlarm()) === null)
        await this.ctx.storage.setAlarm(Date.now() + 2000);
      const rev = this.ctx.storage.transactionSync(() => {
        const sql = this.ctx.storage.sql;
        for (const row of sql
          .exec<{ id: string; data: string }>("SELECT id,data FROM ledger_expenses WHERE deleted=0")
          .toArray()) {
          const expense = expenseSchema.parse(JSON.parse(row.data) as unknown);
          if (expense.stopId !== input.data.stopId) continue;
          expense.stopId = null;
          sql.exec("UPDATE ledger_expenses SET data=? WHERE id=?", JSON.stringify(expense), row.id);
        }
        sql.exec("UPDATE ledger_meta SET rev=rev+1");
        sql.exec(
          "INSERT INTO ledger_dirty(kind,rev) SELECT ?,rev FROM ledger_meta WHERE true ON CONFLICT(kind) DO UPDATE SET rev=excluded.rev",
          `stop:${input.data.stopId}`,
        );
        return sql.exec<{ rev: number }>("SELECT rev FROM ledger_meta").one().rev;
      });
      const signal: SyncNeeded = { version: 1, type: "sync needed", rev, timestamp: Date.now() };
      for (const socket of this.ctx.getWebSockets()) {
        try {
          socket.send(JSON.stringify(signal));
        } catch {
          /* socket closed */
        }
      }
      await this.drain();
      return new Response(null, { status: 204, headers: { "X-Group-Rev": String(rev) } });
    }
    if (new URL(request.url).pathname === "/placeholder-counts" && request.method === "GET") {
      const counts: Record<string, number> = {};
      for (const row of this.ctx.storage.sql
        .exec<{ data: string }>("SELECT data FROM ledger_expenses WHERE deleted=0")
        .toArray()) {
        const expense = expenseSchema.parse(JSON.parse(row.data) as unknown);
        const ids = new Set([
          ...expense.payers.map((payer) => payer.memberId),
          ...expense.splits.map((split) => split.memberId),
        ]);
        for (const id of ids) counts[id] = (counts[id] ?? 0) + 1;
      }
      return Response.json(counts);
    }
    if (new URL(request.url).pathname === "/settlement-op" && request.method === "POST") {
      const payload: unknown = await request.json();
      try {
        if (
          typeof payload === "object" &&
          payload !== null &&
          "action" in payload &&
          payload.action !== "list" &&
          (await this.ctx.storage.getAlarm()) === null
        ) {
          await this.ctx.storage.setAlarm(Date.now() + 2000);
        }
        const result = this.ctx.storage.transactionSync(() => {
          const now =
            typeof payload === "object" &&
            payload !== null &&
            "now" in payload &&
            typeof payload.now === "number"
              ? payload.now
              : Date.now();
          const frozen = frozenBalances(this.ctx.storage.sql, now);
          const outcome = settlementOperation(this.ctx.storage.sql, payload);
          assertFrozenBalancesUnchanged(this.ctx.storage.sql, frozen);
          if (outcome.changed) {
            this.ctx.storage.sql.exec("UPDATE ledger_meta SET rev=rev+1");
            this.ctx.storage.sql.exec(
              "INSERT INTO ledger_dirty(kind,rev) SELECT ?,rev FROM ledger_meta WHERE true ON CONFLICT(kind) DO UPDATE SET rev=excluded.rev",
              `settlement:${outcome.id ?? ""}`,
            );
          }
          return {
            ...outcome,
            rev: this.ctx.storage.sql.exec<{ rev: number }>("SELECT rev FROM ledger_meta").one()
              .rev,
          };
        });
        if (result.changed) {
          const signal: SyncNeeded = {
            version: 1,
            type: "sync needed",
            rev: result.rev,
            timestamp: Date.now(),
          };
          for (const socket of this.ctx.getWebSockets()) {
            try {
              socket.send(JSON.stringify(signal));
            } catch {
              /* socket has closed */
            }
          }
          await this.drain();
        }
        return Response.json(result.data, { headers: { "X-Group-Rev": String(result.rev) } });
      } catch (error) {
        if (error instanceof ApiError)
          return Response.json(error.toBody(), { status: error.status });
        throw error;
      }
    }
    if (new URL(request.url).pathname === "/expense-op" && request.method === "POST") {
      const op = await request.json<ExpenseOperation>();
      try {
        const result = this.ctx.storage.transactionSync(() => {
          const frozen =
            op.action === "create" || op.action === "update" || op.action === "delete"
              ? frozenBalances(this.ctx.storage.sql, op.now)
              : new Map<string, number>();
          const result = expenseOperation(this.ctx.storage.sql, op);
          assertFrozenBalancesUnchanged(this.ctx.storage.sql, frozen);
          if (result.changed) {
            this.ctx.storage.sql.exec("UPDATE ledger_meta SET rev=rev+1");
            if (op.action === "create" || op.action === "update" || op.action === "delete") {
              const expenseId =
                op.action === "create" ? expenseSchema.parse(result.value).id : op.id;
              this.ctx.storage.sql.exec(
                "INSERT INTO ledger_dirty(kind,rev) SELECT ?,rev FROM ledger_meta WHERE true ON CONFLICT(kind) DO UPDATE SET rev=excluded.rev",
                `expense:${expenseId}`,
              );
            }
            this.ctx.storage.sql.exec(
              "INSERT INTO ledger_dirty(kind,rev) SELECT 'group',rev FROM ledger_meta WHERE true ON CONFLICT(kind) DO UPDATE SET rev=excluded.rev",
            );
          }
          return result;
        });
        if (result.changed) {
          const rev = this.ctx.storage.sql
            .exec<{ rev: number }>("SELECT rev FROM ledger_meta")
            .one().rev;
          const signal: SyncNeeded = {
            version: 1,
            type: "sync needed",
            rev,
            timestamp: Date.now(),
          };
          for (const socket of this.ctx.getWebSockets()) {
            try {
              socket.send(JSON.stringify(signal));
            } catch {
              /* socket closed */
            }
          }
          if ((await this.ctx.storage.getAlarm()) === null)
            await this.ctx.storage.setAlarm(Date.now() + 2000);
          await this.drain();
        }
        return Response.json({ value: result.value });
      } catch (error) {
        if (error instanceof ApiError)
          return Response.json(
            { error: error.code, details: error.details },
            { status: error.status },
          );
        throw error;
      }
    }
    if (new URL(request.url).pathname === "/account-deletion" && request.method === "POST") {
      const op = await request.json<{
        action: "freeze" | "unfreeze" | "finalize";
        userId: string;
        now: number;
        expires: number;
      }>();
      if (op.action === "freeze") {
        const result = this.ctx.storage.transactionSync(() =>
          freezeAccount(this.ctx.storage.sql, op.userId, op.expires),
        );
        return Response.json(result);
      }
      if (op.action === "unfreeze") {
        this.ctx.storage.transactionSync(() => {
          const exists =
            this.ctx.storage.sql
              .exec("SELECT name FROM sqlite_master WHERE type='table' AND name='account_freezes'")
              .toArray().length > 0;
          if (exists)
            this.ctx.storage.sql.exec(
              "DELETE FROM account_freezes WHERE user_id=? AND expires_at=?",
              op.userId,
              op.expires,
            );
        });
        return Response.json({ ok: true });
      }
      const initialized =
        this.ctx.storage.sql
          .exec("SELECT name FROM sqlite_master WHERE type='table' AND name='ledger_members'")
          .toArray().length > 0;
      if (!initialized) return Response.json({ ok: true });
      if ((await this.ctx.storage.getAlarm()) === null)
        await this.ctx.storage.setAlarm(Date.now() + 2000);
      let changed: boolean;
      try {
        changed = this.ctx.storage.transactionSync(() =>
          finalizeAccount(this.ctx.storage.sql, op.userId, op.now, op.expires),
        );
      } catch (error) {
        if (error instanceof ApiError)
          return Response.json(error.toBody(), { status: error.status });
        throw error;
      }
      if (changed) {
        for (const socket of this.ctx.getWebSockets(op.userId))
          socket.close(4003, "Membership ended");
        const rev = this.ctx.storage.sql
          .exec<{ rev: number }>("SELECT rev FROM ledger_meta")
          .one().rev;
        const signal: SyncNeeded = { version: 1, type: "sync needed", rev, timestamp: Date.now() };
        for (const socket of this.ctx.getWebSockets()) {
          try {
            socket.send(JSON.stringify(signal));
          } catch {
            /* socket has closed */
          }
        }
        await this.drain();
      }
      return Response.json({ ok: true });
    }
    if (new URL(request.url).pathname === "/member-op" && request.method === "POST") {
      const parsed = memberOpSchema.safeParse(await request.json());
      if (!parsed.success) return Response.json({ error: "VALIDATION_FAILED" }, { status: 400 });
      const op = parsed.data;
      if ((await this.ctx.storage.getAlarm()) === null)
        await this.ctx.storage.setAlarm(Date.now() + 2000);
      const result = this.ctx.storage.transactionSync(
        (): {
          memberId?: string;
          rev?: number;
          error?: string;
          details?: unknown;
          closeUserId?: string | null;
          changed?: boolean;
        } => {
          const sql = this.ctx.storage.sql;
          if (
            (op.action === "join" || op.action === "claim") &&
            op.userId !== undefined &&
            isFrozen(sql, op.userId, op.now)
          )
            return { error: "FORBIDDEN" };
          const all = sql
            .exec<LedgerMember>("SELECT * FROM ledger_members ORDER BY created_at,rowid")
            .toArray();
          const actor = all.find((m) => m.id === op.actorMemberId && m.status === "active");
          const target = all.find((m) => m.id === op.targetMemberId);
          const seated = all.filter((m) => m.status === "active" || m.status === "placeholder");
          const conflict = (name: string, except?: string) =>
            seated.some(
              (m) =>
                m.id !== except &&
                (m.placeholder_name ?? (m.user_id === null ? undefined : op.names?.[m.user_id])) ===
                  name,
            );
          let memberId = op.targetMemberId;
          let closeUserId: string | null = null;
          if (op.action !== "join" && op.action !== "claim" && actor === undefined)
            return { error: "NOT_FOUND" };
          if (op.action === "add") {
            const input = placeholderInputSchema.safeParse(op.input);
            if (!input.success || memberId === undefined) return { error: "VALIDATION_FAILED" };
            if (seated.length >= 30) return { error: "GROUP_FULL" };
            if (conflict(input.data.name)) return { error: "PLACEHOLDER_NAME_TAKEN" };
            sql.exec(
              "INSERT INTO ledger_members(id,user_id,role,status,net_balance,created_at,placeholder_name,created_by_member_id) VALUES (?,NULL,'member','placeholder',0,?,?,?)",
              memberId,
              op.now,
              input.data.name,
              actor?.id ?? null,
            );
          } else if (op.action === "join") {
            if (op.userId === undefined || memberId === undefined)
              return { error: "VALIDATION_FAILED" };
            const existing = all.find((m) => m.user_id === op.userId);
            if (existing?.status === "active")
              return {
                memberId: existing.id,
                rev: sql.exec<{ rev: number }>("SELECT rev FROM ledger_meta").one().rev,
                changed: false,
              };
            if (seated.length >= 30) return { error: "GROUP_FULL" };
            if (existing !== undefined) {
              memberId = existing.id;
              sql.exec(
                "UPDATE ledger_members SET status='active',role='member' WHERE id=?",
                memberId,
              );
            } else
              sql.exec(
                "INSERT INTO ledger_members(id,user_id,role,status,net_balance,created_at) VALUES (?,?,'member','active',0,?)",
                memberId,
                op.userId,
                op.now,
              );
          } else if (op.action === "claim") {
            if (op.userId === undefined || target === undefined) return { error: "NOT_FOUND" };
            if (all.some((m) => m.user_id === op.userId)) return { error: "ALREADY_MEMBER" };
            if (target.status !== "placeholder") return { error: "PLACEHOLDER_CLAIMED" };
            sql.exec(
              "UPDATE ledger_members SET user_id=?,status='active',placeholder_name=NULL WHERE id=?",
              op.userId,
              target.id,
            );
            memberId = target.id;
          } else if (op.action === "patch") {
            if (target === undefined) return { error: "NOT_FOUND" };
            const input = memberPatchSchema.safeParse(op.input);
            if (!input.success) return { error: "VALIDATION_FAILED" };
            if (input.data.placeholderName !== undefined) {
              if (target.status !== "placeholder") return { error: "MEMBER_NOT_ACTIVE" };
              if (conflict(input.data.placeholderName, target.id))
                return { error: "PLACEHOLDER_NAME_TAKEN" };
              sql.exec(
                "UPDATE ledger_members SET placeholder_name=? WHERE id=?",
                input.data.placeholderName,
                target.id,
              );
            } else if (input.data.role !== undefined) {
              if (actor?.role !== "admin") return { error: "FORBIDDEN" };
              if (target.status !== "active") return { error: "MEMBER_NOT_ACTIVE" };
              if (
                target.role === "admin" &&
                input.data.role === "member" &&
                !all.some((m) => m.id !== target.id && m.status === "active" && m.role === "admin")
              )
                return { error: "LAST_ADMIN" };
              sql.exec("UPDATE ledger_members SET role=? WHERE id=?", input.data.role, target.id);
            }
          } else {
            const leaving = op.action === "leave" ? actor : target;
            if (leaving === undefined) return { error: "NOT_FOUND" };
            if (leaving.id !== actor?.id && actor?.role !== "admin") return { error: "FORBIDDEN" };
            if (leaving.status === "former") return { error: "MEMBER_NOT_ACTIVE" };
            const balance = leaving.net_balance;
            if (balance !== 0)
              return {
                error: "BALANCE_NOT_ZERO",
                details: {
                  balance,
                  currency: sql.exec<LedgerGroup>("SELECT * FROM ledger_group").one()
                    .settlement_currency,
                },
              };
            if (
              leaving.id === actor.id &&
              leaving.role === "admin" &&
              !all.some((m) => m.id !== leaving.id && m.status === "active" && m.role === "admin")
            )
              return { error: "LAST_ADMIN" };
            const hasHistory =
              leaving.status === "placeholder" &&
              sql
                .exec<{ data: string }>("SELECT data FROM ledger_expenses WHERE deleted=0")
                .toArray()
                .some((row) => {
                  const expense = expenseSchema.parse(JSON.parse(row.data) as unknown);
                  return (
                    expense.payers.some((payer) => payer.memberId === leaving.id) ||
                    expense.splits.some((split) => split.memberId === leaving.id)
                  );
                });
            if (leaving.status === "placeholder" && !hasHistory)
              sql.exec("DELETE FROM ledger_members WHERE id=?", leaving.id);
            else if (leaving.status === "placeholder")
              sql.exec(
                "UPDATE ledger_members SET status='former',placeholder_name=NULL,nickname='已移除的成員' WHERE id=?",
                leaving.id,
              );
            else
              sql.exec(
                "UPDATE ledger_members SET status='former',role='member' WHERE id=?",
                leaving.id,
              );
            memberId = leaving.id;
            closeUserId = leaving.user_id;
          }
          sql.exec("UPDATE ledger_meta SET rev=rev+1");
          if (
            op.action === "claim" ||
            op.action === "leave" ||
            op.action === "remove" ||
            op.action === "join"
          )
            sql.exec(
              "INSERT INTO ledger_dirty(kind,rev) SELECT 'expense:' || ledger_expenses.id,ledger_meta.rev FROM ledger_expenses,ledger_meta WHERE ledger_expenses.deleted=0 ON CONFLICT(kind) DO UPDATE SET rev=excluded.rev",
            );
          sql.exec(
            "INSERT INTO ledger_dirty(kind,rev) SELECT 'group',rev FROM ledger_meta WHERE true ON CONFLICT(kind) DO UPDATE SET rev=excluded.rev",
          );
          if (memberId === undefined) throw new Error("Member operation has no target");
          return {
            memberId,
            rev: sql.exec<{ rev: number }>("SELECT rev FROM ledger_meta").one().rev,
            changed: true,
            closeUserId,
          };
        },
      );
      if (result.error !== undefined) return Response.json(result, { status: 409 });
      if (result.changed && result.rev !== undefined) {
        if (result.closeUserId) {
          for (const socket of this.ctx.getWebSockets(result.closeUserId)) {
            try {
              socket.close(4003, "Membership ended");
            } catch {
              /* socket closed */
            }
          }
        }
        const signal: SyncNeeded = {
          version: 1,
          type: "sync needed",
          rev: result.rev,
          timestamp: Date.now(),
        };
        for (const socket of this.ctx.getWebSockets()) {
          try {
            socket.send(JSON.stringify(signal));
          } catch {
            /* socket closed */
          }
        }
      }
      await this.drain();
      return Response.json(result);
    }
    if (new URL(request.url).pathname === "/state" && request.method === "GET") {
      const group = this.ctx.storage.sql
        .exec<LedgerGroup>("SELECT * FROM ledger_group WHERE deleted = 0")
        .toArray()[0];
      if (group === undefined) return new Response(null, { status: 404 });
      const meta = this.ctx.storage.sql.exec<{ rev: number }>("SELECT rev FROM ledger_meta").one();
      const locked =
        this.ctx.storage.sql
          .exec<{ n: number }>("SELECT count(*) AS n FROM ledger_expenses WHERE deleted=0")
          .one().n > 0;
      const seated = this.ctx.storage.sql
        .exec<LedgerMember>(
          "SELECT * FROM ledger_members WHERE status IN ('active','placeholder') ORDER BY created_at,rowid",
        )
        .toArray();
      return Response.json({ group, rev: meta.rev, locked, seated });
    }
    if (new URL(request.url).pathname === "/patch" && request.method === "POST") {
      const schema = z.object({
        patch: groupPatchSchema,
        expected: z.number().int(),
        now: z.number().int(),
      });
      const parsed = schema.safeParse(await request.json());
      if (!parsed.success) return new Response(null, { status: 400 });
      const { patch, expected, now } = parsed.data;
      if ((await this.ctx.storage.getAlarm()) === null)
        await this.ctx.storage.setAlarm(Date.now() + 2000);
      const result = this.ctx.storage.transactionSync(() => {
        const sql = this.ctx.storage.sql;
        const current = sql
          .exec<LedgerGroup>("SELECT * FROM ledger_group WHERE deleted = 0")
          .toArray()[0];
        if (current === undefined) return "NOT_FOUND";
        if (current.updated_at !== expected) return "EDIT_CONFLICT";
        const start =
          patch.tripStartDate === undefined ? current.trip_start_date : patch.tripStartDate;
        const end = patch.tripEndDate === undefined ? current.trip_end_date : patch.tripEndDate;
        if (!tripDatesValid(start, end)) return "TRIP_DATES_INVALID";
        if (
          sql.exec<{ n: number }>("SELECT count(*) AS n FROM ledger_expenses WHERE deleted=0").one()
            .n > 0 &&
          patch.settlementCurrency !== undefined &&
          patch.settlementCurrency !== current.settlement_currency
        )
          return "SETTLEMENT_CURRENCY_LOCKED";
        const currency = patch.settlementCurrency ?? current.settlement_currency;
        sql.exec(
          `UPDATE ledger_group SET name=?,settlement_currency=?,default_expense_currency=?,is_trip=?,trip_destination=?,trip_start_date=?,trip_end_date=?,trip_notes=?,updated_at=?`,
          patch.name ?? current.name,
          currency,
          currency,
          patch.isTrip === undefined ? current.is_trip : Number(patch.isTrip),
          patch.tripDestination === undefined ? current.trip_destination : patch.tripDestination,
          start,
          end,
          patch.tripNotes === undefined ? current.trip_notes : patch.tripNotes,
          Math.max(now, current.updated_at + 1),
        );
        sql.exec("UPDATE ledger_meta SET rev = rev + 1");
        sql.exec(
          "INSERT INTO ledger_dirty(kind,rev) SELECT 'group',rev FROM ledger_meta WHERE true ON CONFLICT(kind) DO UPDATE SET rev=excluded.rev",
        );
        return "OK";
      });
      if (result !== "OK") return Response.json({ error: result }, { status: 409 });
      const rev = this.ctx.storage.sql
        .exec<{ rev: number }>("SELECT rev FROM ledger_meta")
        .one().rev;
      const signal: SyncNeeded = { version: 1, type: "sync needed", rev, timestamp: Date.now() };
      for (const socket of this.ctx.getWebSockets()) {
        try {
          socket.send(JSON.stringify(signal));
        } catch {
          /* socket closed */
        }
      }
      await this.drain();
      return Response.json({ rev });
    }
    if (new URL(request.url).pathname === "/delete" && request.method === "POST") {
      if ((await this.ctx.storage.getAlarm()) === null)
        await this.ctx.storage.setAlarm(Date.now() + 2000);
      const rev = this.ctx.storage.transactionSync(() => {
        const sql = this.ctx.storage.sql;
        sql.exec("UPDATE ledger_group SET deleted=1 WHERE deleted=0");
        sql.exec("UPDATE ledger_meta SET rev=rev+1");
        sql.exec(
          "INSERT INTO ledger_dirty(kind,rev) SELECT 'group',rev FROM ledger_meta WHERE true ON CONFLICT(kind) DO UPDATE SET rev=excluded.rev",
        );
        return sql.exec<{ rev: number }>("SELECT rev FROM ledger_meta").one().rev;
      });
      const signal: SyncNeeded = { version: 1, type: "sync needed", rev, timestamp: Date.now() };
      for (const socket of this.ctx.getWebSockets()) {
        try {
          socket.send(JSON.stringify(signal));
          socket.close(4003, "Group deleted");
        } catch {
          /* socket closed */
        }
      }
      await this.drain();
      return Response.json({ rev });
    }
    if (new URL(request.url).pathname === "/create" && request.method === "POST") {
      const parsed = initialiseGroupSchema.safeParse(await request.json());
      if (!parsed.success) return new Response(null, { status: 400 });
      const { id, memberId, userId, now, input } = parsed.data;
      const inserted = await this.ctx.blockConcurrencyWhile(async () => {
        const eligible = await this.env.DB.prepare(
          `SELECT r.user_id FROM group_reservations r JOIN users u ON u.id=r.user_id
          WHERE r.user_id=? AND r.group_id=? AND NOT EXISTS
          (SELECT 1 FROM account_deletions d WHERE d.user_id=r.user_id AND d.expires_at>?)`,
        )
          .bind(userId, id, now)
          .first();
        if (eligible === null) return false;
        if ((await this.ctx.storage.getAlarm()) === null)
          await this.ctx.storage.setAlarm(Date.now() + 2000);
        return this.ctx.storage.transactionSync(() => {
          const sql = this.ctx.storage.sql;
          sql.exec(
            "CREATE TABLE IF NOT EXISTS ledger_meta (schema_version INTEGER NOT NULL, rev INTEGER NOT NULL)",
          );
          sql.exec(
            "INSERT INTO ledger_meta SELECT 1, 0 WHERE NOT EXISTS (SELECT 1 FROM ledger_meta)",
          );
          this.upgradeSchema();
          if (sql.exec("SELECT id FROM ledger_group LIMIT 1").toArray().length > 0) return false;
          sql.exec(
            `INSERT INTO ledger_group (id, name, settlement_currency, default_expense_currency, is_trip,
          trip_destination, trip_start_date, trip_end_date, trip_notes, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            id,
            input.name,
            input.settlementCurrency,
            input.settlementCurrency,
            input.isTrip ? 1 : 0,
            input.tripDestination ?? null,
            input.tripStartDate ?? null,
            input.tripEndDate ?? null,
            input.tripNotes ?? null,
            now,
            now,
          );
          sql.exec(
            "INSERT INTO ledger_members (id, user_id, role, status, net_balance, created_at) VALUES (?, ?, 'admin', 'active', 0, ?)",
            memberId,
            userId,
            now,
          );
          sql.exec("INSERT INTO ledger_dirty (kind, rev) VALUES ('group', 0)");
          return true;
        });
      });
      if (inserted) await this.drain();
      return new Response(null, { status: inserted ? 201 : 409 });
    }
    if (new URL(request.url).pathname === "/initialise" && request.method === "POST") {
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          "CREATE TABLE IF NOT EXISTS ledger_meta (schema_version INTEGER NOT NULL, rev INTEGER NOT NULL)",
        );
        this.ctx.storage.sql.exec(
          "INSERT INTO ledger_meta SELECT 1, 0 WHERE NOT EXISTS (SELECT 1 FROM ledger_meta)",
        );
      });
      this.upgrade();
      return new Response(null, { status: 204 });
    }
    const pathname = new URL(request.url).pathname;
    if (pathname !== "/live" && pathname !== "/member-check")
      return new Response(null, { status: 404 });
    const candidate = request.headers.get("X-User-Id");
    const sql = this.ctx.storage.sql;
    const exists = sql
      .exec("SELECT name FROM sqlite_master WHERE type='table' AND name='ledger_members'")
      .toArray();
    if (
      candidate === null ||
      exists.length === 0 ||
      sql
        .exec(
          "SELECT m.id FROM ledger_members m JOIN ledger_group g ON g.deleted=0 WHERE m.user_id=? AND m.status='active'",
          candidate,
        )
        .toArray().length === 0
    )
      return new Response(null, { status: 404 });
    if (pathname === "/member-check") return new Response(null, { status: 204 });
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const userId = request.headers.get("X-User-Id");
    if (userId === null) return new Response(null, { status: 404 });
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    this.ctx.acceptWebSocket(server, [userId]);
    const headers = new Headers();
    const protocol = request.headers.get("Sec-WebSocket-Protocol");
    if (protocol !== null) headers.set("Sec-WebSocket-Protocol", protocol);
    return new Response(null, { status: 101, webSocket: client, headers });
  }
}
