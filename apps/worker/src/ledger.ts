import { stopOperation } from "./ledger-stops.js";
import {
  assertFrozenBalancesUnchanged,
  frozenBalances,
  finalizeAccount,
  freezeAccount,
  restoreAccount,
  commitAccountDeletion,
  isFrozen,
} from "./ledger-account-deletion.js";
import { DurableObject } from "cloudflare:workers";
import {
  canEditPlaceholderName,
  canRemoveMember,
  expenseSchema,
  isLastAdmin,
  MAX_MEMBER_PREVIEW,
  memberPatchSchema,
  memberRemovalDisposition,
  placeholderInputSchema,
  REMOVED_PLACEHOLDER_NAME,
  settlementSchema,
  tripDatesValid,
  type Invite,
  type MemberRole,
  type MemberStatus,
} from "@split/shared";
import type { Bindings } from "./env.js";
import { ApiError, invalid, type ErrorCode } from "./errors.js";
import { expenseOperation } from "./ledger-expenses.js";
import { settlementOperation } from "./ledger-settlements.js";
import type {
  AccountDeletionOperation,
  AccountDeletionValues,
  CreateGroup,
  DeleteGroup,
  ExpenseOperation,
  ExpenseValues,
  GroupFields,
  InviteOperation,
  LedgerMember,
  LedgerResult,
  LedgerState,
  MemberOperation,
  MemberOutcome,
  PatchGroup,
  SeatedMember,
  SettlementOperation,
  SettlementValues,
  StopOperation,
  StopValues,
} from "./ledger-types.js";

interface GroupRow extends Record<string, SqlStorageValue> {
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

interface MemberRow extends Record<string, SqlStorageValue> {
  id: string;
  user_id: string | null;
  placeholder_name: string | null;
  nickname: string | null;
  created_by_member_id: string | null;
  role: MemberRole;
  status: MemberStatus;
  net_balance: number;
  created_at: number;
}

export interface SyncNeeded {
  version: 1;
  type: "sync needed";
  rev: number;
  timestamp: number;
}

/** What one write did, as the commit step needs it. */
interface Edit<T> {
  value: T;
  /** The summary records it changed; absent when it changed nothing. */
  dirty?: string[] | undefined;
  /** The User whose Membership it ended: their screens close before the signal. */
  leaving?: string | null | undefined;
}

type LedgerFailure = Extract<LedgerResult<unknown>, { ok: false }>;

const notFound = { ok: false, code: "NOT_FOUND" } as const;

/** An ApiError as a result RPC can carry. Anything else is a bug, so it propagates. */
function failure(error: unknown): LedgerFailure {
  if (error instanceof ApiError) return { ok: false, code: error.code, details: error.details };
  throw error;
}

function seatedMember(row: MemberRow): SeatedMember {
  return {
    id: row.id,
    userId: row.user_id,
    placeholderName: row.placeholder_name,
    role: row.role,
    balance: row.net_balance,
  };
}

function ledgerMember(row: MemberRow): LedgerMember {
  return {
    ...seatedMember(row),
    status: row.status,
    nickname: row.nickname,
    createdByMemberId: row.created_by_member_id,
  };
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
    if (meta.schema_version < 7) {
      sql.exec(
        "CREATE TABLE ledger_invite (token TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL)",
      );
      sql.exec("UPDATE ledger_meta SET schema_version = 7");
    }
    if (meta.schema_version < 8) {
      sql.exec("CREATE TABLE IF NOT EXISTS ledger_stops (id TEXT PRIMARY KEY, data TEXT NOT NULL)");
      sql.exec("UPDATE ledger_meta SET schema_version = 8");
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
        invite: sql
          .exec<{ token: string; expires_at: number; created_at: number }>(
            "SELECT * FROM ledger_invite LIMIT 1",
          )
          .toArray()[0],
        expenseIds,
        group: sql.exec<GroupRow>("SELECT * FROM ledger_group").one(),
        expenses: expenseRows.map((row) => expenseSchema.parse(JSON.parse(row.data) as unknown)),
        locked:
          sql.exec<{ n: number }>("SELECT count(*) n FROM ledger_expenses WHERE deleted=0").one()
            .n > 0,
        members: sql
          .exec<MemberRow>("SELECT * FROM ledger_members ORDER BY created_at, rowid")
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
    const { group: g, invite, members, settlements, rev, locked, expenses, expenseIds } = snapshot;
    const db = this.env.DB;
    const fence = "COALESCE((SELECT rev FROM group_directory WHERE group_id = ?), -1) <= ?";
    try {
      const statements: D1PreparedStatement[] = [
        db
          .prepare(`DELETE FROM group_member_summary WHERE group_id = ? AND ${fence}`)
          .bind(g.id, g.id, rev),
      ];
      if (!g.deleted) {
        statements.push(
          db.prepare(`DELETE FROM invites WHERE group_id=? AND ${fence}`).bind(g.id, g.id, rev),
        );
        if (invite)
          statements.push(
            db
              .prepare(
                `INSERT INTO invites (id,group_id,token,expires_at,created_at) SELECT ?,?,?,?,? WHERE ${fence}`,
              )
              .bind(
                invite.token,
                g.id,
                invite.token,
                invite.expires_at,
                invite.created_at,
                g.id,
                rev,
              ),
          );
        for (const member of members) {
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
          db.prepare(`DELETE FROM invites WHERE group_id = ? AND ${fence}`).bind(g.id, g.id, rev),
        );
        statements.push(
          db
            .prepare(`DELETE FROM settlement_routes WHERE group_id = ? AND ${fence}`)
            .bind(g.id, g.id, rev),
        );
        statements.push(
          db
            .prepare(`DELETE FROM group_reservations WHERE group_id = ? AND ${fence}`)
            .bind(g.id, g.id, rev),
        );
      }
      if (!g.deleted) {
        for (const row of settlements) {
          const item = settlementSchema.parse(JSON.parse(row.data) as unknown);
          statements.push(
            db
              .prepare(
                `INSERT INTO settlement_routes (settlement_id, group_id, created_at)
                 SELECT ?, ?, ? WHERE ${fence}
                 ON CONFLICT(settlement_id) DO UPDATE SET group_id=excluded.group_id`,
              )
              .bind(item.id, item.groupId, item.createdAt, g.id, rev),
          );
        }
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
                    .slice(0, MAX_MEMBER_PREVIEW)
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
    } catch (error) {
      const retries = this.ctx.storage.sql
        .exec<{ retry_count: number }>("SELECT retry_count FROM ledger_meta")
        .one().retry_count;
      this.ctx.storage.sql.exec("UPDATE ledger_meta SET retry_count = retry_count + 1");
      console.error(
        JSON.stringify({
          event: "ledger_sync_failed",
          groupId: g.id,
          retryCount: retries + 1,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      const delay = Math.min(300_000, 2_000 * 2 ** Math.min(retries, 8));
      await this.ctx.storage.setAlarm(
        Date.now() + Math.min(300_000, delay * (0.8 + Math.random() * 0.4)),
      );
    }
  }

  /**
   * Drains until no dirty read-model record is left, so everything a write marked has reached D1.
   * One drain projects a bounded batch, so a write that dirties many records needs several. Gives
   * up, leaving the retry to the alarm, when a pass makes no progress.
   */
  private async drainAll(): Promise<void> {
    const dirtyCount = (): number =>
      this.ctx.storage.sql.exec<{ n: number }>("SELECT count(*) AS n FROM ledger_dirty").one().n;
    let remaining = dirtyCount();
    while (remaining > 0) {
      await this.drain();
      const next = dirtyCount();
      if (next >= remaining) return;
      remaining = next;
    }
  }

  override async alarm(): Promise<void> {
    await this.drain();
  }

  /**
   * Runs one write and owns every step after it, in one order: arm the alarm (so the summary
   * push survives the isolate dying), then in one transaction the edit, the rev bump and the
   * summary marks, then close and signal the Group's screens, then push. An edit that marks
   * nothing changed nothing, so nothing follows it.
   */
  private async commit<T>(
    edit: (sql: SqlStorage) => Edit<T>,
    options: {
      /** A new Group starts at rev 0. */
      bumpRev?: false;
      /** Default: signal before the push. "after push": once every summary batch is in D1. */
      signal?: "after push" | "none";
      /** The Group is gone: every screen gets the signal, then closes. */
      closeAll?: true;
    } = {},
  ): Promise<{ value: T; rev: number }> {
    if ((await this.ctx.storage.getAlarm()) === null)
      await this.ctx.storage.setAlarm(Date.now() + 2000);
    const sql = this.ctx.storage.sql;
    const { value, dirty, leaving, rev } = this.ctx.storage.transactionSync(() => {
      const edited = edit(sql);
      if (edited.dirty !== undefined) {
        if (options.bumpRev !== false) sql.exec("UPDATE ledger_meta SET rev=rev+1");
        for (const kind of edited.dirty)
          sql.exec(
            "INSERT INTO ledger_dirty(kind,rev) SELECT ?,rev FROM ledger_meta WHERE true ON CONFLICT(kind) DO UPDATE SET rev=excluded.rev",
            kind,
          );
      }
      return { ...edited, rev: sql.exec<{ rev: number }>("SELECT rev FROM ledger_meta").one().rev };
    });
    if (dirty === undefined) return { value, rev };
    if (leaving)
      for (const socket of this.ctx.getWebSockets(leaving)) {
        try {
          socket.close(4003, "Membership ended");
        } catch {
          /* socket closed */
        }
      }
    const signal = (): void => {
      const message: SyncNeeded = { version: 1, type: "sync needed", rev, timestamp: Date.now() };
      for (const socket of this.ctx.getWebSockets()) {
        try {
          socket.send(JSON.stringify(message));
          if (options.closeAll) socket.close(4003, "Group deleted");
        } catch {
          /* socket closed */
        }
      }
    };
    if (options.signal === undefined) signal();
    await this.drain();
    if (options.signal === "after push")
      // Finish projection before signaling, without holding the request for every batch.
      this.ctx.waitUntil(
        (async () => {
          const retries = sql
            .exec<{ retry_count: number }>("SELECT retry_count FROM ledger_meta")
            .one().retry_count;
          if (retries === 0) await this.drainAll();
          signal();
        })(),
      );
    return { value, rev };
  }

  /** Whether the Group has been deleted (its tombstone is kept, with its rows). */
  private isDeleted(): boolean {
    return (
      this.hasTable("ledger_group") &&
      this.ctx.storage.sql.exec("SELECT 1 FROM ledger_group WHERE deleted=1").toArray().length > 0
    );
  }

  private hasTable(name: string): boolean {
    return (
      this.ctx.storage.sql
        .exec("SELECT name FROM sqlite_master WHERE type='table' AND name=?", name)
        .toArray().length > 0
    );
  }

  private rev(): number {
    return this.ctx.storage.sql.exec<{ rev: number }>("SELECT rev FROM ledger_meta").one().rev;
  }

  /** A read in one transaction, with the rev it read at. It commits nothing. */
  private read<T>(run: (sql: SqlStorage) => T): { value: T; rev: number } {
    return this.ctx.storage.transactionSync(() => ({
      value: run(this.ctx.storage.sql),
      rev: this.rev(),
    }));
  }

  // RPC operations, one per ledger action.

  async stop(op: StopOperation): Promise<LedgerResult<StopValues[keyof StopValues]>> {
    if (this.isDeleted()) return notFound;
    try {
      const edit = (sql: SqlStorage): Edit<unknown> => {
        const outcome = stopOperation(sql, op);
        if (!outcome.changed) return { value: outcome.value };
        if (outcome.deletedId !== undefined) {
          for (const row of sql
            .exec<{ id: string; data: string }>(
              "SELECT id,data FROM ledger_expenses WHERE deleted=0",
            )
            .toArray()) {
            const expense = expenseSchema.parse(JSON.parse(row.data) as unknown);
            if (expense.stopId !== outcome.deletedId) continue;
            expense.stopId = null;
            sql.exec(
              "UPDATE ledger_expenses SET data=? WHERE id=?",
              JSON.stringify(expense),
              row.id,
            );
          }
        }
        return {
          value: outcome.value,
          dirty: [outcome.deletedId === undefined ? "group" : `stop:${outcome.deletedId}`],
        };
      };
      // A list reads, so it does not commit.
      const { value, rev } =
        op.action === "list" ? this.read((sql) => edit(sql).value) : await this.commit(edit);
      return { ok: true, value: value as StopValues[keyof StopValues], rev };
    } catch (error) {
      return failure(error);
    }
  }

  async settlement(
    op: SettlementOperation,
  ): Promise<LedgerResult<SettlementValues[keyof SettlementValues]>> {
    if (this.isDeleted()) return notFound;
    try {
      const edit = (sql: SqlStorage): Edit<unknown> => {
        const frozen = frozenBalances(sql, op.now);
        const outcome = settlementOperation(sql, op);
        assertFrozenBalancesUnchanged(sql, frozen);
        return outcome.changed
          ? { value: outcome.data, dirty: [`settlement:${outcome.id ?? ""}`] }
          : { value: outcome.data };
      };
      // A list reads, so it does not commit.
      const { value, rev } =
        op.action === "list" ? this.read((sql) => edit(sql).value) : await this.commit(edit);
      return { ok: true, value: value as SettlementValues[keyof SettlementValues], rev };
    } catch (error) {
      return failure(error);
    }
  }

  async expense(op: ExpenseOperation): Promise<LedgerResult<ExpenseValues[keyof ExpenseValues]>> {
    if (this.isDeleted()) return notFound;
    try {
      const { value, rev } =
        op.action === "create" || op.action === "update" || op.action === "delete"
          ? await this.commit((sql) => {
              const frozen = frozenBalances(sql, op.now);
              const outcome = expenseOperation(sql, op);
              assertFrozenBalancesUnchanged(sql, frozen);
              if (!outcome.changed) return { value: outcome.value };
              const expenseId =
                op.action === "create" ? (outcome.value as { id: string }).id : op.id;
              return { value: outcome.value, dirty: [`expense:${expenseId}`, "group"] };
            })
          : // A read does not commit.
            this.read((sql) => expenseOperation(sql, op).value);
      return { ok: true, value: value as ExpenseValues[keyof ExpenseValues], rev };
    } catch (error) {
      return failure(error);
    }
  }

  async accountDeletion(
    op: AccountDeletionOperation,
  ): Promise<LedgerResult<AccountDeletionValues[keyof AccountDeletionValues]>> {
    const sql = this.ctx.storage.sql;
    const done = (
      value: AccountDeletionValues[keyof AccountDeletionValues],
    ): LedgerResult<AccountDeletionValues[keyof AccountDeletionValues]> => ({
      ok: true,
      value,
      rev: this.hasTable("ledger_meta") ? this.rev() : 0,
    });
    if (op.action === "freeze")
      return done(
        this.ctx.storage.transactionSync(() => freezeAccount(sql, op.userId, op.expires)),
      );
    if (op.action === "commit") {
      this.ctx.storage.transactionSync(() => {
        commitAccountDeletion(sql, op.userId, op.expires);
      });
      return done(null);
    }
    if (op.action === "unfreeze") {
      this.ctx.storage.transactionSync(() => {
        if (this.hasTable("account_freezes"))
          sql.exec(
            "DELETE FROM account_freezes WHERE user_id=? AND expires_at=?",
            op.userId,
            op.expires,
          );
      });
      return done(null);
    }
    const initialized = this.hasTable("ledger_members");
    if (op.action === "restore") {
      if (!initialized) return done(false);
      const { value: restored } = await this.commit(
        (edited) =>
          restoreAccount(edited, op.userId, op.expires)
            ? { value: true, dirty: ["group"] }
            : { value: false },
        { signal: "after push" },
      );
      return done(restored);
    }
    if (!initialized) return done(null);
    try {
      await this.commit((edited) =>
        finalizeAccount(edited, op.userId, op.now, op.expires)
          ? { value: undefined, dirty: ["group"], leaving: op.userId }
          : { value: undefined },
      );
    } catch (error) {
      return failure(error);
    }
    return done(null);
  }

  async member(op: MemberOperation): Promise<LedgerResult<MemberOutcome>> {
    if (this.isDeleted()) return notFound;
    const { value: result, rev } = await this.commit(
      (sql): Edit<MemberOutcome | { error: ErrorCode; details?: unknown }> => {
        if (op.action === "join" || op.action === "claim") {
          const invite = sql
            .exec<{ token: string; expires_at: number }>(
              "SELECT token,expires_at FROM ledger_invite LIMIT 1",
            )
            .toArray()[0];
          if (!invite || invite.token !== op.inviteToken) return { value: { error: "NOT_FOUND" } };
          if (invite.expires_at <= op.now) return { value: { error: "INVITE_EXPIRED" } };
        }
        if ((op.action === "join" || op.action === "claim") && isFrozen(sql, op.userId, op.now))
          return { value: { error: "FORBIDDEN" } };
        const all = sql
          .exec<MemberRow>("SELECT * FROM ledger_members ORDER BY created_at,rowid")
          .toArray();
        const actorMemberId =
          op.action === "join" || op.action === "claim" ? undefined : op.actorMemberId;
        const names = op.action === "add" || op.action === "patch" ? op.names : undefined;
        const actor = all.find((m) => m.id === actorMemberId && m.status === "active");
        const target = all.find((m) => m.id === op.targetMemberId);
        const seated = all.filter((m) => m.status === "active" || m.status === "placeholder");
        const conflict = (name: string, except?: string) =>
          seated.some(
            (m) =>
              m.id !== except &&
              (m.placeholder_name ?? (m.user_id === null ? undefined : names?.[m.user_id])) ===
                name,
          );
        let memberId = op.targetMemberId;
        let closeUserId: string | null = null;
        if (op.action !== "join" && op.action !== "claim" && actor === undefined)
          return { value: { error: "NOT_FOUND" } };
        if (op.action === "add") {
          const input = placeholderInputSchema.safeParse(op.input);
          if (!input.success) return { value: { error: "VALIDATION_FAILED" } };
          if (seated.length >= 30) return { value: { error: "GROUP_FULL" } };
          if (conflict(input.data.name)) return { value: { error: "PLACEHOLDER_NAME_TAKEN" } };
          sql.exec(
            "INSERT INTO ledger_members(id,user_id,role,status,net_balance,created_at,placeholder_name,created_by_member_id) VALUES (?,NULL,'member','placeholder',0,?,?,?)",
            memberId,
            op.now,
            input.data.name,
            actor?.id ?? null,
          );
        } else if (op.action === "join") {
          const existing = all.find((m) => m.user_id === op.userId);
          if (existing?.status === "active")
            return { value: { memberId: existing.id, changed: false } };
          if (seated.length >= 30) return { value: { error: "GROUP_FULL" } };
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
          if (target === undefined) return { value: { error: "NOT_FOUND" } };
          if (all.some((m) => m.user_id === op.userId))
            return { value: { error: "ALREADY_MEMBER" } };
          if (target.status !== "placeholder") return { value: { error: "PLACEHOLDER_CLAIMED" } };
          sql.exec(
            "UPDATE ledger_members SET user_id=?,status='active',placeholder_name=NULL WHERE id=?",
            op.userId,
            target.id,
          );
          memberId = target.id;
        } else if (op.action === "patch") {
          if (target === undefined) return { value: { error: "NOT_FOUND" } };
          const input = memberPatchSchema.safeParse(op.input);
          if (!input.success) return { value: { error: "VALIDATION_FAILED" } };
          if (input.data.placeholderName !== undefined) {
            if (!canEditPlaceholderName(target)) return { value: { error: "MEMBER_NOT_ACTIVE" } };
            if (conflict(input.data.placeholderName, target.id))
              return { value: { error: "PLACEHOLDER_NAME_TAKEN" } };
            sql.exec(
              "UPDATE ledger_members SET placeholder_name=? WHERE id=?",
              input.data.placeholderName,
              target.id,
            );
          } else if (input.data.role !== undefined) {
            if (actor?.role !== "admin") return { value: { error: "FORBIDDEN" } };
            if (target.status !== "active") return { value: { error: "MEMBER_NOT_ACTIVE" } };
            if (input.data.role === "member" && isLastAdmin(all, target.id))
              return { value: { error: "LAST_ADMIN" } };
            sql.exec("UPDATE ledger_members SET role=? WHERE id=?", input.data.role, target.id);
          }
        } else {
          const leaving = op.action === "leave" ? actor : target;
          if (leaving === undefined) return { value: { error: "NOT_FOUND" } };
          if (actor === undefined) return { value: { error: "FORBIDDEN" } };
          if (!canRemoveMember(actor, leaving)) {
            return {
              value: {
                error:
                  leaving.status === "former" && actor.role === "admin"
                    ? "MEMBER_NOT_ACTIVE"
                    : "FORBIDDEN",
              },
            };
          }
          const balance = leaving.net_balance;
          if (balance !== 0)
            return {
              value: {
                error: "BALANCE_NOT_ZERO",
                details: {
                  balance,
                  currency: sql.exec<GroupRow>("SELECT * FROM ledger_group").one()
                    .settlement_currency,
                },
              },
            };
          if (isLastAdmin(all, leaving.id)) return { value: { error: "LAST_ADMIN" } };
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
          const disposition = memberRemovalDisposition(leaving, hasHistory);
          if (disposition === "delete")
            sql.exec("DELETE FROM ledger_members WHERE id=?", leaving.id);
          else if (disposition === "former_placeholder")
            sql.exec(
              "UPDATE ledger_members SET status='former',placeholder_name=NULL,nickname=? WHERE id=?",
              REMOVED_PLACEHOLDER_NAME,
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
        const history =
          op.action === "claim" ||
          op.action === "leave" ||
          op.action === "remove" ||
          (op.action === "join" && all.some((member) => member.id === memberId))
            ? sql
                .exec<{ id: string }>(
                  `SELECT id FROM ledger_expenses WHERE deleted=0 AND (
               EXISTS (SELECT 1 FROM json_each(data,'$.payers') WHERE json_extract(value,'$.memberId')=?) OR
               EXISTS (SELECT 1 FROM json_each(data,'$.splits') WHERE json_extract(value,'$.memberId')=?))`,
                  memberId,
                  memberId,
                )
                .toArray()
                .map((row) => `expense:${row.id}`)
            : [];
        const updatedRow = sql
          .exec<MemberRow>("SELECT * FROM ledger_members WHERE id=?", memberId)
          .toArray()[0];
        return {
          value: {
            memberId,
            changed: true,
            closeUserId,
            member: updatedRow === undefined ? undefined : ledgerMember(updatedRow),
          },
          dirty: [...history, "group"],
          leaving: closeUserId,
        };
      },
      { signal: "after push" },
    );
    if ("error" in result) return { ok: false, code: result.error, details: result.details };
    return { ok: true, value: result, rev };
  }

  async invite(op: InviteOperation): Promise<LedgerResult<Invite>> {
    if (this.isDeleted()) return notFound;
    const edit = (sql: SqlStorage): Edit<{ error: ErrorCode } | Invite> => {
      const existing = sql
        .exec<{ token: string; expires_at: number }>(
          "SELECT token,expires_at FROM ledger_invite LIMIT 1",
        )
        .toArray()[0];
      if (op.action !== "validate") {
        const actor = sql
          .exec<{ role: string }>(
            "SELECT role FROM ledger_members WHERE id=? AND status='active'",
            op.actorMemberId ?? "",
          )
          .toArray()[0];
        if (!actor) return { value: { error: "NOT_FOUND" } };
        if (op.action === "regenerate" && actor.role !== "admin")
          return { value: { error: "FORBIDDEN" } };
      }
      if (op.action === "validate")
        return {
          value:
            !existing || existing.token !== op.token
              ? { error: "NOT_FOUND" }
              : existing.expires_at <= op.now
                ? { error: "INVITE_EXPIRED" }
                : { token: existing.token, expiresAt: existing.expires_at },
        };
      if (op.action === "get")
        return {
          value:
            !existing || existing.expires_at <= op.now
              ? { error: "NOT_FOUND" }
              : { token: existing.token, expiresAt: existing.expires_at },
        };
      if (op.action === "ensure" && existing && existing.expires_at > op.now)
        return { value: { token: existing.token, expiresAt: existing.expires_at } };
      if (!op.token || op.expiresAt === undefined) return { value: { error: "VALIDATION_FAILED" } };
      sql.exec("DELETE FROM ledger_invite");
      sql.exec(
        "INSERT INTO ledger_invite(token,expires_at,created_at) VALUES (?,?,?)",
        op.token,
        op.expiresAt,
        op.now,
      );
      return { value: { token: op.token, expiresAt: op.expiresAt }, dirty: ["group"] };
    };
    // Showing or checking the Invite reads, so it does not commit.
    const { value, rev } =
      op.action === "get" || op.action === "validate"
        ? this.read((sql) => edit(sql).value)
        : await this.commit(edit);
    return "error" in value ? { ok: false, code: value.error } : { ok: true, value, rev };
  }

  members(asUserId?: string): LedgerResult<LedgerMember[]> {
    if (this.isDeleted()) return notFound;
    const rows = this.memberRows(asUserId);
    if (rows === undefined) return notFound;
    return {
      ok: true,
      value: rows.map(ledgerMember),
      rev: this.rev(),
    };
  }

  /** Every Member row; undefined when `asUserId` is given and is not an active Member. */
  private memberRows(asUserId: string | undefined): MemberRow[] | undefined {
    const sql = this.ctx.storage.sql;
    if (
      asUserId !== undefined &&
      sql
        .exec("SELECT 1 FROM ledger_members WHERE user_id=? AND status='active'", asUserId)
        .toArray().length === 0
    )
      return undefined;
    return sql.exec<MemberRow>("SELECT * FROM ledger_members ORDER BY created_at,rowid").toArray();
  }

  placeholderCounts(): LedgerResult<Record<string, number>> {
    if (this.isDeleted()) return notFound;
    return { ok: true, value: this.expenseCounts(), rev: this.rev() };
  }

  /** How many live Expenses each Member pays or shares in. */
  private expenseCounts(): Record<string, number> {
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
    return counts;
  }

  settlementCheck(userId: string, settlementId: string): boolean {
    return (
      this.isMember(userId) &&
      this.ctx.storage.sql
        .exec("SELECT 1 FROM ledger_settlements WHERE id=?", settlementId)
        .toArray().length > 0
    );
  }

  /** Whether the User is an active Member of this Group, and the Group is not deleted. */
  isMember(userId: string): boolean {
    return (
      this.hasTable("ledger_members") &&
      this.ctx.storage.sql
        .exec(
          "SELECT m.id FROM ledger_members m JOIN ledger_group g ON g.deleted=0 WHERE m.user_id=? AND m.status='active'",
          userId,
        )
        .toArray().length > 0
    );
  }

  state(): LedgerResult<LedgerState> {
    const state = this.stateRows();
    if (state === undefined) return notFound;
    const { group } = state;
    return {
      ok: true,
      value: {
        group: {
          id: group.id,
          name: group.name,
          settlementCurrency: group.settlement_currency as GroupFields["settlementCurrency"],
          isTrip: group.is_trip === 1,
          tripDestination: group.trip_destination,
          tripStartDate: group.trip_start_date,
          tripEndDate: group.trip_end_date,
          tripNotes: group.trip_notes,
          createdAt: group.created_at,
          updatedAt: group.updated_at,
        },
        locked: state.locked,
        seated: state.seated.map(seatedMember),
      },
      rev: state.rev,
    };
  }

  /** The live Group's row, rev, Expense lock and seated Members; undefined once deleted. */
  private stateRows() {
    const sql = this.ctx.storage.sql;
    const group = sql.exec<GroupRow>("SELECT * FROM ledger_group WHERE deleted = 0").toArray()[0];
    if (group === undefined) return undefined;
    const locked =
      sql.exec<{ n: number }>("SELECT count(*) AS n FROM ledger_expenses WHERE deleted=0").one().n >
      0;
    const seated = sql
      .exec<MemberRow>(
        "SELECT * FROM ledger_members WHERE status IN ('active','placeholder') ORDER BY created_at,rowid",
      )
      .toArray();
    return { group, rev: this.rev(), locked, seated };
  }

  async patchGroup(input: PatchGroup): Promise<LedgerResult<null>> {
    const { patch, expected, now, actorMemberId } = input;
    const { value: result, rev } = await this.commit(
      (
        sql,
      ): Edit<
        | "OK"
        | "FORBIDDEN"
        | "NOT_FOUND"
        | "EDIT_CONFLICT"
        | "TRIP_DATES_INVALID"
        | "SETTLEMENT_CURRENCY_LOCKED"
      > => {
        {
          const actor = sql
            .exec<{ role: string; status: string }>(
              "SELECT role, status FROM ledger_members WHERE id=?",
              actorMemberId,
            )
            .toArray()[0];
          if (!actor || actor.status !== "active" || actor.role !== "admin")
            return { value: "FORBIDDEN" };
        }
        const current = sql
          .exec<GroupRow>("SELECT * FROM ledger_group WHERE deleted = 0")
          .toArray()[0];
        if (current === undefined) return { value: "NOT_FOUND" };
        if (current.updated_at !== expected) return { value: "EDIT_CONFLICT" };
        const start =
          patch.tripStartDate === undefined ? current.trip_start_date : patch.tripStartDate;
        const end = patch.tripEndDate === undefined ? current.trip_end_date : patch.tripEndDate;
        if (!tripDatesValid(start, end)) return { value: "TRIP_DATES_INVALID" };
        if (
          sql.exec<{ n: number }>("SELECT count(*) AS n FROM ledger_expenses WHERE deleted=0").one()
            .n > 0 &&
          patch.settlementCurrency !== undefined &&
          patch.settlementCurrency !== current.settlement_currency
        )
          return { value: "SETTLEMENT_CURRENCY_LOCKED" };
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
        return { value: "OK", dirty: ["group"] };
      },
    );
    if (result === "OK") return { ok: true, value: null, rev };
    if (result === "TRIP_DATES_INVALID")
      return failure(invalid("tripEndDate", "TRIP_DATES_INVALID"));
    return { ok: false, code: result };
  }

  /** NOT_FOUND before the Group exists; FORBIDDEN unless an active admin asks. */
  async deleteGroup(by: DeleteGroup): Promise<LedgerResult<null>> {
    if (!this.hasTable("ledger_group")) return notFound;
    const { value: allowed, rev } = await this.commit(
      (sql) => {
        const actor = sql
          .exec<{ role: string; status: string }>(
            "SELECT role, status FROM ledger_members WHERE id=?",
            by.actorMemberId,
          )
          .toArray()[0];
        if (!actor || actor.status !== "active" || actor.role !== "admin") return { value: false };
        sql.exec("UPDATE ledger_group SET deleted=1 WHERE deleted=0");
        return { value: true, dirty: ["group"] };
      },
      { closeAll: true },
    );
    return allowed ? { ok: true, value: null, rev } : { ok: false, code: "FORBIDDEN" };
  }

  /** False when the creator holds no live reservation for it, or the Group already exists. */
  async createGroup(create: CreateGroup): Promise<boolean> {
    const { id, memberId, userId, now, input } = create;
    return this.ctx.blockConcurrencyWhile(async () => {
      const eligible = await this.env.DB.prepare(
        `SELECT r.user_id FROM group_reservations r JOIN users u ON u.id=r.user_id
        WHERE r.user_id=? AND r.group_id=? AND NOT EXISTS
        (SELECT 1 FROM account_deletions d WHERE d.user_id=r.user_id AND d.expires_at>?)`,
      )
        .bind(userId, id, now)
        .first();
      if (eligible === null) return false;
      const created = await this.commit(
        (sql) => {
          sql.exec(
            "CREATE TABLE IF NOT EXISTS ledger_meta (schema_version INTEGER NOT NULL, rev INTEGER NOT NULL)",
          );
          sql.exec(
            "INSERT INTO ledger_meta (schema_version, rev) SELECT 1, 0 WHERE NOT EXISTS (SELECT 1 FROM ledger_meta)",
          );
          this.upgradeSchema();
          if (sql.exec("SELECT id FROM ledger_group LIMIT 1").toArray().length > 0)
            return { value: false };
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
          return { value: true, dirty: ["group"] };
        },
        { bumpRev: false, signal: "none" },
      );
      return created.value;
    });
  }

  /** The live-update WebSocket: the one operation RPC cannot carry. */
  override fetch(request: Request): Response {
    const userId = request.headers.get("X-User-Id");
    if (userId === null || !this.isMember(userId)) return new Response(null, { status: 404 });
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    this.ctx.acceptWebSocket(server, [userId]);
    const headers = new Headers();
    const protocol = request.headers.get("Sec-WebSocket-Protocol");
    if (protocol !== null) headers.set("Sec-WebSocket-Protocol", protocol);
    return new Response(null, { status: 101, webSocket: client, headers });
  }
}
